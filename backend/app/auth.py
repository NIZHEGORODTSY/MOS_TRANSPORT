import bcrypt

from db import connect, get_password

MAX_PASSWORD_BYTES = 72


def _prepare(password: str) -> bytes:
    return password.encode("utf-8")[:MAX_PASSWORD_BYTES]


def hash_password(password: str) -> str:
    return bcrypt.hashpw(_prepare(password), bcrypt.gensalt()).decode("ascii")


def verify_password(password: str, password_hash: str) -> bool:
    try:
        return bcrypt.checkpw(_prepare(password), password_hash.encode("ascii"))
    except (ValueError, UnicodeEncodeError):
        return False


def create_admin(username: str, password: str) -> int:
    with connect() as conn:
        with conn.cursor() as cur:
            try:
                cur.execute(
                    "INSERT INTO admins (username, password_hash) "
                    "VALUES (%s, %s) RETURNING id",
                    (username, hash_password(password)),
                )
                admin_id = cur.fetchone()[0]
                conn.commit()
                return admin_id
            except Exception as e:
                conn.rollback()
                if "unique" in str(e).lower():
                    raise ValueError(f"Логин {username!r} уже занят") from e
                raise


def authenticate(username: str, password: str) -> bool:
    pwd_hash = get_password(username)
    if pwd_hash is None:
        return False
    return verify_password(password, pwd_hash)


