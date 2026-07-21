from datetime import datetime, timedelta, timezone

import db as db_module
import main as main_module

from conftest import add_whitelisted, wait_until


def test_happy_path_otp_flow(app_client, captured_otps):
    email = "student@example.com"
    add_whitelisted(email)

    resp = app_client.post("/auth/otp-request", json={"email": email})
    assert resp.status_code == 202

    assert wait_until(lambda: len(captured_otps) == 1)
    sent_email, otp_code = captured_otps[0]
    assert sent_email == email

    verify_resp = app_client.post(
        "/auth/otp-verify", json={"email": email, "otp": otp_code}
    )
    assert verify_resp.status_code == 200
    assert verify_resp.json()["email"] == email
    assert "session_token" in verify_resp.cookies

    # Desde el plan 09, la cookie es un JWT (3 segmentos), no un token opaco.
    token = verify_resp.cookies["session_token"]
    assert token.count(".") == 2

    claims = main_module.decode_session_jwt(token)
    assert claims is not None
    assert claims["email"] == email

    session = db_module.validate_session(claims["jti"])
    assert session is not None
    assert session["email"] == email

    # El código se consume: no debe quedar reutilizable.
    assert db_module.get_otp(email) is None


def test_wrong_otp_is_rejected_without_creating_session(app_client, captured_otps):
    email = "student2@example.com"
    add_whitelisted(email)

    resp = app_client.post("/auth/otp-request", json={"email": email})
    assert resp.status_code == 202
    assert wait_until(lambda: len(captured_otps) == 1)

    verify_resp = app_client.post(
        "/auth/otp-verify", json={"email": email, "otp": "000000"}
    )
    assert verify_resp.status_code == 401
    assert "session_token" not in verify_resp.cookies


def test_expired_otp_is_rejected(app_client):
    email = "student3@example.com"
    add_whitelisted(email)

    salt = b"0123456789abcdef"
    otp_code = "123456"
    otp_hash = main_module.hash_otp(otp_code, salt)
    # expires_at ya vencido. El filtro SQL de get_otp() ya excluye esta fila
    # directamente (ver tests/test_expiry_sql_fix.py); este test cubre el
    # comportamiento end-to-end del endpoint, no el filtro en sí.
    db_module.store_otp(
        email,
        otp_hash,
        salt,
        datetime.now(timezone.utc) - timedelta(minutes=1),
    )

    verify_resp = app_client.post(
        "/auth/otp-verify", json={"email": email, "otp": otp_code}
    )
    assert verify_resp.status_code == 401
    assert "expirado" in verify_resp.json()["detail"].lower()
    assert "session_token" not in verify_resp.cookies


def test_non_whitelisted_email_gets_indistinguishable_response(
    app_client, captured_otps, monkeypatch
):
    dummy_calls = []
    monkeypatch.setattr(
        main_module,
        "compute_dummy_hmac",
        lambda: dummy_calls.append(1) or "deadbeef",
    )

    whitelisted = "member@example.com"
    stranger = "outsider@example.com"
    add_whitelisted(whitelisted)

    resp_member = app_client.post("/auth/otp-request", json={"email": whitelisted})
    resp_stranger = app_client.post("/auth/otp-request", json={"email": stranger})

    assert resp_member.status_code == resp_stranger.status_code == 202
    assert resp_member.json() == resp_stranger.json()

    assert wait_until(lambda: len(captured_otps) == 1 and len(dummy_calls) == 1)
    assert captured_otps[0][0] == whitelisted
    assert db_module.get_otp(stranger) is None


def test_ip_rate_limit_blocks_after_threshold(temp_db, monkeypatch):
    monkeypatch.setattr(db_module, "IP_RATE_LIMIT", 2)
    ip = "203.0.113.5"

    assert db_module.check_ip_rate_limit(ip) is True
    assert db_module.check_ip_rate_limit(ip) is True
    assert db_module.check_ip_rate_limit(ip) is False


def test_otp_verify_enforces_max_attempts(app_client, captured_otps):
    email = "student4@example.com"
    add_whitelisted(email)

    resp = app_client.post("/auth/otp-request", json={"email": email})
    assert resp.status_code == 202
    assert wait_until(lambda: len(captured_otps) == 1)

    last_resp = None
    for _ in range(main_module.MAX_OTP_ATTEMPTS):
        last_resp = app_client.post(
            "/auth/otp-verify", json={"email": email, "otp": "000000"}
        )

    assert last_resp.status_code == 429
    # El código fue invalidado tras agotar los intentos.
    assert db_module.get_otp(email) is None
