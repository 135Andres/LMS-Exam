from datetime import datetime, timedelta, timezone

import db as db_module

# Regresión para el bug encontrado en los planes 07 y 09: expires_at se
# guardaba con datetime.isoformat() ('...THH:MM:SS...'), y SQLite's
# datetime('now') usa un espacio en vez de 'T'. Como 'T' (0x54) > ' ' (0x20)
# en ASCII, "expires_at > datetime('now')" resultaba casi siempre verdadero
# para filas del mismo día calendario, sin importar la hora real — el filtro
# SQL nunca excluía nada vencido.
#
# Estos tests llaman DIRECTO a la capa de datos (get_otp / validate_session /
# touch_session), sin pasar por los endpoints. Es deliberado: otp_verify()
# en main.py tiene un segundo chequeo de expiración en Python que
# compensaba el bug para OTP — un test que solo pase por el endpoint
# seguiría en verde aunque el filtro SQL siguiera roto. Para sesiones NO
# existe ningún chequeo compensatorio en main.py (confirmado por búsqueda
# exhaustiva: validate_session()/touch_session() se usan tal cual, sin
# comparar expires_at de nuevo en Python) — así que antes de este fix, una
# sesión con fila vencida el mismo día calendario UTC nunca expiraba
# realmente vía este camino.


def test_format_expiry_matches_sqlite_now_format():
    formatted = db_module.format_expiry(datetime.now(timezone.utc))
    assert "T" not in formatted
    assert " " in formatted
    # Mismo formato que devuelve datetime('now') de SQLite.
    conn = db_module.get_conn()
    sqlite_now = conn.execute("SELECT datetime('now')").fetchone()[0]
    assert len(formatted) == len(sqlite_now)


def test_format_expiry_and_parse_expiry_roundtrip():
    now = datetime.now(timezone.utc).replace(microsecond=0)
    formatted = db_module.format_expiry(now)
    parsed = db_module.parse_expiry(formatted)
    assert parsed == now


def test_get_otp_sql_filter_excludes_an_already_expired_row(temp_db):
    email = "expired-otp@example.com"
    salt = b"0123456789abcdef"
    db_module.store_otp(
        email, "somehash", salt,
        datetime.now(timezone.utc) - timedelta(minutes=1),
    )

    # Antes del fix, esto devolvía la fila igual (el filtro SQL no la excluía
    # dentro del mismo día calendario UTC).
    assert db_module.get_otp(email) is None


def test_get_otp_sql_filter_still_returns_a_non_expired_row(temp_db):
    email = "valid-otp@example.com"
    salt = b"0123456789abcdef"
    db_module.store_otp(
        email, "somehash", salt,
        datetime.now(timezone.utc) + timedelta(minutes=5),
    )

    record = db_module.get_otp(email)
    assert record is not None
    assert record["email"] == email


def test_validate_session_sql_filter_excludes_an_already_expired_session(temp_db):
    token = db_module.create_session("expired-session@example.com")
    conn = db_module.get_conn()
    expired = db_module.format_expiry(datetime.now(timezone.utc) - timedelta(minutes=1))
    conn.execute("UPDATE auth_sessions SET expires_at = ? WHERE session_token = ?", (expired, token))
    conn.commit()

    # Este es el hallazgo más serio: antes del fix, una sesión vencida el
    # mismo día calendario UTC seguía siendo "válida" para validate_session()
    # porque no hay ningún chequeo compensatorio en Python para sesiones
    # (a diferencia de OTP, que sí lo tiene en otp_verify).
    assert db_module.validate_session(token) is None


def test_validate_session_sql_filter_still_returns_a_non_expired_session(temp_db):
    token = db_module.create_session("valid-session@example.com")
    session = db_module.validate_session(token)
    assert session is not None
    assert session["email"] == "valid-session@example.com"


def test_touch_session_sql_filter_refuses_to_extend_an_already_expired_session(temp_db):
    token = db_module.create_session("expired-touch@example.com")
    conn = db_module.get_conn()
    expired = db_module.format_expiry(datetime.now(timezone.utc) - timedelta(minutes=1))
    conn.execute("UPDATE auth_sessions SET expires_at = ? WHERE session_token = ?", (expired, token))
    conn.commit()

    assert db_module.touch_session(token) is False
    # Y no la revivió de paso.
    assert db_module.validate_session(token) is None


def test_touch_session_sql_filter_extends_a_still_valid_session(temp_db):
    token = db_module.create_session("valid-touch@example.com")
    assert db_module.touch_session(token) is True
    assert db_module.validate_session(token) is not None
