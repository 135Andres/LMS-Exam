import inspect

import main as main_module


def test_hash_otp_is_deterministic_and_salt_sensitive():
    salt_a = b"a" * 16
    salt_b = b"b" * 16

    hash1 = main_module.hash_otp("123456", salt_a)
    hash2 = main_module.hash_otp("123456", salt_a)
    hash3 = main_module.hash_otp("123456", salt_b)

    assert hash1 == hash2
    assert hash1 != hash3


def test_otp_verify_uses_constant_time_comparison():
    source = inspect.getsource(main_module.otp_verify)
    assert "secrets.compare_digest" in source
    # No debe compararse el hash con el operador == (filtración por timing).
    assert "computed_hash == stored_hash" not in source
    assert "computed_hash != stored_hash" not in source


def test_dummy_hmac_runs_same_primitives_as_real_hash():
    dummy_source = inspect.getsource(main_module.compute_dummy_hmac)
    assert "hmac.new" in dummy_source
    assert "hashlib.sha256" in dummy_source
