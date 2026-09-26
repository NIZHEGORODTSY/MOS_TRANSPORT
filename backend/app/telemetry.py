import asyncio
import logging
import time
from dataclasses import asdict, dataclass
from datetime import datetime, timezone

from app.ndtp import NPH_CONN_REQUEST, FrameReader, Nav, parse_nav

log = logging.getLogger("ndtp")
# a unit that has sent nothing for this long is shown as offline, with its last known position
STALE_S = 30


def iso(ts: float) -> str:
    return datetime.fromtimestamp(ts, tz=timezone.utc).isoformat().replace("+00:00", "Z")


@dataclass
class UnitState:
    nav: Nav
    received_at: float
    connected: bool


class TelemetryStore:
    """Last known state of every unit plus receiver statistics."""

    def __init__(self, vehicles: dict[int, tuple[int, int | None]]):
        self.vehicles = vehicles  # unit_id -> (tr_id, route_id) from the dataset
        self.units: dict[int, UnitState] = {}
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
        for unit_id in unit_ids:
            if unit_id in self.units:
                self.units[unit_id].connected = False

    def snapshot(self) -> dict:
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
                }
            )
        return {"type": "telemetry", "time": iso(now), "units": units}

    def stats(self) -> dict:
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
