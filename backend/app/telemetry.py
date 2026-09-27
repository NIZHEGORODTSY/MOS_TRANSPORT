"""Хранилище телеметрии: состояние терминалов, история ТС для модели, прогнозы и статистика приёмника NDTP.

:class:`TelemetryStore` принимает TCP-соединения терминалов (:meth:`TelemetryStore.handle`),
разбирает пакеты модулем :mod:`ndtp.ndtp` и хранит:

* последнее состояние каждого терминала — для карты (:meth:`TelemetryStore.snapshot`);
* историю валидных GPS-точек реальных ТС за ``HISTORY_S`` — для модели (:meth:`TelemetryStore.history_rows`);
* последние прогнозы и их ряды за час — для дашборда.
"""

import asyncio
import logging
import time
from collections import deque
from dataclasses import asdict, dataclass
from datetime import datetime, timezone

from ndtp.ndtp import NPH_CONN_REQUEST, FrameReader, Nav, parse_nav

log = logging.getLogger("ndtp")
# a unit that has sent nothing for this long is shown as offline, with its last known position
STALE_S = 30
# track kept per vehicle for the delay model: its features look back up to 30 min
HISTORY_S = 3600
# synthetic vehicles of the dataset (noisy copies of real ones), the model does not predict them
SYNTHETIC_TR_MIN = 9_000_000


def iso(ts: float) -> str:
    return datetime.fromtimestamp(ts, tz=timezone.utc).isoformat().replace("+00:00", "Z")


def naive_utc(ts: float) -> str:
    """Timestamp in the dataset format (naive UTC), as the ML service expects it."""
    return datetime.fromtimestamp(ts, tz=timezone.utc).strftime("%Y-%m-%d %H:%M:%S")


@dataclass
class UnitState:
    """Последний навигационный пакет терминала, время его приёма и есть ли открытое соединение."""

    nav: Nav
    received_at: float
    connected: bool


class TelemetryStore:
    """Last known state of every unit plus receiver statistics."""

    def __init__(self, vehicles: dict[int, tuple[int, int | None]]):
        self.vehicles = vehicles  # unit_id -> (tr_id, route_id) from the dataset
        self.units: dict[int, UnitState] = {}
        # tr_id -> (ts, lon, lat, speed, course) of valid fixes for the last HISTORY_S, oldest first
        self.history: dict[int, deque[tuple[int, float, float, int, int]]] = {}
        # tr_id -> latest delay prediction of the ML model, filled by the prediction loop in main.py
        self.predictions: dict[int, dict] = {}
        # tr_id -> (T, {at, delay_s, risk}) of past predictions, oldest first, for the deviation chart
        self.prediction_history: dict[int, deque[tuple[float, dict]]] = {}
        self.listening = False
        self.connections = 0
        self.packets = 0
        self.nav_packets = 0
        self.handshakes = 0
        self.bad_crc = 0
        self.skipped_bytes = 0
        self.parse_s = 0.0
        self.started_at = time.time()

    def disconnected(self, unit_ids: set[int]) -> None:
        """Помечает терминалы закрытого соединения как отключённые; позиция остаётся последней известной."""
        for unit_id in unit_ids:
            if unit_id in self.units:
                self.units[unit_id].connected = False

    def remember(self, nav: Nav) -> None:
        """Adds a valid fix of a real vehicle to its track for the delay model."""
        tr_id, _ = self.vehicles.get(nav.unit_id, (None, None))
        if tr_id is None or tr_id >= SYNTHETIC_TR_MIN or not nav.valid:
            return
        track = self.history.setdefault(tr_id, deque())
        if track and nav.ts <= track[-1][0]:
            if track[-1][0] - nav.ts < HISTORY_S:
                return  # duplicate or late packet
            track.clear()  # the replayer started over (--loop): the old track is from the future
        track.append((nav.ts, nav.lon, nav.lat, nav.speed, nav.course))
        while nav.ts - track[0][0] > HISTORY_S:
            track.popleft()

    def history_rows(self) -> list[dict]:
        """Tracks of all vehicles as TrafficRow records of the ML service (/set_context)."""
        rows = []
        for tr_id, track in self.history.items():
            for ts, lon, lat, speed, course in track:
                t = naive_utc(ts)
                # receive_time = event_time: the replayer sends dataset time, the wall clock would break freshness features
                rows.append(
                    {
                        "tr_id": tr_id,
                        "event_time": t,
                        "receive_time": t,
                        "lon": lon,
                        "lat": lat,
                        "speed": speed,
                        "heading": course,
                        "location_valid": True,
                    }
                )
        return rows

    def remember_prediction(self, tr_id: int, t: float, prediction: dict) -> None:
        """Appends a prediction made at moment t to the vehicle's series, keeping the last HISTORY_S."""
        series = self.prediction_history.setdefault(tr_id, deque())
        if series and t <= series[-1][0]:
            if series[-1][0] - t < HISTORY_S:
                return  # the vehicle has sent nothing new since the last cycle
            series.clear()  # the replayer started over (--loop)
        series.append((t, {k: prediction[k] for k in ("at", "delay_s", "risk")}))
        while t - series[0][0] > HISTORY_S:
            series.popleft()

    def prediction_series(self, tr_id: int) -> list[dict]:
        """Прогнозы ТС за последний час, по одному на момент T: ``at``, ``delay_s``, ``risk``."""
        return [point for _, point in self.prediction_history.get(tr_id, ())]

    def online_tr_ids(self) -> set[int]:
        """``tr_id`` ТС, чьи терминалы на связи и присылали пакеты за последние ``STALE_S`` секунд."""
        now = time.time()
        return {
            self.vehicles[unit_id][0]
            for unit_id, st in self.units.items()
            if unit_id in self.vehicles and st.connected and now - st.received_at < STALE_S
        }

    def snapshot(self) -> dict:
        """Состояние всех терминалов с прогнозами — то, что уходит дашборду по WebSocket."""
        now = time.time()
        units = []
        for unit_id, st in sorted(self.units.items()):
            tr_id, route_id = self.vehicles.get(unit_id, (None, None))
            age = now - st.received_at
            units.append(
                {
                    **{k: v for k, v in asdict(st.nav).items() if k != "ts"},
                    "time": iso(st.nav.ts),
                    "received_at": iso(st.received_at),
                    "age_s": round(age, 1),
                    "online": st.connected and age < STALE_S,
                    "tr_id": tr_id,
                    "route_id": route_id,
                    "prediction": self.predictions.get(tr_id),
                }
            )
        return {"type": "telemetry", "time": iso(now), "units": units}

    def stats(self) -> dict:
        """Счётчики приёмника: соединения, пакеты, ошибки CRC, время разбора, объём истории."""
        uptime = max(time.time() - self.started_at, 1e-9)
        return {
            "listening": self.listening,
            "uptime_s": round(uptime, 1),
            "open_connections": self.connections,
            "units": len(self.units),
            "units_online": sum(u["online"] for u in self.snapshot()["units"]),
            "packets": self.packets,
            "nav_packets": self.nav_packets,
            "handshakes": self.handshakes,
            "bad_crc": self.bad_crc,
            "skipped_bytes": self.skipped_bytes,
            "packets_per_s": round(self.packets / uptime, 2),
            "avg_parse_us": round(self.parse_s / self.packets * 1e6, 1) if self.packets else None,
            "history_vehicles": len(self.history),
            "history_points": sum(len(track) for track in self.history.values()),
        }

    async def handle(self, reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
        peer = writer.get_extra_info("peername")
        frames, units = FrameReader(), set()
        self.connections += 1
        log.info("NDTP connection from %s", peer)
        try:
            while chunk := await reader.read(65536):
                started = time.perf_counter()
                bad_crc, skipped = frames.bad_crc, frames.skipped_bytes
                for frame in frames.feed(chunk):
                    self.packets += 1
                    units.add(frame.unit_id)
                    if frame.nph_type == NPH_CONN_REQUEST:
                        self.handshakes += 1
                    nav = parse_nav(frame)
                    if nav:
                        self.nav_packets += 1
                        self.remember(nav)
                        last = self.units.get(nav.unit_id)
                        # a packet without a GPS fix must not overwrite the last known good position
                        keep = last is not None and last.nav.valid and not nav.valid
                        self.units[nav.unit_id] = UnitState(
                            nav=last.nav if keep else nav, received_at=time.time(), connected=True
                        )
                self.bad_crc += frames.bad_crc - bad_crc
                self.skipped_bytes += frames.skipped_bytes - skipped
                self.parse_s += time.perf_counter() - started
        except (ConnectionError, OSError) as e:
            log.warning("NDTP connection from %s broke: %s", peer, e)
        finally:
            self.connections -= 1
            self.disconnected(units)
            writer.close()
            log.info("NDTP connection from %s closed", peer)
