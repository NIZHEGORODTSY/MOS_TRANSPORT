"""FastAPI-приложение бэкенда: приём NDTP, цикл прогноза, REST API и WebSocket дашборда.

Фоновые задачи (запускаются в ``lifespan``):

* :func:`run_receiver` — TCP-сервер NDTP, пакеты попадают в :class:`app.telemetry.TelemetryStore`;
* :func:`run_predictions` — раз в ``PREDICT_S`` секунд история → ML-сервис → прогнозы;
* :func:`broadcast` — раз в секунду рассылает состояние ТС клиентам ``/ws/vehicles``.
"""

import asyncio
import json
import logging
import os
import sys
import time
import urllib.error
from contextlib import asynccontextmanager
from pathlib import Path

# --- sys.path ДО любых импортов из app.* ---
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import httpx
import requests
from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from app import api_docs, emulator
from app.auth import authenticate
from app.dataset import load_route_by_tr, load_routes, load_units
from app.db import (
    ROUTES,
    get_osmnx_server_roads_1,
    get_routes_geojson,
    get_st_osmnx,
    get_stops_geojson,
)
from app.predictor import (
    Schedule,
    health as ml_health,
    make_points,
    predict as ml_predict,
    risk_level,
    set_context,
)
from app.telemetry import TelemetryStore, iso

# ──────────────────────────── НАСТРОЙКИ ────────────────────────────

NDTP_HOST = os.environ.get("NDTP_HOST", "0.0.0.0")
NDTP_PORT = int(os.environ.get("NDTP_PORT", "9201"))
BROADCAST_S = 1.0
RECEIVER_RETRY_S = 5
OSMNX_URL = os.environ.get("OSMNX_URL", "http://5.227.60.94:547/roads")
# как часто пересчитывать прогноз задержек по накопленной телеметрии
PREDICT_S = float(os.environ.get("ML_PREDICT_S", "30"))

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(name)s %(levelname)s %(message)s",
)
log = logging.getLogger("main")

# ──────────────────────────── СОСТОЯНИЕ ────────────────────────────

routes_data = load_routes()
store = TelemetryStore(load_units())
route_by_tr = load_route_by_tr()
clients: set[WebSocket] = set()
# состояние цикла прогноза: starting / warming_up / ok / error / disabled
ml_status: dict = {"state": "starting", "error": None, "last_run": None, "points": 0, "elapsed_s": None}


# ──────────────────────────── ФОНОВЫЕ ЗАДАЧИ ────────────────────────────

async def _send(ws: WebSocket, payload: dict) -> None:
    try:
        await ws.send_json(payload)
    except Exception:
        clients.discard(ws)


async def broadcast() -> None:
    """Раз в ``BROADCAST_S`` секунд отправляет снимок всех ТС подключённым клиентам WebSocket."""
    while True:
        await asyncio.sleep(BROADCAST_S)
        if clients:
            payload = store.snapshot()
            await asyncio.gather(*(_send(ws, payload) for ws in list(clients)))


async def run_receiver() -> None:
    """Держит NDTP-порт; при занятости — ретраит, чтобы API не падал."""
    ndtp_log = logging.getLogger("ndtp")
    while True:
        try:
            server = await asyncio.start_server(store.handle, NDTP_HOST, NDTP_PORT)
        except OSError as e:
            ndtp_log.error(
                "NDTP port %s:%s unavailable (%s), retrying in %ss",
                NDTP_HOST, NDTP_PORT, e, RECEIVER_RETRY_S,
            )
            await asyncio.sleep(RECEIVER_RETRY_S)
            continue
        ndtp_log.info("NDTP receiver listening on %s:%s", NDTP_HOST, NDTP_PORT)
        store.listening = True
        try:
            async with server:
                await server.serve_forever()
        except asyncio.CancelledError:
            raise
        finally:
            store.listening = False


async def run_predictions() -> None:
    """Раз в PREDICT_S: история NDTP → ML-сервис → store.predictions (уходит на фронт в snapshot)."""
    try:
        schedule = await asyncio.to_thread(Schedule)
    except Exception as e:
        ml_status.update(state="disabled", error=f"расписание не загружено: {e}")
        log.error("ML predictions disabled, schedule not loaded: %s", e)
        return
    log.info("ML schedule loaded: %s vehicles, %s stops", len(schedule.plans), len(schedule.rows))

    while True:
        await asyncio.sleep(PREDICT_S)
        # данные собираем в event loop: приёмник NDTP дописывает те же deque
        points, targets = make_points(store.history, store.online_tr_ids(), schedule)
        if not points:
            store.predictions = {}
            ml_status.update(state="warming_up", error=None, points=0)
            continue
        rows = store.history_rows()

        started = time.perf_counter()
        try:
            await asyncio.to_thread(set_context, rows, schedule.rows)
            delays = await asyncio.to_thread(ml_predict, points)
        except Exception as e:
            # старые прогнозы оставляем: по computed_at видно, что они устарели
            ml_status.update(state="error", error=str(e))
            log.warning("ML prediction failed: %s", e)
            continue

        now = time.time()
        predictions = {}
        for p in points:
            delay = delays.get(p["sample_id"])
            if delay is None:
                continue
            stop, t = targets[p["tr_id"]]
            predictions[p["tr_id"]] = {
                "delay_s": round(delay),
                "risk": risk_level(delay),
                "stop_id": stop.item_id,
                "address": stop.address,
                "plan_time": iso(stop.plan_ts),
                "expected_time": iso(stop.plan_ts + delay),
                "at": iso(t),
                "horizon_s": round(stop.plan_ts - t),
                "computed_at": iso(now),
            }
            store.remember_prediction(p["tr_id"], t, predictions[p["tr_id"]])
        store.predictions = predictions
        ml_status.update(
            state="ok", error=None, last_run=iso(now),
            points=len(predictions), elapsed_s=round(time.perf_counter() - started, 2),
        )


# ──────────────────────────── LIFESPAN ────────────────────────────

@asynccontextmanager
async def lifespan(_: FastAPI):
    tasks = [
        asyncio.create_task(run_receiver()),
        asyncio.create_task(broadcast()),
        asyncio.create_task(run_predictions()),
    ]

    try:
        yield
    finally:
        for task in tasks:
            task.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)


app = FastAPI(
    title="МосТранспорт — API диспетчерской",
    version="1.0.0",
    description=api_docs.DESCRIPTION,
    openapi_tags=api_docs.TAGS,
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "http://localhost:5174",
        "http://127.0.0.1:5174",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ──────────────────────────── МОДЕЛИ ────────────────────────────

class LoginData(BaseModel):
    """Учётные данные диспетчера."""

    login: str = Field(description="Логин диспетчера")
    password: str = Field(description="Пароль")


class EmulatorStart(BaseModel):
    """Параметры запуска эмулятора NDTP."""

    units: int = Field(16, ge=1, le=500, description="Сколько терминалов сгенерировать")
    interval_ms: int = Field(1000, ge=100, description="Период отправки пакетов каждым терминалом, мс")


# ──────────────────────────── СЛУЖЕБНЫЕ ────────────────────────────

@app.get("/api/health", tags=["Служебные"], summary="Бэкенд работает", responses=api_docs.example({"status": "ok"}))
def health() -> dict:
    """Используется healthcheck-ом контейнера."""
    return {"status": "ok"}


# ──────────────────────────── АВТОРИЗАЦИЯ ────────────────────────────

@app.post("/api/login", tags=["Авторизация"], summary="Вход диспетчера", responses=api_docs.example(True))
def login(data: LoginData) -> bool:
    """``true``, если логин и пароль совпали с учётной записью в базе (bcrypt), иначе ``false``."""
    return authenticate(data.login, data.password)


# ──────────────────────────── ГЕОДАННЫЕ ────────────────────────────

@app.get("/api/routes/geojson", tags=["Геоданные"], summary="Маршруты прямыми линиями между остановками")
def routes_geojson() -> dict:
    """GeoJSON FeatureCollection: по линии на ТС из списка ``ROUTES``."""
    return get_routes_geojson(ROUTES)


@app.get("/api/stops/geojson", tags=["Геоданные"], summary="Остановки маршрутов")
def stops_geojson() -> dict:
    """GeoJSON FeatureCollection точек остановок с названиями (``stop_name``)."""
    return get_stops_geojson(ROUTES)


class RoutingClientError(Exception):
    pass


@app.get("/api/roads", tags=["Геоданные"], summary="Маршрут по дорогам (сервер маршрутизации)")
async def route():
    """Проксирует запрос к серверу маршрутизации osmnx для первого маршрута."""
    print("ROADS")
    return await get_osmnx_server_roads_1()


def _fallback_feature(route_id, coords):
    """Прямая линия, если роутер не ответил.
    coords: список вида [stop_id, route_id, lat, lon] или [lat, lon].
    Берём последние два числа — это всегда lat и lon.
    """
    return {
        "type": "Feature",
        "geometry": {
            "type": "LineString",
            "coordinates": [[p[-1], p[-2]] for p in coords],  # [lon, lat]
        },
        "properties": {"route_id": route_id, "routed": False},
    }


@app.get("/api/roads/stream", tags=["Геоданные"], summary="Маршруты по дорогам потоком (SSE)")
async def roads_stream():
    """
    SSE-поток маршрутов. Отдаёт по одной фиче по мере готовности.
    Формат событий:
      data: {"type": "Feature", "geometry": ..., "properties": {"route_id": ...}}
      ...
      data: {"done": true}
    """

    async def event_generator():
        routes_ids = ROUTES

        async with httpx.AsyncClient(timeout=180) as client:
            for tr_id in routes_ids:
                coords = None
                feature = None

                try:
                    coords = get_st_osmnx(tr_id)

                    if len(coords) < 2:
                        print(f"[{tr_id}] пропущен: {len(coords)} точек")
                        continue
                    if len(coords) > 100:
                        print(f"[{tr_id}] пропущен: {len(coords)} точек (лимит 100)")
                        continue

                    print(f"[{tr_id}] отправляю на osmnx ({len(coords)} точек)")

                    r = await client.post(OSMNX_URL, json={"coords": coords})

                    if r.status_code == 200:
                        feature = r.json()
                        feature.setdefault("properties", {})["route_id"] = tr_id
                        feature["properties"]["routed"] = True
                        print(f"[{tr_id}] ✅ получен маршрут")
                    else:
                        print(f"[{tr_id}] osmnx вернул {r.status_code}: {r.text[:200]}")
                        feature = _fallback_feature(tr_id, coords)

                except Exception as e:
                    print(f"[{tr_id}] ошибка: {e}")
                    if coords:
                        feature = _fallback_feature(tr_id, coords)
                    else:
                        continue

                feature.setdefault("properties", {})["route"] = route_by_tr.get(tr_id)
                yield f"data: {json.dumps(feature, ensure_ascii=False)}\n\n"

        yield 'data: {"done": true}\n\n'

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


# ──────────────────────────── ML ────────────────────────────

@app.get("/api/ml/health", tags=["Прогноз"], summary="Доступность ML-сервиса")
def ml_healthcheck() -> dict:
    """Ответ ``/health`` ML-сервиса; 502, если он недоступен."""
    try:
        return ml_health()
    except requests.RequestException as e:
        raise HTTPException(502, f"ML service unavailable: {e}")


@app.get(
    "/api/predictions",
    tags=["Прогноз"],
    summary="Текущие прогнозы задержек",
    responses=api_docs.example(api_docs.PREDICTIONS_EXAMPLE),
)
def predictions() -> dict:
    """Последние прогнозы по ``tr_id`` и состояние цикла прогноза.

    ``status.state``: ``starting`` — загрузка, ``warming_up`` — копится история (нужно 15 мин),
    ``ok`` — прогноз посчитан за ``elapsed_s`` секунд, ``error`` — ML-сервис недоступен
    (последние прогнозы сохраняются), ``disabled`` — нет расписания.

    Прогноз ТС: задержка ``delay_s`` на остановке ``stop_id`` с плановым временем ``plan_time``,
    сделанный в момент ``at`` (время последнего пакета ТС) за ``horizon_s`` секунд до плана.
    """
    return {"status": ml_status, "predictions": store.predictions}


@app.get(
    "/api/predictions/{tr_id}/history",
    tags=["Прогноз"],
    summary="Ряд прогнозов ТС за час",
    responses=api_docs.example(api_docs.HISTORY_EXAMPLE),
)
def prediction_history(tr_id: int) -> list[dict]:
    """Прогнозы задержки ТС за последний час по одному на момент T — данные графика отклонения."""
    return store.prediction_series(tr_id)


# ──────────────────────────── ТЕЛЕМЕТРИЯ ────────────────────────────

@app.get("/api/telemetry", tags=["Телеметрия"], summary="Состояние всех ТС", responses=api_docs.example(api_docs.TELEMETRY_EXAMPLE))
def telemetry() -> dict:
    """Последнее известное состояние каждого терминала и его прогноз — то же, что приходит по ``/ws/vehicles``.

    ``online`` = ``false``, если терминал молчит дольше 30 с: позиция остаётся последней известной.
    """
    return store.snapshot()


@app.get("/api/telemetry/stats", tags=["Телеметрия"], summary="Статистика приёмника NDTP", responses=api_docs.example(api_docs.STATS_EXAMPLE))
def telemetry_stats() -> dict:
    """Соединения, пакеты, ошибки CRC, пропущенные байты, среднее время разбора и объём истории для модели."""
    return store.stats()


# ──────────────────────────── ЭМУЛЯТОР ────────────────────────────

@app.post("/api/emulator/start", tags=["Эмулятор"], summary="Запустить эмулятор NDTP")
def emulator_start(body: EmulatorStart) -> dict:
    """Настраивает эмулятор организаторов слать пакеты сгенерированных терминалов на приёмник этого бэкенда."""
    try:
        emulator.start(NDTP_PORT, body.units, body.interval_ms)
    except (urllib.error.URLError, OSError) as e:
        raise HTTPException(
            502,
            f"NDTP emulator at {emulator.EMULATOR_API} is not reachable: {e}",
        )
    return {
        "status": "started",
        "units": body.units,
        "target": f"{emulator.EMULATOR_TARGET_HOST}:{NDTP_PORT}",
    }


@app.post("/api/emulator/stop", tags=["Эмулятор"], summary="Остановить эмулятор NDTP")
def emulator_stop() -> dict:
    """Убирает все терминалы из конфигурации эмулятора."""
    try:
        emulator.stop(NDTP_PORT)
    except (urllib.error.URLError, OSError) as e:
        raise HTTPException(
            502,
            f"NDTP emulator at {emulator.EMULATOR_API} is not reachable: {e}",
        )
    return {"status": "stopped"}


# ──────────────────────────── WEBSOCKET ────────────────────────────

@app.websocket("/ws/vehicles")
async def vehicles_ws(ws: WebSocket) -> None:
    """Снимок всех ТС при подключении и далее раз в секунду (рассылает :func:`broadcast`)."""
    await ws.accept()
    clients.add(ws)
    try:
        await ws.send_json(store.snapshot())
    except Exception:
        clients.discard(ws)
        return
    try:
        while True:
            await ws.receive_text()
    except WebSocketDisconnect:
        pass
    finally:
        clients.discard(ws)


# ──────────────────────────── ЗАПУСК ────────────────────────────

if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="127.0.0.1", port=8000)
