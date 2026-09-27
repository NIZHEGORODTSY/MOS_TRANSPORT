"""Воспроизводимый замер производительности: парсинг NDTP и цикл прогноза с ML-сервисом.

Запуск из папки ``backend`` (ML-сервис должен быть запущен)::

    python -m tools.benchmark --ml-url http://127.0.0.1:8001 --json ../docs/perf_results.json

Часть 1 работает без сети: навигационные пакеты датасета кодируются в NDTP и разбираются
теми же ``FrameReader``/``parse_nav``, что и приёмник бэкенда.

Часть 2 повторяет цикл прогноза бэкенда (``app.main.run_predictions``) на срезах дня 06.01.2026:
пакеты подаются в ``TelemetryStore`` в порядке времени, и в каждый момент T история ТС
за последний час уходит на ``/set_context``, а точки прогноза — на ``/predict``.
Меряется время обоих запросов. Для контроля качества прогноз сравнивается с фактическим
прибытием из ``schedule_test.csv`` — модели этот факт не передаётся.
"""

import argparse
import json
import statistics
import sys
import time
from pathlib import Path

import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app import predictor
from app.dataset import load_units
from app.telemetry import TelemetryStore
from ndtp.ndtp import FrameReader, encode_nav, parse_nav
from ndtp.replayer import load

TRAFFIC_CSV = predictor.ML_DATA / "traffic_test.csv"
CYCLE_START = pd.Timestamp("2026-01-06 03:00:00")
CYCLE_END = pd.Timestamp("2026-01-06 17:00:00")
CYCLE_STEP = pd.Timedelta(minutes=30)
ONLINE_S = 60


def pct(values: list[float], q: float) -> float:
    return statistics.quantiles(values, n=100)[q - 1] if len(values) > 1 else values[0]


def bench_ndtp(navs: list) -> dict:
    """Кодирование и разбор всех навигационных пакетов потоком по 64 КБ, как их читает приёмник."""
    stream = b"".join(encode_nav(n, i) for i, n in enumerate(navs))
    reader, parsed = FrameReader(), 0
    started = time.perf_counter()
    for i in range(0, len(stream), 65536):
        for frame in reader.feed(stream[i:i + 65536]):
            parsed += parse_nav(frame) is not None
    elapsed = time.perf_counter() - started
    return {
        "packets": parsed,
        "bytes": len(stream),
        "seconds": round(elapsed, 3),
        "us_per_packet": round(elapsed / parsed * 1e6, 2),
        "packets_per_s": round(parsed / elapsed),
        "bad_crc": reader.bad_crc,
    }


def bench_cycle(navs: list, schedule: "predictor.Schedule") -> dict:
    """Цикл прогноза бэкенда в моменты T: история → /set_context, точки → /predict."""
    store = TelemetryStore(load_units())
    facts = pd.read_csv(predictor.SCHEDULE_CSV, usecols=["tt_action_item_id", "time_fact_begin"])
    fact_ts = dict(zip(facts.tt_action_item_id, predictor._to_sec(facts.time_fact_begin)))

    ctx_s, pred_s, cycle_s, rows_n, points_n, errors = [], [], [], [], [], []
    k, t = 0, CYCLE_START
    while t <= CYCLE_END:
        t_s = (t - pd.Timestamp("1970-01-01")).total_seconds()
        while k < len(navs) and navs[k].ts <= t_s:
            store.remember(navs[k])
            k += 1
        online = {tr for tr, track in store.history.items() if track and track[-1][0] >= t_s - ONLINE_S}
        points, targets = predictor.make_points(store.history, online, schedule)
        if points:
            rows = store.history_rows()
            t0 = time.perf_counter()
            predictor.set_context(rows, schedule.rows)
            t1 = time.perf_counter()
            delays = predictor.predict(points)
            t2 = time.perf_counter()
            ctx_s.append(t1 - t0)
            pred_s.append(t2 - t1)
            cycle_s.append(t2 - t0)
            rows_n.append(len(rows))
            points_n.append(len(points))
            for p in points:
                stop, _ = targets[p["tr_id"]]
                fact = fact_ts.get(stop.item_id)
                if fact == fact:
                    errors.append((delays[p["sample_id"]], fact - stop.plan_ts))
        t += CYCLE_STEP

    ms = lambda xs: {"p50": round(pct(xs, 50) * 1000), "p95": round(pct(xs, 95) * 1000), "max": round(max(xs) * 1000)}
    return {
        "cycles": len(cycle_s),
        "history_rows_mean": round(statistics.mean(rows_n)),
        "vehicles_per_cycle_mean": round(statistics.mean(points_n), 1),
        "set_context_ms": ms(ctx_s),
        "predict_ms": ms(pred_s),
        "cycle_ms": ms(cycle_s),
        "predict_ms_per_vehicle": round(statistics.mean(p / n for p, n in zip(pred_s, points_n)) * 1000, 1),
        "quality": {
            "predictions_with_fact": len(errors),
            "mae_model_s": round(statistics.mean(abs(p - f) for p, f in errors), 1),
            "mae_on_schedule_s": round(statistics.mean(abs(f) for _, f in errors), 1),
        },
    }


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--ml-url", default=predictor.BASE, help="адрес ML-сервиса")
    ap.add_argument("--json", type=Path, help="куда сохранить результаты")
    a = ap.parse_args()
    predictor.BASE = a.ml_url

    navs = load(TRAFFIC_CSV)
    valid = [n for n in navs if n.valid]
    print(f"датасет: {len(navs)} пакетов, с GPS-фиксом {len(valid)}")

    ndtp = bench_ndtp(valid)
    print(f"NDTP: {ndtp['packets']} пакетов за {ndtp['seconds']} с — {ndtp['us_per_packet']} мкс/пакет, "
          f"{ndtp['packets_per_s']} пакетов/с, ошибок CRC {ndtp['bad_crc']}")

    health = predictor.health()
    cycle = bench_cycle(navs, predictor.Schedule())
    print(f"цикл прогноза ({cycle['cycles']} циклов, в среднем {cycle['vehicles_per_cycle_mean']} ТС, "
          f"{cycle['history_rows_mean']} точек истории):")
    for key in ("set_context_ms", "predict_ms", "cycle_ms"):
        print(f"  {key}: {cycle[key]}")
    print(f"  /predict на одно ТС: {cycle['predict_ms_per_vehicle']} мс")
    q = cycle["quality"]
    print(f"качество: MAE модели {q['mae_model_s']} с против {q['mae_on_schedule_s']} с «идёт по графику» "
          f"на {q['predictions_with_fact']} прогнозах")

    if a.json:
        result = {"ml_service": health, "ndtp": ndtp, "prediction_cycle": cycle}
        a.json.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
        print(f"результаты: {a.json}")


if __name__ == "__main__":
    main()
