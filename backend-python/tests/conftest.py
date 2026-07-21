import os
import sys
import time
from pathlib import Path

import pytest

# Deben fijarse antes de importar main/db: ambos módulos leen el entorno a
# nivel de módulo. GMAIL_APP_PASSWORD vacío + sender por defecto garantizan
# que transmit_otp_email nunca intente un login SMTP real, incluso si el
# .env local del desarrollador trae credenciales reales.
os.environ["ENVIRONMENT"] = "development"
os.environ["GMAIL_APP_PASSWORD"] = ""
os.environ["GMAIL_SENDER_EMAIL"] = "tu_correo@gmail.com"
os.environ["IP_RATE_LIMIT"] = "100000"
os.environ["CORS_ORIGINS"] = "http://localhost:3000"
os.environ.setdefault("JWT_SECRET", "test-jwt-secret-not-for-production-needs-32-bytes-min")
os.environ.setdefault("INTERNAL_API_SECRET", "test-internal-secret-not-for-production")
os.environ.setdefault("NODE_SERVICE_URL", "http://localhost:3000")

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import db as db_module  # noqa: E402
import main as main_module  # noqa: E402

from starlette.testclient import TestClient  # noqa: E402


@pytest.fixture()
def temp_db(tmp_path, monkeypatch):
    """Aísla cada test en su propio archivo sqlite."""
    db_path = tmp_path / "auth_test.sqlite"
    monkeypatch.setattr(db_module, "DB_PATH", db_path)
    if hasattr(db_module._local, "conn"):
        db_module._local.conn.close()
        del db_module._local.conn
    db_module.init_db()
    yield db_module
    if hasattr(db_module._local, "conn"):
        db_module._local.conn.close()
        del db_module._local.conn


@pytest.fixture()
def captured_otps(monkeypatch):
    """Reemplaza el envío real de OTP por una captura en memoria."""
    sent = []

    def fake_transmit(email: str, otp_code: str):
        sent.append((email, otp_code))

    monkeypatch.setattr(main_module, "transmit_otp_email", fake_transmit)
    return sent


@pytest.fixture()
def app_client(temp_db, monkeypatch):
    monkeypatch.setattr(main_module, "whitelist_emails", set())
    with TestClient(main_module.app) as client:
        yield client


def add_whitelisted(email: str):
    db_module.add_to_whitelist(email)
    main_module.load_whitelist()


def wait_until(predicate, timeout: float = 2.0, interval: float = 0.02):
    deadline = time.time() + timeout
    while time.time() < deadline:
        if predicate():
            return True
        time.sleep(interval)
    return predicate()
