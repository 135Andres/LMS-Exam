import main as main_module

from conftest import add_whitelisted, wait_until


def _create_session_via_otp(app_client, captured_otps, email):
    add_whitelisted(email)
    resp = app_client.post("/auth/otp-request", json={"email": email})
    assert resp.status_code == 202
    assert wait_until(lambda: len(captured_otps) == 1)
    _, otp_code = captured_otps[0]
    return app_client.post("/auth/otp-verify", json={"email": email, "otp": otp_code})


def test_session_cookie_flags_in_development(app_client, captured_otps):
    verify_resp = _create_session_via_otp(
        app_client, captured_otps, "cookie-dev@example.com"
    )
    assert verify_resp.status_code == 200

    set_cookie = verify_resp.headers.get("set-cookie", "")
    assert "session_token=" in set_cookie
    assert "httponly" in set_cookie.lower()
    assert "samesite=lax" in set_cookie.lower()
    # En development COOKIE_SECURE es False: no debe llevar el atributo Secure.
    assert "secure" not in set_cookie.lower()


def test_session_cookie_is_secure_in_production(app_client, captured_otps, monkeypatch):
    monkeypatch.setattr(main_module, "COOKIE_SECURE", True)

    verify_resp = _create_session_via_otp(
        app_client, captured_otps, "cookie-prod@example.com"
    )
    assert verify_resp.status_code == 200

    set_cookie = verify_resp.headers.get("set-cookie", "")
    assert "httponly" in set_cookie.lower()
    assert "secure" in set_cookie.lower()
    assert "samesite=lax" in set_cookie.lower()


def test_logout_clears_session_cookie(app_client, captured_otps):
    verify_resp = _create_session_via_otp(
        app_client, captured_otps, "cookie-logout@example.com"
    )
    assert verify_resp.status_code == 200
    token = verify_resp.cookies["session_token"]

    app_client.cookies.set("session_token", token)
    logout_resp = app_client.post("/auth/logout")
    assert logout_resp.status_code == 200

    set_cookie = logout_resp.headers.get("set-cookie", "")
    assert "session_token=" in set_cookie
    assert "httponly" in set_cookie.lower()
