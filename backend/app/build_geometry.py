# Usage: python backend/app/build_geometry.py  (or `python -m app.build_geometry` from backend/)
import json
import sys
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

# lets the file run directly as a script, not only via `python -m`
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.routes_data import ROUTES  # noqa: E402
from app.simulator import GEOMETRY_FILE, haversine  # noqa: E402

OVERPASS_MIRRORS = [
    "https://overpass-api.de/api/interpreter",
    "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
]
STOP_ROLES = {"stop", "stop_entry_only", "stop_exit_only"}
PLATFORM_ROLES = {"platform", "platform_entry_only", "platform_exit_only"}
GAP_WARN_M = 50
STOP_WARN_M = 80
STOP_SEARCH_M = 4000

Point = tuple[float, float]


def fetch(relation_ids: list[int]) -> tuple[dict, dict]:
    query = f"""
    [out:json][timeout:180];
    rel(id:{",".join(map(str, relation_ids))})->.r;
    .r out geom;
    node(r.r);
    out body;
    """
    body = urllib.parse.urlencode({"data": query}).encode()
    for url in OVERPASS_MIRRORS:
        req = urllib.request.Request(url, data=body, headers={"User-Agent": "MosTransport-hackathon/0.1"})
        try:
            with urllib.request.urlopen(req, timeout=240) as resp:
                elements = json.load(resp)["elements"]
            break
        except (urllib.error.URLError, TimeoutError) as e:
            print(f"Overpass {url} failed: {e}; trying next mirror")
    else:
        sys.exit("All Overpass mirrors failed, try again in a minute")
    relations = {e["id"]: e for e in elements if e["type"] == "relation"}
    nodes = {e["id"]: e for e in elements if e["type"] == "node"}
    return relations, nodes


def chain_ways(relation: dict, label: str) -> list[Point]:
    ways = [
        [(p["lon"], p["lat"]) for p in m["geometry"]]
        for m in relation["members"]
        if m["type"] == "way" and m["role"] in ("", "forward", "backward") and m.get("geometry")
    ]
    first, second = ways[0], ways[1]
    if min(haversine(first[0], second[0]), haversine(first[0], second[-1])) < min(
        haversine(first[-1], second[0]), haversine(first[-1], second[-1])
    ):
        first = first[::-1]
    path = list(first)
    for way in ways[1:]:
        if haversine(way[-1], path[-1]) < haversine(way[0], path[-1]):
            way = way[::-1]
        gap = haversine(way[0], path[-1])
        if gap > GAP_WARN_M:
            print(f"  {label}: gap of {gap:.0f} m in way chain near {path[-1]}")
        path.extend(way[1:] if way[0] == path[-1] else way)
    return path


def relation_stops(relation: dict, nodes: dict) -> list[dict]:
    for roles in (STOP_ROLES, PLATFORM_ROLES):
        stops = []
        for m in relation["members"]:
            if m["type"] == "node" and m["role"] in roles and m["ref"] in nodes:
                n = nodes[m["ref"]]
                stops.append({"name": n.get("tags", {}).get("name", "Остановка"), "lon": n["lon"], "lat": n["lat"]})
        if stops:
            return stops
    return []


def mark_stops(path: list[Point], stops: list[dict], offset: int, label: str) -> list[list]:
    marks, start = [], 0
    for s in stops:
        pos = (s["lon"], s["lat"])
        best_i, best_d, travelled = start, float("inf"), 0.0
        for i in range(start, len(path)):
            if i > start:
                travelled += haversine(path[i - 1], path[i])
                if travelled > STOP_SEARCH_M:
                    break
            d = haversine(pos, path[i])
            if d < best_d:
                best_i, best_d = i, d
        if best_d > STOP_WARN_M:
            print(f'  {label}: stop "{s["name"]}" is {best_d:.0f} m from the route line')
        marks.append([best_i + offset, s["name"]])
        start = best_i
    return marks


def build_route(route: dict, relations: dict, nodes: dict) -> dict:
    path: list[Point] = []
    marks: list[list] = []
    shown: list[dict] = []
    for n, rel_id in enumerate(route["osm"]):
        rel = relations[rel_id]
        label = f'{route["name"]} [{rel["tags"].get("from")} -> {rel["tags"].get("to")}]'
        part = chain_ways(rel, label)
        stops = relation_stops(rel, nodes)
        marks += mark_stops(part, stops, len(path), label)
        if n == 0:
            shown = stops
        length = sum(haversine(a, b) for a, b in zip(part, part[1:]))
        print(f"  {label}: {length / 1000:.1f} km, {len(part)} points, {len(stops)} stops")
        path += part
    if path[-1] != path[0]:
        path.append(path[0])
    return {
        "path": [[round(lon, 6), round(lat, 6)] for lon, lat in path],
        "stop_marks": marks,
        "stops": shown,
    }


def main() -> None:
    relations, nodes = fetch([rel_id for r in ROUTES for rel_id in r["osm"]])
    geometry = {}
    for r in ROUTES:
        print(f'Route {r["name"]} ({r["title"]})')
        geometry[r["id"]] = build_route(r, relations, nodes)
    GEOMETRY_FILE.write_text(json.dumps(geometry, ensure_ascii=False), encoding="utf-8")
    total = sum(len(g["path"]) for g in geometry.values())
    print(f"Saved {len(geometry)} routes, {total} points -> {GEOMETRY_FILE}")


if __name__ == "__main__":
    main()
