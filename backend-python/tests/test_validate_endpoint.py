import db as db_module

from conftest import add_whitelisted, wait_until

# Desde el plan 09, /auth/validate es el camino LEGACY (pre-JWT): Node solo lo
# llama para cookies emitidas antes de la migración (formato token opaco).
# Las cookies nuevas (JWT) se validan localmente en Node con jwt.verify() y
# nunca llegan a este endpoint — ver test_jwt_session.py.


def test_validate_accepts_legacy_opaque_token(app_client):
    email = "validate-legacy@example.com"
    # Simula una sesión creada antes de este cambio: token opaco directo,
    # sin JWT de por medio.
    legacy_token = db_module.create_session(email)

    validate_resp = app_client.post("/auth/validate", json={"session_token": legacy_token})
    assert validate_resp.status_code == 200
    body = validate_resp.json()
    assert body["email"] == email
    assert body["valid"] is True


def test_validate_rejects_a_jwt_formatted_cookie(app_client, captured_otps):
    """Documenta el límite del camino legacy: un JWT (formato nuevo) no es un
    session_token válido para /auth/validate, porque auth_sessions ahora
    guarda el jti como PK, no el JWT completo. Node nunca llama a este
    endpoint para cookies JWT de todos modos."""
    email = "validate-jwt-boundary@example.com"
    add_whitelisted(email)

    resp = app_client.post("/auth/otp-request", json={"email": email})
    assert resp.status_code == 202
    assert wait_until(lambda: len(captured_otps) == 1)
    _, otp_code = captured_otps[0]

    verify_resp = app_client.post(
        "/auth/otp-verify", json={"email": email, "otp": otp_code}
    )
    jwt_token = verify_resp.cookies["session_token"]

    validate_resp = app_client.post("/auth/validate", json={"session_token": jwt_token})
    assert validate_resp.status_code == 401


def test_validate_rejects_invalid_token(app_client):
    resp = app_client.post(
        "/auth/validate", json={"session_token": "not-a-real-token"}
    )
    assert resp.status_code == 401


def test_validate_rejects_missing_token(app_client):
    resp = app_client.post("/auth/validate", json={})
    assert resp.status_code == 401
