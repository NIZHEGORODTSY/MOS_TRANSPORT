import os
from pathlib import Path

import psycopg

ENV_FILE = Path(__file__).resolve().parents[1] / ".env"
print(ENV_FILE)


def _load_env() -> None:
    """Puts backend/.env into os.environ; real environment variables win. psycopg reads PGHOST, PGPORT, etc."""
    if not ENV_FILE.exists():
        return
    for line in ENV_FILE.read_text(encoding="utf-8").splitlines():
        key, sep, value = line.partition("=")
        key = key.strip()
        if sep and key and not key.startswith("#"):
            os.environ.setdefault(key, value.strip())


def connect() -> psycopg.Connection:
    _load_env()
    try:
        return psycopg.connect(connect_timeout=10)
    except psycopg.OperationalError as e:
        target = f"{os.environ.get('PGHOST')}:{os.environ.get('PGPORT')}/{os.environ.get('PGDATABASE')}"
        raise RuntimeError(
            f"Cannot connect to PostgreSQL at {target}. Is the SSH tunnel running and backend/.env filled in? {e}"
        ) from e
