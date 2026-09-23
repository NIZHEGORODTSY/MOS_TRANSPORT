import json
import math
import random
from bisect import bisect_right
from collections import deque
from dataclasses import dataclass, field
from pathlib import Path

from .routes_data import ROUTES

GEOMETRY_FILE = Path(__file__).with_name("route_geometry.json")

NOMINAL_SPEED = 20 / 3.6
TICK_S = 1.0
TIME_SCALE = 6.0
HORIZON_S = 15 * 60
HISTORY_STEP_S = 30
HISTORY_LEN = 40
INCIDENT_RATE = 1 / 6000
WARMUP_S = 3600


def haversine(a: tuple[float, float], b: tuple[float, float]) -> float:
    lon1, lat1, lon2, lat2 = map(math.radians, (*a, *b))
    h = math.sin((lat2 - lat1) / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin((lon2 - lon1) / 2) ** 2
    return 2 * 6_371_000 * math.asin(math.sqrt(h))


def status_for(delay_s: float) -> str:
    if delay_s < 120:
        return "ok"
    if delay_s < 300:
        return "risk"
    return "late"


class RoutePath:
    def __init__(self, geometry: dict):
        self.points = [tuple(p) for p in geometry["path"]]
        self.cum = [0.0]
        for a, b in zip(self.points, self.points[1:]):
            self.cum.append(self.cum[-1] + haversine(a, b))
        self.length = self.cum[-1]
        self.stop_marks = [(self.cum[i], name) for i, name in geometry["stop_marks"]]

    def position(self, d: float) -> tuple[float, float]:
        d %= self.length
        i = min(bisect_right(self.cum, d) - 1, len(self.points) - 2)
        seg = self.cum[i + 1] - self.cum[i]
        t = (d - self.cum[i]) / seg if seg else 0.0
        (x1, y1), (x2, y2) = self.points[i], self.points[i + 1]
        return x1 + (x2 - x1) * t, y1 + (y2 - y1) * t

    def next_stop(self, d: float) -> str:
        d %= self.length
        for dist, name in self.stop_marks:
            if dist > d + 1:
                return name
        return self.stop_marks[0][1]


@dataclass
class Vehicle:
    id: str
    route_id: str
    board: str
    path: RoutePath
    offset: float
    progress: float
    speed_factor: float = 1.0
    incident_left: float = 0.0
    incident_factor: float = 1.0
    delay: float = 0.0
    trend: float = 0.0
    history: deque = field(default_factory=lambda: deque(maxlen=HISTORY_LEN))


class Simulator:
    def __init__(self, seed: int | None = None):
        self.rng = random.Random(seed)
        self.sim_t = 0.0
        self.routes = {r["id"]: r for r in ROUTES}
        self.geometry = json.loads(GEOMETRY_FILE.read_text(encoding="utf-8"))
        self.paths = {r["id"]: RoutePath(self.geometry[r["id"]]) for r in ROUTES}
        self.vehicles: list[Vehicle] = []
        for r in ROUTES:
            path = self.paths[r["id"]]
            for i in range(r["vehicles"]):
                offset = path.length * i / r["vehicles"]
                self.vehicles.append(
                    Vehicle(
                        id=f'{r["id"]}-{i + 1}',
                        route_id=r["id"],
                        board=str(self.rng.randint(10000, 99999)),
                        path=path,
                        offset=offset,
                        progress=offset,
                    )
                )
        dt = TICK_S * TIME_SCALE
        for _ in range(int(WARMUP_S / dt)):
            self.step(dt)

    def _update_speed(self, v: Vehicle, dt: float) -> None:
        if v.incident_left > 0:
            v.incident_left -= dt
            target = v.incident_factor
        elif self.rng.random() < INCIDENT_RATE * dt:
            v.incident_left = self.rng.uniform(180, 540)
            v.incident_factor = self.rng.uniform(0.1, 0.4)
            target = v.incident_factor
        else:
            # drivers speed up when late and hold back when early
            target = 1.0 + max(-0.4, min(0.12, v.delay / 1500))
        target *= self.rng.uniform(0.9, 1.1)
        v.speed_factor += (target - v.speed_factor) * min(1.0, dt / 30)

    def step(self, dt: float) -> None:
        prev_bucket = int(self.sim_t // HISTORY_STEP_S)
        self.sim_t += dt
        record = int(self.sim_t // HISTORY_STEP_S) != prev_bucket
        for v in self.vehicles:
            self._update_speed(v, dt)
            v.progress += NOMINAL_SPEED * v.speed_factor * dt
            scheduled = v.offset + NOMINAL_SPEED * self.sim_t
            new_delay = (scheduled - v.progress) / NOMINAL_SPEED
            v.trend = 0.85 * v.trend + 0.15 * (new_delay - v.delay) / dt
            v.delay = new_delay
            if record:
                v.history.append(round(v.delay))

    def predict(self, v: Vehicle) -> float:
        # МЕСТО ДЛЯ МОДЕЛИ
        trend = max(-0.3, min(1.0, v.trend))
        return max(-300.0, v.delay + trend * HORIZON_S * 0.5)

    def routes_geo(self) -> list[dict]:
        out = []
        for r in ROUTES:
            geo = self.geometry[r["id"]]
            out.append(
                {
                    "id": r["id"],
                    "name": r["name"],
                    "title": r["title"],
                    "color": r["color"],
                    "coordinates": geo["path"],
                    "stops": geo["stops"],
                    "vehicle_count": r["vehicles"],
                }
            )
        return out

    def snapshot(self) -> dict:
        vehicles = []
        for v in self.vehicles:
            lon, lat = v.path.position(v.progress)
            predicted = self.predict(v)
            vehicles.append(
                {
                    "id": v.id,
                    "route_id": v.route_id,
                    "route_name": self.routes[v.route_id]["name"],
                    "board": v.board,
                    "lon": round(lon, 6),
                    "lat": round(lat, 6),
                    "speed_kmh": round(NOMINAL_SPEED * v.speed_factor * 3.6, 1),
                    "delay_s": round(v.delay),
                    "predicted_delay_s": round(predicted),
                    "status": status_for(predicted),
                    "next_stop": v.path.next_stop(v.progress),
                    "history": list(v.history),
                }
            )
        return {
            "type": "snapshot",
            "sim_time": round(self.sim_t),
            "horizon_s": HORIZON_S,
            "history_step_s": HISTORY_STEP_S,
            "tick_ms": int(TICK_S * 1000),
            "vehicles": vehicles,
        }
