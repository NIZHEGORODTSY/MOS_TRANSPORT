import csv
import os
from collections import Counter
from pathlib import Path

DATA_DIR = Path(
    os.environ.get("MOSTRANSPORT_DATA", Path(__file__).resolve().parents[2] / "db" / "build" / "mostransport")
)
ROUTE_COLORS = [
    "#4c8dff", "#a970ff", "#22c3e6", "#ff7ab8", "#3ddbb0", "#7f8cff", "#c77dff",
    "#5ec8ff", "#ff9ecf", "#6fe0c3", "#9aa7ff", "#e08aff", "#8fd3ff",
]


def _read(name: str) -> list[dict]:
    with (DATA_DIR / name).open(encoding="utf-8", newline="") as f:
        return list(csv.DictReader(f))


def load_units() -> dict[int, tuple[int, int | None]]:
    """On-board terminal id (NDTP peerAddress) -> (tr_id, route_id) for vehicles of the dataset."""
    return {
        int(r["unit_id"]): (int(r["tr_id"]), int(r["route_id"]) if r["route_id"] else None)
        for r in _read("vehicles.csv")
        if r["unit_id"]
    }


def load_routes() -> list[dict]:
    if not DATA_DIR.exists():
        raise FileNotFoundError(f"No prepared data in {DATA_DIR}. Run: python db/prepare_dataset.py <dataset dir>")
    vehicle_count = Counter(r["route_id"] for r in _read("vehicles.csv") if r["route_id"])
    return [
        {
            "id": r["id"],
            "name": r["id"],
            "title": f'Маршрут {r["id"]} · {r["stop_count"]} остановок',
            "color": ROUTE_COLORS[(int(r["id"]) - 1) % len(ROUTE_COLORS)],
            "vehicle_count": vehicle_count[r["id"]],
        }
        for r in sorted(_read("routes.csv"), key=lambda r: int(r["id"]))
    ]
