import httpx

import db as db_module
import main as main_module

from conftest import add_whitelisted, wait_until


def _login(app_client, captured_otps, email):
    add_whitelisted(email)
    resp = app_client.post("/auth/otp-request", json={"email": email})
    assert resp.status_code == 202
    assert wait_until(lambda: len(captured_otps) == 1)
    _, otp_code = captured_otps[0]
    verify_resp = app_client.post(
        "/auth/otp-verify", json={"email": email, "otp": otp_code}
    )
    assert verify_resp.status_code == 200
    return verify_resp.cookies["session_token"]


def test_logout_deletes_local_session_and_session_stops_working(app_client, captured_otps):
    token = _login(app_client, captured_otps, "logout-basic@example.com")
    claims = main_module.decode_session_jwt(token)
    jti = claims["jti"]
    assert db_module.validate_session(jti) is not None

    app_client.cookies.set("session_token", token)
    logout_resp = app_client.post("/auth/logout")
    assert logout_resp.status_code == 200

    assert db_module.validate_session(jti) is None
    # Y /auth/refresh (que sí consulta la fila server-side) ya no la revive.
    refresh_resp = app_client.post("/auth/refresh", json={"session_token": token})
    assert refresh_resp.status_code == 401


def test_logout_notifies_node_with_correct_jti_exp_and_secret_header(app_client, captured_otps, monkeypatch):
    token = _login(app_client, captured_otps, "logout-notify@example.com")
    claims = main_module.decode_session_jwt(token)

    calls = []

    def fake_post(url, json=None, headers=None, timeout=None):
        calls.append({"url": url, "json": json, "headers": headers, "timeout": timeout})
        return httpx.Response(200, json={"revoked": True})

    monkeypatch.setattr(main_module.httpx, "post", fake_post)

    app_client.cookies.set("session_token", token)
    logout_resp = app_client.post("/auth/logout")
    assert logout_resp.status_code == 200

    assert len(calls) == 1
    call = calls[0]
    assert call["url"] == f"{main_module.NODE_SERVICE_URL}/internal/session/invalidate"
    assert call["json"]["jti"] == claims["jti"]
    assert call["json"]["exp"] == claims["exp"]
    assert call["headers"]["X-Internal-Secret"] == main_module.INTERNAL_API_SECRET


def test_logout_completes_even_if_node_call_fails_or_times_out(app_client, captured_otps, monkeypatch):
    token = _login(app_client, captured_otps, "logout-node-down@example.com")

    def fake_post_raises(*args, **kwargs):
        raise httpx.ConnectTimeout("Node no responde")

    monkeypatch.setattr(main_module.httpx, "post", fake_post_raises)

    app_client.cookies.set("session_token", token)
    logout_resp = app_client.post("/auth/logout")

    # El logout local (borrar la sesión propia) no depende de que Node
    # responda — es la garantía de "no bloqueante" descrita en el plan 09.
    assert logout_resp.status_code == 200
    claims = main_module.decode_session_jwt(token)
    assert db_module.validate_session(claims["jti"]) is None


def test_logout_with_legacy_opaque_cookie_still_works(app_client):
    """Durante la migración, un cliente que todavía tiene una cookie del
    formato viejo debe poder cerrar sesión normalmente (sin intentar
    decodificarla como JWT ni notificar a Node)."""
    email = "logout-legacy@example.com"
    legacy_token = db_module.create_session(email)
    assert db_module.validate_session(legacy_token) is not None

    app_client.cookies.set("session_token", legacy_token)
    logout_resp = app_client.post("/auth/logout")
    assert logout_resp.status_code == 200
    assert db_module.validate_session(legacy_token) is None


def test_logout_without_cookie_still_returns_200(app_client):
    logout_resp = app_client.post("/auth/logout")
    assert logout_resp.status_code == 200
