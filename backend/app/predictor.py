"""
Клиент ML-сервиса прогноза задержек, работающий на живом NDTP-потоке.

Раз в цикл бэкенд отправляет на /set_context историю телеметрии из TelemetryStore
и плановое расписание, затем на /predict — по одной точке на каждый ТС:
T = время его последнего пакета, цель = первая остановка по плану в (T+10 мин, T+15 мин].
"""

import bisect
import math
import os
from collections import deque
from dataclasses import dataclass
from pathlib import Path

import numpy as np
import pandas as pd
import requests


PROJECT_ROOT = Path(__file__).resolve().parents[2]

ML_DATA = Path(os.environ.get("ML_DATA_DIR", PROJECT_ROOT / "ml_data"))
if not ML_DATA.is_absolute():
    ML_DATA = (PROJECT_ROOT / ML_DATA).resolve()

SCHEDULE_CSV = ML_DATA / "schedule_test.csv"

BASE = os.environ.get("ML_SERVICE_URL", "http://5.227.60.94:548")
TIMEOUT_HEALTH = 10
TIMEOUT_SET_CONTEXT = 180
TIMEOUT_PREDICT = 60

HORIZON_MIN_S = 600
HORIZON_MAX_S = 900
MIN_TRACK_S = int(os.environ.get("ML_MIN_TRACK_S", "900"))

EARLY_S = -60
ON_TIME_S = 60
LATE_S = 180


def risk_level(delay_s: float) -> str:
    """early / on_time / risk / late по прогнозу задержки, с."""
    if delay_s < EARLY_S:
        return "early"
    if delay_s <= ON_TIME_S:
        return "on_time"
    if delay_s <= LATE_S:
        return "risk"
    return "late"


def _sanitize(obj):
    """Превращает NaN/Inf/NumPy-типы в JSON-совместимые значения."""
    if isinstance(obj, dict):
        return {k: _sanitize(v) for k, v in obj.items()}
    if isinstance(obj, (list, tuple)):
        return [_sanitize(v) for v in obj]
    if isinstance(obj, float):
        return None if (math.isnan(obj) or math.isinf(obj)) else obj
    if isinstance(obj, np.floating):
        f = float(obj)
        return None if (math.isnan(f) or math.isinf(f)) else f
    if isinstance(obj, np.integer):
        return int(obj)
    if isinstance(obj, np.bool_):
        return bool(obj)
    if isinstance(obj, pd.Timestamp):
        return obj.isoformat() if pd.notna(obj) else None
    if obj is pd.NaT:
        return None
    return obj


def _to_sec(s: pd.Series) -> np.ndarray:
    """Наивное время датасета (UTC) → секунды Unix, как ts в пакетах NDTP."""
    return (pd.to_datetime(s) - pd.Timestamp("1970-01-01")).dt.total_seconds().to_numpy()


def _fmt(ts: float) -> str:
    """Секунды Unix → наивное UTC-время в формате датасета, как его ждёт ML-сервис."""
    return pd.Timestamp(ts, unit="s").strftime("%Y-%m-%d %H:%M:%S")


@dataclass
class Stop:
    item_id: int
    plan_ts: float
    address: str


class Schedule:
    """Плановое расписание: записи для /set_context и остановки каждого ТС по времени."""

    def __init__(self, path: str | Path = SCHEDULE_CSV):
        df = pd.read_csv(path)
        for col in ("tr_id", "tt_action_item_id", "time_begin"):
            if col not in df.columns:
                raise ValueError(f"в {path} нет колонки {col}")

        df["tr_id"] = pd.to_numeric(df.tr_id, errors="coerce")
        df["tt_action_item_id"] = pd.to_numeric(df.tt_action_item_id, errors="coerce")
        df = df.dropna(subset=["tr_id", "tt_action_item_id", "time_begin"])
        df["tr_id"] = df.tr_id.astype(np.int64)
        df["tt_action_item_id"] = df.tt_action_item_id.astype(np.int64)

        cols = [c for c in (
            "tt_action_item_id", "tr_id", "time_begin",
            "geom", "building_address", "manual_fill",
        ) if c in df.columns]
        self.rows: list[dict] = _sanitize(df[cols].to_dict(orient="records"))

        df["plan_ts"] = _to_sec(df.time_begin)
        df["address"] = df.building_address.fillna("") if "building_address" in df.columns else ""
        df = df.sort_values(["tr_id", "plan_ts"])
        self.stops: dict[int, list[Stop]] = {}
        self.plans: dict[int, list[float]] = {}
        for tr_id, g in df.groupby("tr_id"):
            self.stops[int(tr_id)] = [
                Stop(int(i), float(t), str(a)) for i, t, a in zip(g.tt_action_item_id, g.plan_ts, g.address)
            ]
            self.plans[int(tr_id)] = g.plan_ts.tolist()

    def target(self, tr_id: int, t: float) -> Stop | None:
        """Первая остановка ТС с плановым прибытием в (t+10 мин, t+15 мин], иначе None (отстой, конец смены)."""
        plans = self.plans.get(tr_id)
        if not plans:
            return None
        k = bisect.bisect_right(plans, t + HORIZON_MIN_S)
        if k < len(plans) and plans[k] <= t + HORIZON_MAX_S:
            return self.stops[tr_id][k]
        return None


def make_points(
        history: dict[int, deque],
        online: set[int],
        schedule: Schedule,
) -> tuple[list[dict], dict[int, tuple[Stop, float]]]:
    """Точка прогноза для каждого онлайн-ТС с расписанием и достаточной историей.

    history — TelemetryStore.history: tr_id → deque[(ts, lon, lat, speed, course)].
    Возвращает точки для /predict и по tr_id — целевую остановку и момент T.
    """
    points, targets = [], {}
    for tr_id, track in history.items():
        if tr_id not in online or not track or tr_id not in schedule.plans:
            continue
        t_last = track[-1][0]
        if t_last - track[0][0] < MIN_TRACK_S:
            continue
        stop = schedule.target(tr_id, t_last)
        if stop is None:
            continue
        points.append({
            "sample_id": f"{tr_id}_{int(t_last)}",
            "tr_id": tr_id,
            "T": _fmt(t_last),
            "target_stop_id": stop.item_id,
            "target_time_begin": _fmt(stop.plan_ts),
            "cur_dev_s": 0.0,
        })
        targets[tr_id] = (stop, t_last)
    return points, targets


def health() -> dict:
    """GET /health. Возвращает dict или бросает requests.RequestException."""
    r = requests.get(f"{BASE}/health", timeout=TIMEOUT_HEALTH)
    r.raise_for_status()
    return r.json()


def set_context(traffic: list[dict], schedule: list[dict]) -> dict:
    """POST /set_context: история телеметрии (TrafficRow) + плановое расписание (ScheduleRow).

    Возвращает {'n_vehicles': int, 'elapsed_sec': float}.
    """
    r = requests.post(
        f"{BASE}/set_context",
        json={"traffic": traffic, "schedule": schedule},
        timeout=TIMEOUT_SET_CONTEXT,
    )
    r.raise_for_status()
    return r.json()


def predict(points: list[dict]) -> dict[str, float]:
    """POST /predict для всех точек разом. Возвращает sample_id → задержка, с."""
    r = requests.post(f"{BASE}/predict", json={"points": points}, timeout=TIMEOUT_PREDICT)
    r.raise_for_status()
    data = r.json()
    return {sid: float(p) for sid, p in zip(data["sample_id"], data["prediction"])}
