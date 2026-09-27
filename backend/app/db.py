import os
from idlelib import query
from pathlib import Path
import httpx


import psycopg
from psycopg import sql
from psycopg.rows import dict_row
import tracemalloc
tracemalloc.start()

ENV_FILE = Path(__file__).resolve().parents[1] / ".env"

ROUTES = [122048, 122613, 122658, 129964, 130072, 130238, 131672, 132430, 133300, 133957, 134040, 134494, 135081]

OSMNX_URL = "http://5.227.60.94:547/api/roads"
TIMEOUT = 60.0

def _load_env() -> None:
    for line in ENV_FILE.read_text(encoding="utf-8").splitlines():
        key, sep, value = line.partition("=")
        if sep and key.strip():
            os.environ.setdefault(key.strip(), value.strip())


def connect() -> psycopg.Connection:
    _load_env()
    return psycopg.connect(os.environ["DATABASE_URL"], connect_timeout=10)


# def get_stops(id):
#     conn = connect()
#     cur = conn.cursor()
#     cur.execute("SELECT * FROM schedule_plan_tr_" + str(id) + "_street_loop")
#
#     rows = cur.fetchall()
#     cur.close()
#     conn.close()
#     f = []
#     print(rows)
#     for i in rows:
#         f.append([i[7], i[8]])
#     print(f)
#     # return f

def get_st_osmnx(tr_id: int = 122048):
    table = sql.Identifier(f"schedule_plan_tr_{int(tr_id)}_street_loop_datamos_clean")
    query = sql.SQL("SELECT * FROM {} ORDER BY time_begin::time").format(table)
    with connect() as conn:
        with conn.cursor() as cur:
            cur.execute(query)
            rows = cur.fetchall()
    return [[r[5], r[6]] for r in rows]

def get_stops(tr_id: int = 122048):
    table = sql.Identifier(f"schedule_plan_tr_{int(tr_id)}_street_loop_datamos_clean")
    query = sql.SQL("SELECT * FROM {} ORDER BY time_begin::time").format(table)
    with connect() as conn:
        with conn.cursor() as cur:
            cur.execute(query)
            rows = cur.fetchall()
    return [[r[0], r[4], r[6], r[5], r[7]] for r in rows]

class RoutingClientError(Exception):
    pass

async def get_osmnx_server_roads_1(routes: list):
    coords = get_st_osmnx()
    if len(coords) < 2:
        raise RoutingClientError("Нужно минимум 2 точки")

    payload = {"coords": coords}

    try:
        async with httpx.AsyncClient(timeout=60) as client:
            r = await client.post(OSMNX_URL, json=payload)
    except httpx.RequestError as e:
        raise RoutingClientError(f"Роутинг-сервер недоступен: {e}") from e

    if r.status_code != 200:
        try:
            detail = r.json().get("detail", r.text)
        except Exception:
            detail = r.text
        raise RoutingClientError(f"Сервер вернул {r.status_code}: {detail}")
    return r.json()


def get_routes_geojson(routes: list) -> dict:
    dict_routes = {}
    for route_num in routes:
        dict_routes[route_num] = get_stops(route_num)

    features = []
    for key, value in dict_routes.items():
        route_id = key
        coords = [[float(lon), float(lat)] for _, _, lon, lat in value]
        if len(coords) < 2:
            continue
        features.append({
            "type": "Feature",
            "geometry": {"type": "LineString", "coordinates": coords},
            "properties": {"route_id": route_id},
        })

    return {"type": "FeatureCollection", "features": features}


def get_stops_geojson(routes: list) -> dict:
    all_stops = []
    for route_num in routes:
        all_stops.append(get_stops(route_num))

    features = []
    seen = set()  # (route_id, stop_id) — чтобы не дублировать
    for el in all_stops:
        for s in el:
            route_id = s[1]
            stop_id = s[0]
            stop_name = s[4]
            lon = float(s[2])
            lat = float(s[3])
            key = (route_id, stop_id)
            if key in seen:
                continue
            seen.add(key)
            features.append({
                "type": "Feature",
                "geometry": {"type": "Point", "coordinates": [lon, lat]},
                "properties": {"id": stop_id, "route_id": route_id, "stop_name": stop_name},
            })

    return {"type": "FeatureCollection", "features": features}


def get_password(username: str) -> str | None:
    with connect() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT password_hash FROM operators WHERE username = %s",
                (username,),
            )
            row = cur.fetchone()
    return row[0] if row else None


if __name__ == "__main__":
    print(get_stops())
