from datetime import datetime, timedelta, timezone

import jwt as pyjwt

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


def test_login_issues_a_jwt_with_the_expected_claims(app_client, captured_otps):
    email = "jwt-claims@example.com"
    token = _login(app_client, captured_otps, email)

    claims = main_module.decode_session_jwt(token)
    assert claims["email"] == email
    assert "jti" in claims and claims["jti"]
    assert "iat" in claims and "exp" in claims

    lifetime_hours = (claims["exp"] - claims["iat"]) / 3600
    assert abs(lifetime_hours - main_module.SESSION_EXPIRY_HOURS) < 0.01


def test_auth_me_works_with_jwt_cookie(app_client, captured_otps):
    email = "jwt-me@example.com"
    token = _login(app_client, captured_otps, email)

    app_client.cookies.set("session_token", token)
    resp = app_client.get("/auth/me")
    assert resp.status_code == 200
    assert resp.json()["email"] == email


def test_refresh_issues_a_new_jwt_with_same_jti_and_extends_session(app_client, captured_otps):
    email = "jwt-refresh@example.com"
    token = _login(app_client, captured_otps, email)
    old_claims = main_module.decode_session_jwt(token)

    refresh_resp = app_client.post("/auth/refresh", json={"session_token": token})
    assert refresh_resp.status_code == 200
    new_token = refresh_resp.json()["session_token"]

    new_claims = main_module.decode_session_jwt(new_token)
    assert new_claims["jti"] == old_claims["jti"]
    assert new_claims["email"] == email
    assert new_claims["exp"] >= old_claims["exp"]

    # La cookie de la respuesta también trae el JWT nuevo.
    assert refresh_resp.cookies["session_token"] == new_token


def test_refresh_rejects_a_token_with_invalid_signature(app_client):
    forged = pyjwt.encode(
        {"email": "attacker@example.com", "jti": "forged", "iat": datetime.now(timezone.utc),
         "exp": datetime.now(timezone.utc) + timedelta(hours=1)},
        "clave-incorrecta-pero-suficientemente-larga-para-hs256", algorithm="HS256",
    )
    resp = app_client.post("/auth/refresh", json={"session_token": forged})
    assert resp.status_code == 401


def test_refresh_rejects_a_session_that_was_already_logged_out(app_client, captured_otps):
    email = "jwt-refresh-revoked@example.com"
    token = _login(app_client, captured_otps, email)

    app_client.cookies.set("session_token", token)
    logout_resp = app_client.post("/auth/logout")
    assert logout_resp.status_code == 200

    refresh_resp = app_client.post("/auth/refresh", json={"session_token": token})
    assert refresh_resp.status_code == 401


def test_refresh_rejects_missing_session_token(app_client):
    resp = app_client.post("/auth/refresh", json={})
    assert resp.status_code == 401
