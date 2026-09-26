import os
from idlelib import query
from pathlib import Path

import psycopg
from psycopg import sql
from psycopg.rows import dict_row

ENV_FILE = Path(__file__).resolve().parents[1] / ".env"

ROUTES = [122048, 122613, 122658, 129964, 130072, 130238, 131672, 132430, 133300, 133957, 134040, 134494, 135081]


def _load_env() -> None:
    for line in ENV_FILE.read_text(encoding="utf-8").splitlines():
        key, sep, value = line.partition("=")
        if sep and key.strip():
            os.environ.setdefault(key.strip(), value.strip())


def connect() -> psycopg.Connection:
    _load_env()
    return psycopg.connect(os.environ["DATABASE_URL"], connect_timeout=10)


def get_stops(id):
    conn = connect()
    cur = conn.cursor()
    cur.execute("SELECT * FROM schedule_plan_tr_" + str(id) + "_street_loop")

    rows = cur.fetchall()
    cur.close()
    conn.close()
    f = []
    for i in rows:
        f.append([i[7], i[8]])
    print(f)
    return f


def get_stops(tr_id: int = 122048):
    table = sql.Identifier(f"schedule_plan_tr_{int(tr_id)}_street_loop")
    query = sql.SQL("SELECT * FROM {}").format(table)
    with connect() as conn:
        with conn.cursor() as cur:
            cur.execute(query)
            rows = cur.fetchall()

    return [[r[0], r[7], r[8]] for r in rows]


def get_routes_dict(routes: list) -> dict:
    dict_routes = {}
    for route_num in routes:
        dict_routes[route_num] = get_stops(route_num)

    features = []
    seen = set()  # (route_id, stop_id) — чтобы не дублировать

    for  in rows:
        stop_id = r[7]
        lon = float(r[8])
        lat = float(r[9])
        key = (route_id, stop_id)
        if key in seen:
            continue
        seen.add(key)
        features.append({
            "type": "Feature",
            "geometry": {"type": "Point", "coordinates": [lon, lat]},
            "properties": {"id": stop_id, "route_id": route_id},
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
    print(get_routes_dict(ROUTES))
