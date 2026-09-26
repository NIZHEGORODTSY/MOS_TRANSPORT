import os
from idlelib import query
from pathlib import Path

import psycopg
from psycopg import sql
from psycopg.rows import dict_row

ENV_FILE = Path(__file__).resolve().parents[1] / ".env"


def _load_env() -> None:
    for line in ENV_FILE.read_text(encoding="utf-8").splitlines():
        key, sep, value = line.partition("=")
        if sep and key.strip():
            os.environ.setdefault(key.strip(), value.strip())


def connect() -> psycopg.Connection:
    _load_env()
    return psycopg.connect(os.environ["DATABASE_URL"], connect_timeout=10)


def get_stops(tr_id: int = 122048):

    table = sql.Identifier(f"schedule_plan_tr_{int(tr_id)}_street_loop")
    query = sql.SQL("SELECT * FROM {}").format(table)
    with connect() as conn:
        with conn.cursor() as cur:
            cur.execute(query)
            rows = cur.fetchall()
    return [[r[7], r[8]] for r in rows]

def get_password(username: str) -> str | None:
    with connect() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT password_hash FROM operators WHERE username = %s",
                (username,),
            )
            row = cur.fetchone()
    return row[0] if row else None




