import os
import subprocess
import sys
from pathlib import Path

BACKEND_PYTHON_DIR = Path(__file__).resolve().parent.parent

BASE_ENV = {
    # Minimal env for a fresh `import main` in a subprocess — a real
    # interpreter, not the already-imported module in this test session,
    # since these are module-level (import-time) guards.
    "PATH": os.environ.get("PATH", ""),
    "SystemRoot": os.environ.get("SystemRoot", ""),
    "CORS_ORIGINS": "https://app.example.com",
    "GMAIL_APP_PASSWORD": "",
    "GMAIL_SENDER_EMAIL": "tu_correo@gmail.com",
}


def run_import_main(env_overrides: dict) -> subprocess.CompletedProcess:
    env = {**BASE_ENV, **env_overrides}
    return subprocess.run(
        [sys.executable, "-c", "import main"],
        cwd=str(BACKEND_PYTHON_DIR),
        env=env,
        capture_output=True,
        text=True,
        timeout=30,
    )


def test_production_refuses_to_start_with_placeholder_jwt_secret():
    result = run_import_main({
        "ENVIRONMENT": "production",
        "JWT_SECRET": "test-jwt-secret-not-for-production-needs-32-bytes-min",
        "INTERNAL_API_SECRET": "a-real-looking-internal-secret-0123456789",
    })
    assert result.returncode != 0
    assert "JWT_SECRET placeholder value not allowed in production" in result.stderr


def test_production_refuses_to_start_with_placeholder_internal_secret():
    result = run_import_main({
        "ENVIRONMENT": "production",
        "JWT_SECRET": "a-real-looking-jwt-secret-0123456789abcdef",
        "INTERNAL_API_SECRET": "test-internal-secret-not-for-production",
    })
    assert result.returncode != 0
    assert "INTERNAL_API_SECRET placeholder value not allowed in production" in result.stderr


def test_production_starts_fine_with_non_placeholder_secrets():
    result = run_import_main({
        "ENVIRONMENT": "production",
        "JWT_SECRET": "a-real-looking-jwt-secret-0123456789abcdef",
        "INTERNAL_API_SECRET": "a-real-looking-internal-secret-0123456789",
    })
    assert result.returncode == 0, result.stderr


def test_development_allows_placeholder_secrets_unchanged():
    """El guard es solo para producción — no debe romper el flujo de dev/test
    que hoy usa valores de placeholder a propósito (ver conftest.py)."""
    result = run_import_main({
        "ENVIRONMENT": "development",
        "JWT_SECRET": "test-jwt-secret-not-for-production-needs-32-bytes-min",
        "INTERNAL_API_SECRET": "test-internal-secret-not-for-production",
        "CORS_ORIGINS": "http://localhost:3000",
    })
    assert result.returncode == 0, result.stderr
