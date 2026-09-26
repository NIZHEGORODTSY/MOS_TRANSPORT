# Usage: python db/prepare_dataset.py "<dataset dir>"  -> db/build/mostransport_db.tar.gz
# Builds clean CSVs from the organizers' dataset and packs them with the SQL scripts for the server.
import csv
import re
import sys
import tarfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
BUILD = HERE / "build" / "mostransport"
ARCHIVE = HERE / "build" / "mostransport_db.tar.gz"
SQL_FILES = ["schema.sql", "load_dataset.sql"]
POINT = re.compile(r"POINT \(([-\d.]+) ([-\d.]+)\)")

TELEMETRY_COLS = [
    "packet_id", "tr_id", "unit_id", "event_time", "device_event_id", "location_valid", "gps_time",
    "lon", "lat", "alt", "speed", "heading", "receive_time", "is_hist_data",
]
TIME_COLS = {"event_time", "gps_time", "receive_time"}


def ts(value: str) -> str:
    """Normalize dataset timestamps (up to 9 fractional digits) to microsecond precision."""
    value = value.strip()
    if "." in value:
        base, frac = value.split(".", 1)
        return f"{base}.{frac[:6]}"
    return value


def read(path: Path) -> list[dict]:
    with path.open(encoding="utf-8", newline="") as f:
        return list(csv.DictReader(f))


def write(name: str, header: list[str], rows) -> int:
    count = 0
    with (BUILD / name).open("w", encoding="utf-8", newline="") as f:
        w = csv.writer(f)
        w.writerow(header)
        for row in rows:
            w.writerow(row)
            count += 1
    print(f"  {name}: {count:,} rows")
    return count


def main(dataset: Path) -> None:
    BUILD.mkdir(parents=True, exist_ok=True)

    # schedule: union of all splits; a fact from any split wins over a missing one
    schedule: dict[str, dict] = {}
    test_tr: set[str] = set()
    for split, name in (("train", "schedule.csv"), ("test", "schedule.csv"), ("validate", "schedule_plan.csv")):
        for r in read(dataset / split / name):
            item = schedule.setdefault(r["tt_action_item_id"], r)
            if not item.get("time_fact_begin") and r.get("time_fact_begin"):
                item["time_fact_begin"] = r["time_fact_begin"]
            if split != "train":
                test_tr.add(r["tr_id"])

    stop_keys, stop_address = set(), {}
    for r in schedule.values():
        lon, lat = POINT.match(r["geom"]).groups()
        r["_stop"] = (float(lon), float(lat))
        stop_keys.add(r["_stop"])
        if r["building_address"] and r["_stop"] not in stop_address:
            stop_address[r["_stop"]] = r["building_address"]
    stop_id = {key: i for i, key in enumerate(sorted(stop_keys, key=lambda k: (k[1], k[0])), start=1)}

    # routes: vehicles that serve exactly the same set of stops run the same route
    tr_stops: dict[str, set[int]] = {}
    for r in schedule.values():
        tr_stops.setdefault(r["tr_id"], set()).add(stop_id[r["_stop"]])
    patterns: dict[frozenset, list[str]] = {}
    for tr, stops in tr_stops.items():
        patterns.setdefault(frozenset(stops), []).append(tr)
    ordered = sorted(patterns.items(), key=lambda p: min(int(t) for t in p[1]))
    route_of = {tr: i for i, (_, trs) in enumerate(ordered, start=1) for tr in trs}

    # telemetry: union of all splits, deduplicated by packet_id
    telemetry, unit_of = {}, {}
    for split in ("train", "test", "validate"):
        for r in read(dataset / split / "traffic.csv"):
            if r["packet_id"] not in telemetry:
                telemetry[r["packet_id"]] = [ts(r[c]) if c in TIME_COLS else r[c] for c in TELEMETRY_COLS]
                unit_of.setdefault(r["tr_id"], r["unit_id"])

    points = []
    for split, path in (
        ("train", dataset / "labels" / "labels_train.csv"),
        ("test", dataset / "labels" / "labels_test.csv"),
        ("validate", dataset / "validate" / "points.csv"),
    ):
        for r in read(path):
            points.append([
                r["sample_id"], split, r["tr_id"], ts(r["T"]), r["target_stop_id"], ts(r["target_time_begin"]),
                r["cur_dev_s"], r.get("target_delay_s", ""), r.get("target_class", ""),
            ])

    all_tr = sorted(set(unit_of) | set(tr_stops) | {p[2] for p in points}, key=int)
    missing = [p[0] for p in points if p[4] not in schedule]
    if missing:
        sys.exit(f"{len(missing)} forecast points reference unknown schedule items, e.g. {missing[:3]}")

    print(f"Writing {BUILD}")
    write("stops.csv", ["id", "lon", "lat", "address"],
          ([i, k[0], k[1], stop_address.get(k, "")] for k, i in sorted(stop_id.items(), key=lambda x: x[1])))
    write("routes.csv", ["id", "name", "stop_count"],
          ([i, f"Маршрут {i}", len(stops)] for i, (stops, _) in enumerate(ordered, start=1)))
    write("vehicles.csv", ["tr_id", "unit_id", "route_id", "has_schedule", "in_test"],
          ([tr, unit_of.get(tr, ""), route_of.get(tr, ""), tr in tr_stops, tr in test_tr] for tr in all_tr))
    write("schedule.csv", ["item_id", "tr_id", "stop_id", "time_plan", "time_fact", "order_date", "manual_fill"],
          ([k, r["tr_id"], stop_id[r["_stop"]], ts(r["time_begin"]), ts(r.get("time_fact_begin") or ""),
            r["order_date"], r["manual_fill"]] for k, r in schedule.items()))
    write("telemetry.csv", TELEMETRY_COLS, telemetry.values())
    write("forecast_points.csv",
          ["sample_id", "split", "tr_id", "t", "target_item_id", "target_time_plan", "cur_dev_s",
           "target_delay_s", "target_class"], points)

    def readable(info: tarfile.TarInfo) -> tarfile.TarInfo:
        info.mode = 0o755 if info.isdir() else 0o644
        info.uid = info.gid = 0
        info.uname = info.gname = ""
        return info

    with tarfile.open(ARCHIVE, "w:gz") as tar:
        tar.add(BUILD, arcname="mostransport", filter=readable, recursive=False)
        for f in [*SQL_FILES, *sorted(p.name for p in BUILD.glob("*.csv"))]:
            src = HERE / f if f in SQL_FILES else BUILD / f
            tar.add(src, arcname=f"mostransport/{f}", filter=readable)
    print(f"Archive: {ARCHIVE} ({ARCHIVE.stat().st_size / 1e6:.1f} MB)")


if __name__ == "__main__":
    if len(sys.argv) != 2:
        sys.exit(__doc__ or "usage: python db/prepare_dataset.py <dataset dir>")
    main(Path(sys.argv[1]))
