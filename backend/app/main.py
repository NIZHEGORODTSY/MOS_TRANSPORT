import asyncio
import logging
import os
import sys
import urllib.error
from contextlib import asynccontextmanager
from pathlib import Path
from fastapi.middleware.cors import CORSMiddleware
from app.db import get_routes_geojson, get_stops_geojson, ROUTES
from app.auth import authenticate

from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from pydantic import BaseModel, Field

# lets the file run directly (e.g. PyCharm Run), not only via uvicorn
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app import emulator  # noqa: E402
from app.dataset import load_routes, load_units  # noqa: E402
from app.telemetry import TelemetryStore  # noqa: E402

NDTP_HOST = os.environ.get("NDTP_HOST", "0.0.0.0")
NDTP_PORT = int(os.environ.get("NDTP_PORT", "9201"))
BROADCAST_S = 1.0
RECEIVER_RETRY_S = 5

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s %(levelname)s %(message)s")
# routes_data = load_routes()
# store = TelemetryStore(load_units())
clients: set[WebSocket] = set()


async def _send(ws: WebSocket, payload: dict) -> None:
    try:
        await ws.send_json(payload)
    except Exception:
        clients.discard(ws)


async def broadcast() -> None:
    while True:
        await asyncio.sleep(BROADCAST_S)
        if clients:
            payload = store.snapshot()
            await asyncio.gather(*(_send(ws, payload) for ws in list(clients)))


async def run_receiver() -> None:
    """Keeps retrying the NDTP port so a busy port does not take the API down with it."""
    log = logging.getLogger("ndtp")
    while True:
        try:
            server = await asyncio.start_server(store.handle, NDTP_HOST, NDTP_PORT)
        except OSError as e:
            log.error("NDTP port %s:%s unavailable (%s), retrying in %ss", NDTP_HOST, NDTP_PORT, e, RECEIVER_RETRY_S)
            await asyncio.sleep(RECEIVER_RETRY_S)
            continue
        log.info("NDTP receiver listening on %s:%s", NDTP_HOST, NDTP_PORT)
        store.listening = True
        try:
            async with server:
                await server.serve_forever()
        finally:
            store.listening = False


@asynccontextmanager
async def lifespan(_: FastAPI):
    tasks = [asyncio.create_task(run_receiver()), asyncio.create_task(broadcast())]
    yield
    for task in tasks:
        task.cancel()


app = FastAPI(title="MosTransport", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_methods=["*"],
    allow_headers=["*"],
)


class LoginData(BaseModel):
    login: str
    password: str


@app.post("/api/login")
def login(data: LoginData):
    return authenticate(data.login, data.password)


@app.get("/api/routes/geojson")
def routes_geojson() -> dict:
    return get_routes_geojson(ROUTES)


@app.get("/api/stops/geojson")
def stops_geojson() -> dict:
    return get_stops_geojson(ROUTES)


class EmulatorStart(BaseModel):
    units: int = Field(16, ge=1, le=500)
    interval_ms: int = Field(1000, ge=100)


@app.get("/api/health")
def health() -> dict:
    return {"status": "ok"}


@app.get("/api/routes")
def routes() -> list[dict]:
    return routes_data


@app.get("/api/telemetry")
def telemetry() -> dict:
    """Last known state of every unit that has sent NDTP navigation data."""
    return store.snapshot()


@app.get("/api/telemetry/stats")
def telemetry_stats() -> dict:
    """NDTP receiver counters: connections, packets, CRC errors, parse time."""
    return store.stats()


@app.post("/api/emulator/start")
def emulator_start(body: EmulatorStart) -> dict:
    """Points the NDTP emulator at this backend's receiver with auto-generated units."""
    try:
        emulator.start(NDTP_PORT, body.units, body.interval_ms)
    except (urllib.error.URLError, OSError) as e:
        raise HTTPException(502, f"NDTP emulator at {emulator.EMULATOR_API} is not reachable: {e}")
    return {"status": "started", "units": body.units, "target": f"{emulator.EMULATOR_TARGET_HOST}:{NDTP_PORT}"}


@app.post("/api/emulator/stop")
def emulator_stop() -> dict:
    try:
        emulator.stop(NDTP_PORT)
    except (urllib.error.URLError, OSError) as e:
        raise HTTPException(502, f"NDTP emulator at {emulator.EMULATOR_API} is not reachable: {e}")
    return {"status": "stopped"}


@app.websocket("/ws/vehicles")
async def vehicles_ws(ws: WebSocket) -> None:
    await ws.accept()
    clients.add(ws)
    await ws.send_json(store.snapshot())
    try:
        while True:
            await ws.receive_text()
    except WebSocketDisconnect:
        clients.discard(ws)


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="127.0.0.1", port=8000)
