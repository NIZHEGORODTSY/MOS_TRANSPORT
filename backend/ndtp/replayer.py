"""Replayer: проигрывает телеметрию датасета как живой поток NDTP.

Каждый терминал датасета — отдельное TCP-соединение с рукопожатием; навигационные пакеты
идут в хронологическом порядке с исходными (историческими) метками времени, со скоростью
``--speed`` относительно реального времени. При обрыве терминал переподключается через 5 с.

Запуск из папки ``backend``::

    python -m ndtp.replayer [--speed 1] [--start "2026-01-06 05:00:00"] [--host 127.0.0.1] [--port 9201] [--file traffic.csv] [--loop]
"""
import argparse
import asyncio
import csv
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from ndtp.ndtp import Nav, encode_handshake, encode_nav  # noqa: E402

DEFAULT_FILE = Path(__file__).resolve().parents[2] / "db" / "raw" / "test" / "traffic.csv"
RECONNECT_S = 5
CONNECT_TIMEOUT_S = 3
TICK_S = 0.05
REPORT_S = 10


def parse_ts(value: str) -> float:
    """Dataset timestamps are naive UTC with up to 6 fractional digits."""
    base, _, frac = value.partition(".")
    return datetime.fromisoformat(base).replace(tzinfo=timezone.utc).timestamp() + (float("0." + frac) if frac else 0.0)


def fmt_msk(ts: float) -> str:
    return datetime.fromtimestamp(ts + 3 * 3600, tz=timezone.utc).strftime("%d.%m %H:%M:%S МСК")


def load(path: Path) -> list[Nav]:
    points = []
    with path.open(encoding="utf-8", newline="") as f:
        for r in csv.DictReader(f):
            if not r["unit_id"]:
                continue
            valid = r["location_valid"] == "True" and bool(r["lon"])
            speed = float(r["speed"] or 0)
            points.append(
                Nav(
                    unit_id=int(r["unit_id"]),
                    ts=int(parse_ts(r["event_time"])),
                    lon=float(r["lon"]) if valid else 0.0,
                    lat=float(r["lat"]) if valid else 0.0,
                    alt=int(float(r["alt"] or 0)),
                    speed=round(speed),
                    speed_max=round(speed),
                    course=int(float(r["heading"] or 0)),
                    nsat=0,
                    pdop=0,
                    valid=valid,
                    battery_mv=0,
                )
            )
    points.sort(key=lambda n: n.ts)
    return points


class Terminal:
    """One emulated on-board terminal: its own TCP connection, handshake on (re)connect."""

    def __init__(self, unit_id: int, host: str, port: int):
        self.unit_id, self.host, self.port = unit_id, host, port
        self.writer: asyncio.StreamWriter | None = None
        self.request_id = 0
        self.retry_at = 0.0

    def _next_id(self) -> int:
        self.request_id = self.request_id % 0xFFFFFFFF + 1
        return self.request_id

    async def send(self, nav: Nav) -> bool:
        if self.writer is None:
            if time.monotonic() < self.retry_at:
                return False
            try:
                _, self.writer = await asyncio.wait_for(asyncio.open_connection(self.host, self.port), CONNECT_TIMEOUT_S)
                self.writer.write(encode_handshake(self.unit_id, self._next_id()))
            except (OSError, asyncio.TimeoutError):
                self.retry_at = time.monotonic() + RECONNECT_S
                return False
        try:
            self.writer.write(encode_nav(nav, self._next_id()))
            await self.writer.drain()
            return True
        except (OSError, ConnectionError):
            self.close()
            self.retry_at = time.monotonic() + RECONNECT_S
            return False

    def close(self) -> None:
        if self.writer is not None:
            self.writer.close()
            self.writer = None


async def replay(args: argparse.Namespace) -> None:
    points = load(args.file)
    start = parse_ts(args.start) if args.start else points[0].ts
    first = next((i for i, n in enumerate(points) if n.ts >= start), len(points))
    terminals = {n.unit_id: Terminal(n.unit_id, args.host, args.port) for n in points}
    print(f"{len(points):,} points of {len(terminals)} units from {args.file}", flush=True)
    print(f"replaying from {fmt_msk(start)} at x{args.speed} to {args.host}:{args.port}; Ctrl+C to stop", flush=True)

    sent = failed = 0
    i, wall0, report_at = first, time.monotonic(), time.monotonic() + REPORT_S
    try:
        while True:
            clock = start + (time.monotonic() - wall0) * args.speed
            while i < len(points) and points[i].ts <= clock:
                if await terminals[points[i].unit_id].send(points[i]):
                    sent += 1
                else:
                    failed += 1
                i += 1
            if time.monotonic() >= report_at:
                connected = sum(t.writer is not None for t in terminals.values())
                print(f"{fmt_msk(clock)}: sent {sent:,}, not delivered {failed:,}, connected units {connected}", flush=True)
                report_at += REPORT_S
            if i >= len(points):
                if not args.loop:
                    break
                print("end of data, starting over", flush=True)
                i, wall0 = first, time.monotonic()
            await asyncio.sleep(TICK_S)
    finally:
        for t in terminals.values():
            t.close()
        print(f"done: sent {sent:,}, not delivered {failed:,}", flush=True)


def main() -> None:
    p = argparse.ArgumentParser(description="Replay dataset telemetry as NDTP terminals")
    p.add_argument("--file", type=Path, default=DEFAULT_FILE, help="telemetry CSV (default: prepared telemetry.csv)")
    p.add_argument("--host", default="127.0.0.1")
    p.add_argument("--port", type=int, default=9201)
    p.add_argument("--speed", type=float, default=1.0, help="replay speed multiplier (1 = real time)")
    p.add_argument("--start", default="2026-01-06 05:00:00", help="UTC moment to start from (default: 08:00 MSK)")
    p.add_argument("--loop", action="store_true", help="start over when the data ends")
    try:
        asyncio.run(replay(p.parse_args()))
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
