import os
import secrets
import sqlite3
import threading
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
from pathlib import Path

DB_PATH = Path(os.getenv("AUTH_DB_PATH", str(Path(__file__).parent / "data" / "auth.sqlite")))
DB_PATH.parent.mkdir(exist_ok=True)

_local = threading.local()

def get_conn() -> sqlite3.Connection:
    if not hasattr(_local, "conn"):
        _local.conn = sqlite3.connect(str(DB_PATH), check_same_thread=False)
        _local.conn.row_factory = sqlite3.Row
        _local.conn.execute("PRAGMA journal_mode=WAL")
        _local.conn.execute("PRAGMA foreign_keys=ON")
        _local.conn.execute("PRAGMA busy_timeout=5000")
    return _local.conn

@contextmanager
def transaction():
    conn = get_conn()
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise

SESSION_EXPIRY_HOURS = int(os.getenv("SESSION_EXPIRY_HOURS", "24"))
OTP_EXPIRY_MINUTES = int(os.getenv("OTP_EXPIRY_MINUTES", "5"))
IP_RATE_LIMIT = int(os.getenv("IP_RATE_LIMIT", "5"))
IP_RATE_WINDOW_HOURS = int(os.getenv("IP_RATE_WINDOW_HOURS", "1"))

SCHEMA_SQL = """
CREATE TABLE IF NOT EXISTS auth_otp_codes (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  code_hash TEXT NOT NULL,
  salt BLOB NOT NULL,
  attempts INTEGER DEFAULT 0,
  expires_at TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_otp_email ON auth_otp_codes(email);
CREATE INDEX IF NOT EXISTS idx_otp_expires ON auth_otp_codes(expires_at);

CREATE TABLE IF NOT EXISTS auth_sessions (
  session_token TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now')),
  expires_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_session_expires ON auth_sessions(expires_at);
CREATE INDEX IF NOT EXISTS idx_session_email ON auth_sessions(email);

CREATE TABLE IF NOT EXISTS auth_ip_rate_limits (
  id TEXT PRIMARY KEY,
  ip TEXT NOT NULL,
  request_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_iprl_ip_time ON auth_ip_rate_limits(ip, request_at);

CREATE TABLE IF NOT EXISTS auth_whitelist (
  email TEXT PRIMARY KEY,
  added_by TEXT,
  added_at TEXT DEFAULT (datetime('now'))
);
"""

def init_db():
    with transaction() as conn:
        conn.executescript(SCHEMA_SQL)
    print(f"[DB] Auth database initialized at {DB_PATH}")

def store_otp(email: str, code_hash: str, salt: bytes, expires_at: datetime):
    with transaction() as conn:
        conn.execute("DELETE FROM auth_otp_codes WHERE email = ?", (email,))
        conn.execute("""
            INSERT INTO auth_otp_codes (id, email, code_hash, salt, expires_at)
            VALUES (?, ?, ?, ?, ?)
        """, (secrets.token_urlsafe(16), email, code_hash, salt, expires_at.isoformat()))

def get_otp(email: str) -> dict | None:
    conn = get_conn()
    row = conn.execute("""
        SELECT * FROM auth_otp_codes
        WHERE email = ? AND expires_at > datetime('now')
        ORDER BY created_at DESC LIMIT 1
    """, (email,)).fetchone()
    return dict(row) if row else None

def increment_otp_attempts(email: str) -> int:
    with transaction() as conn:
        conn.execute(
            "UPDATE auth_otp_codes SET attempts = attempts + 1 WHERE email = ? AND expires_at > datetime('now')",
            (email,)
        )
        row = conn.execute(
            "SELECT attempts FROM auth_otp_codes WHERE email = ? AND expires_at > datetime('now') ORDER BY created_at DESC LIMIT 1",
            (email,)
        ).fetchone()
        return row["attempts"] if row else 0

def delete_otp(email: str):
    with transaction() as conn:
        conn.execute("DELETE FROM auth_otp_codes WHERE email = ?", (email,))

def create_session(email: str) -> str:
    token = secrets.token_urlsafe(32)
    expires = (datetime.now(timezone.utc) + timedelta(hours=SESSION_EXPIRY_HOURS)).isoformat()
    with transaction() as conn:
        conn.execute("""
            INSERT INTO auth_sessions (session_token, email, expires_at)
            VALUES (?, ?, ?)
        """, (token, email, expires))
    return token

def validate_session(token: str) -> dict | None:
    conn = get_conn()
    row = conn.execute("""
        SELECT email, expires_at FROM auth_sessions
        WHERE session_token = ? AND expires_at > datetime('now')
    """, (token,)).fetchone()
    return dict(row) if row else None

def delete_session(token: str):
    with transaction() as conn:
        conn.execute("DELETE FROM auth_sessions WHERE session_token = ?", (token,))

def check_ip_rate_limit(ip: str) -> bool:
    now = datetime.now(timezone.utc)
    window_start = (now - timedelta(hours=IP_RATE_WINDOW_HOURS)).isoformat()
    with transaction() as conn:
        conn.execute("DELETE FROM auth_ip_rate_limits WHERE request_at < ?", (window_start,))
        count = conn.execute(
            "SELECT COUNT(*) as c FROM auth_ip_rate_limits WHERE ip = ?",
            (ip,)
        ).fetchone()["c"]
        if count >= IP_RATE_LIMIT:
            return False
        conn.execute(
            "INSERT INTO auth_ip_rate_limits (id, ip, request_at) VALUES (?, ?, ?)",
            (secrets.token_urlsafe(16), ip, now.isoformat())
        )
        return True

def is_whitelisted(email: str) -> bool:
    conn = get_conn()
    row = conn.execute("SELECT 1 FROM auth_whitelist WHERE email = ?", (email,)).fetchone()
    return row is not None

def add_to_whitelist(email: str, added_by: str = "admin"):
    with transaction() as conn:
        conn.execute("INSERT OR IGNORE INTO auth_whitelist (email, added_by) VALUES (?, ?)", (email, added_by))

def remove_from_whitelist(email: str):
    with transaction() as conn:
        conn.execute("DELETE FROM auth_whitelist WHERE email = ?", (email,))

def get_whitelist() -> set[str]:
    conn = get_conn()
    rows = conn.execute("SELECT email FROM auth_whitelist").fetchall()
    return {row["email"] for row in rows}

def cleanup_expired():
    with transaction() as conn:
        conn.execute("DELETE FROM auth_otp_codes WHERE expires_at < datetime('now')")
        conn.execute("DELETE FROM auth_sessions WHERE expires_at < datetime('now')")
        old = (datetime.now(timezone.utc) - timedelta(hours=IP_RATE_WINDOW_HOURS * 2)).isoformat()
        conn.execute("DELETE FROM auth_ip_rate_limits WHERE request_at < ?", (old,))
