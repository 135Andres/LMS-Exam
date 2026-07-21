import asyncio
import hashlib
import hmac
import json
import os
import secrets
import smtplib
import ssl
import threading
from datetime import datetime, timedelta, timezone
from email.mime.text import MIMEText
from typing import Optional

import httpx
import jwt as pyjwt
from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel, field_validator
from dotenv import load_dotenv
from db import (
    init_db, store_otp, get_otp, increment_otp_attempts, delete_otp,
    create_session as db_create_session, validate_session as db_validate_session,
    delete_session as db_delete_session, touch_session as db_touch_session,
    check_ip_rate_limit, is_whitelisted, get_whitelist, cleanup_expired,
    parse_expiry,
)

# ---------------------------------------------------------------------------
# Config from environment
# ---------------------------------------------------------------------------
load_dotenv()
GMAIL_SENDER_EMAIL = os.getenv("GMAIL_SENDER_EMAIL", "tu_correo@gmail.com")
GMAIL_APP_PASSWORD = os.getenv("GMAIL_APP_PASSWORD", "")
PORT = int(os.getenv("PORT", "3001"))
ENVIRONMENT = os.getenv("ENVIRONMENT", "development")
COOKIE_SECURE = ENVIRONMENT == "production"
CORS_ORIGINS_RAW = os.getenv("CORS_ORIGINS", "http://localhost:3000")
CORS_ORIGINS = [o.strip() for o in CORS_ORIGINS_RAW.split(",") if o.strip()]

if ENVIRONMENT == "production" and ("*" in CORS_ORIGINS or not CORS_ORIGINS):
    print("[CONFIG] ERROR: CORS_ORIGINS no puede ser '*' en producción. Especifica dominios.")
    raise RuntimeError("CORS configuration invalid for production")
TRUST_PROXY = os.getenv("TRUST_PROXY", "false").lower() == "true"

# Compartido con backend/ (Node) — firma/verifica los JWT de sesión. Debe ser
# idéntico en ambos servicios; nunca hardcodear, rotar como cualquier secreto.
JWT_SECRET = os.getenv("JWT_SECRET", "")
if not JWT_SECRET:
    raise RuntimeError("JWT_SECRET no configurado — requerido para firmar sesiones (plan 09).")
JWT_ALGORITHM = "HS256"
JWT_CLOCK_LEEWAY_SECONDS = 30  # tolerancia a reloj desincronizado entre Node y Python

# Compartido con backend/ (Node) — autentica la llamada saliente a
# POST /internal/session/invalidate en /auth/logout. Deliberadamente distinto
# de JWT_SECRET (ver nota equivalente en backend/src/config/index.ts): si este
# se filtra, el radio de explosión se limita a poder invalidar sesiones ajenas,
# no a poder forjar JWTs.
INTERNAL_API_SECRET = os.getenv("INTERNAL_API_SECRET", "")
if not INTERNAL_API_SECRET:
    raise RuntimeError("INTERNAL_API_SECRET no configurado — requerido para notificar revocación a Node (plan 09).")

# Valores de placeholder/dev usados en tests y documentación (ver
# tests/conftest.py y backend/test/setup.ts) — si alguno de estos termina
# copiado tal cual a un .env de producción, JWT_SECRET/INTERNAL_API_SECRET
# quedarían adivinables. Mismo patrón que el guard de CORS de arriba: falla
# el arranque en vez de arrancar con un secreto conocido públicamente.
_PLACEHOLDER_SECRETS = {
    "test-jwt-secret-not-for-production-needs-32-bytes-min",
    "test-internal-secret-not-for-production",
    "changeme", "change-me", "secret", "placeholder", "your-secret-here",
}
if ENVIRONMENT == "production":
    if JWT_SECRET in _PLACEHOLDER_SECRETS:
        print("[CONFIG] ERROR: JWT_SECRET sigue en un valor de placeholder/test. No se puede arrancar en producción con este valor.")
        raise RuntimeError("JWT_SECRET placeholder value not allowed in production")
    if INTERNAL_API_SECRET in _PLACEHOLDER_SECRETS:
        print("[CONFIG] ERROR: INTERNAL_API_SECRET sigue en un valor de placeholder/test. No se puede arrancar en producción con este valor.")
        raise RuntimeError("INTERNAL_API_SECRET placeholder value not allowed in production")

# Base URL del backend Node, para la notificación de revocación en logout.
NODE_SERVICE_URL = os.getenv("NODE_SERVICE_URL", "http://localhost:3000")
NODE_INTERNAL_CALL_TIMEOUT_SECONDS = 2.0

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------
OTP_EXPIRY_MINUTES = 5
OTP_LENGTH = 6
MAX_OTP_ATTEMPTS = 3
SESSION_EXPIRY_HOURS = 24
IP_RATE_LIMIT = int(os.getenv("IP_RATE_LIMIT", "5"))
IP_RATE_WINDOW_HOURS = int(os.getenv("IP_RATE_WINDOW_HOURS", "1"))
WHITELIST_REFRESH_SECONDS = 60
CLEANUP_INTERVAL_SECONDS = 60

# Cuentas exentas del rate limit por IP (uso: pruebas internas/QA).
# El rate limit es por IP, no por cuenta — sin esto, cualquier cuenta probada
# repetidamente desde la misma máquina se bloquea sin importar el email.
RATE_LIMIT_EXEMPT_EMAILS = {
    e.strip().lower()
    for e in os.getenv("RATE_LIMIT_EXEMPT_EMAILS", "admin@lmsexam.com").split(",")
    if e.strip()
}

SESSION_COOKIE_NAME = "session_token"

# Cuentas que jamás disparan un envío SMTP real — el OTP solo se imprime en
# consola. Evita tráfico saliente para cuentas de prueba/admin.
NO_SMTP_EMAILS = {
    e.strip().lower()
    for e in os.getenv("NO_SMTP_EMAILS", "admin@lmsexam.com").split(",")
    if e.strip()
}

# ---------------------------------------------------------------------------
# In-memory stores
# ---------------------------------------------------------------------------
whitelist_emails: set[str] = set()
_whitelist_lock = threading.Lock()

# ---------------------------------------------------------------------------
# Whitelist loader
# ---------------------------------------------------------------------------
def load_whitelist():
    global whitelist_emails
    try:
        with _whitelist_lock:
            whitelist_emails = get_whitelist()
    except Exception:
        pass

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
def extract_real_client_ip(request: Request) -> str:
    if TRUST_PROXY:
        cf_ip = request.headers.get("CF-Connecting-IP")
        if cf_ip:
            return cf_ip.strip()
        xff = request.headers.get("X-Forwarded-For")
        if xff:
            return xff.split(",")[0].strip()
    return request.client.host if request.client else "127.0.0.1"

def apply_ip_rate_limit(client_ip: str) -> bool:
    allowed = check_ip_rate_limit(client_ip)
    if not allowed:
        print(f"[WARN] Rate limit exceeded for IP: {client_ip}", flush=True)
    return allowed

def generate_otp() -> str:
    return f"{secrets.randbelow(10**OTP_LENGTH):0{OTP_LENGTH}d}"

def hash_otp(otp: str, salt: bytes) -> str:
    return hmac.new(salt, otp.encode("utf-8"), hashlib.sha256).hexdigest()

def compute_dummy_hmac() -> str:
    dummy_salt = secrets.token_bytes(16)
    dummy_code = secrets.token_hex(6)
    return hmac.new(dummy_salt, dummy_code.encode("utf-8"), hashlib.sha256).hexdigest()

def is_email_authorized(email: str) -> bool:
    with _whitelist_lock:
        return email in whitelist_emails

def transmit_otp_email(email: str, otp_code: str):
    # Console fallback para desarrollo (visible en terminal Python)
    print(f"\n=== OTP para {email}: {otp_code} ===\n", flush=True)

    if email.strip().lower() in NO_SMTP_EMAILS:
        print(f"[NO-SMTP] {email} está en NO_SMTP_EMAILS, no se envía correo real.", flush=True)
        return

    if GMAIL_APP_PASSWORD == "" or GMAIL_SENDER_EMAIL == "tu_correo@gmail.com":
        print(f"[DEV] SMTP no configurado. OTP: {otp_code}", flush=True)
        return

    msg = MIMEText(
        f"Tu código de acceso de un solo uso es: {otp_code}\n\n"
        f"Este código es válido por {OTP_EXPIRY_MINUTES} minutos.\n"
        "Si no solicitaste este código, ignora este mensaje.",
        "plain", "utf-8"
    )
    msg["Subject"] = "Tu código de acceso - LMS Exam"
    msg["From"] = GMAIL_SENDER_EMAIL
    msg["To"] = email

    context = ssl.create_default_context()
    with smtplib.SMTP("smtp.gmail.com", 587, timeout=10) as server:
        server.ehlo()
        server.starttls(context=context)
        server.ehlo()
        server.login(GMAIL_SENDER_EMAIL, GMAIL_APP_PASSWORD)
        server.sendmail(GMAIL_SENDER_EMAIL, [email], msg.as_string())
        print(f"[SMTP] OTP enviado a {email}", flush=True)

def create_session(email: str) -> str:
    return db_create_session(email)

def sign_session_jwt(email: str, jti: str) -> str:
    """Firma el JWT de sesión de corta duración que reemplaza el token opaco
    como valor de la cookie. `jti` es el mismo id usado como PK en
    auth_sessions — así logout/refresh pueden ubicar la fila server-side sin
    un segundo mecanismo de mapeo."""
    now = datetime.now(timezone.utc)
    payload = {
        "email": email,
        "jti": jti,
        "iat": now,
        "exp": now + timedelta(hours=SESSION_EXPIRY_HOURS),
    }
    return pyjwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)

def decode_session_jwt(token: str, verify_exp: bool = True) -> Optional[dict]:
    try:
        return pyjwt.decode(
            token, JWT_SECRET, algorithms=[JWT_ALGORITHM],
            leeway=JWT_CLOCK_LEEWAY_SECONDS,
            options={"verify_exp": verify_exp},
        )
    except pyjwt.PyJWTError:
        return None

def looks_like_jwt(token: str) -> bool:
    """Misma heurística de formato que backend/src/middleware/auth.ts: un JWT
    tiene 3 segmentos separados por '.'; los tokens opacos legacy
    (secrets.token_urlsafe) no llevan puntos."""
    return token.count(".") == 2

def notify_node_session_revoked(jti: str, exp: datetime) -> None:
    """Llamada saliente best-effort a Node para revocar de inmediato el JWT en
    logout. Nunca debe bloquear ni fallar el logout: timeout corto, cualquier
    excepción se loguea y se ignora — la sesión local ya se borró de todos
    modos, y el JWT igual expira solo si esta llamada no llega."""
    try:
        httpx.post(
            f"{NODE_SERVICE_URL}/internal/session/invalidate",
            json={"jti": jti, "exp": int(exp.timestamp())},
            headers={"X-Internal-Secret": INTERNAL_API_SECRET},
            timeout=NODE_INTERNAL_CALL_TIMEOUT_SECONDS,
        )
    except Exception as e:
        print(f"[WARN] No se pudo notificar revocación de sesión a Node: {e}", flush=True)

# ---------------------------------------------------------------------------
# Background tasks
# ---------------------------------------------------------------------------
async def periodic_cleanup():
    while True:
        await asyncio.sleep(3600)
        try:
            cleanup_expired()
            print("[CLEANUP] Expired OTPs, sessions, and rate limits cleaned", flush=True)
        except Exception as e:
            print(f"[ERROR] Cleanup failed: {e}", flush=True)
            await asyncio.sleep(60)

async def periodic_whitelist_refresh():
    while True:
        await asyncio.sleep(WHITELIST_REFRESH_SECONDS)
        load_whitelist()

async def process_background_auth(email: str):
    await asyncio.sleep(0)
    authorized = is_email_authorized(email)
    print(f"[DEBUG] process_background_auth({email}) authorized={authorized} whitelist_size={len(whitelist_emails)}", flush=True)
    if authorized:
        otp_code = generate_otp()
        salt = secrets.token_bytes(16)
        otp_hash = hash_otp(otp_code, salt)
        store_otp(
            email,
            otp_hash,
            salt,
            datetime.now(timezone.utc) + timedelta(minutes=OTP_EXPIRY_MINUTES)
        )
        print(f"[DEBUG] OTP almacenado para {email}", flush=True)
        try:
            transmit_otp_email(email, otp_code)
        except Exception as e:
            print(f"[SMTP] Error al enviar a {email}: {e}", flush=True)
    else:
        print(f"[DEBUG] Email {email} NO autorizado, ejecutando dummy HMAC", flush=True)
        compute_dummy_hmac()

# ---------------------------------------------------------------------------
# FastAPI app
# ---------------------------------------------------------------------------
app = FastAPI(title="LMS Exam Auth Service")

app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type", "Cookie", "X-Requested-With"],
    max_age=3600,
)

# ---------------------------------------------------------------------------
# Startup / Shutdown
# ---------------------------------------------------------------------------
@app.on_event("startup")
async def startup():
    init_db()
    load_whitelist()
    print(f"[CONFIG] CORS origins: {CORS_ORIGINS}", flush=True)
    print(f"[CONFIG] Environment: {ENVIRONMENT}", flush=True)
    print(f"[CONFIG] Cookie secure: {COOKIE_SECURE}", flush=True)
    print(f"[DEBUG] Whitelist cargada: {whitelist_emails}", flush=True)
    asyncio.create_task(periodic_cleanup())
    asyncio.create_task(periodic_whitelist_refresh())

# ---------------------------------------------------------------------------
# Request / Response models
# ---------------------------------------------------------------------------
class OtpRequest(BaseModel):
    email: str

    @field_validator('email')
    @classmethod
    def validate_email(cls, v: str) -> str:
        import re
        if not re.match(r'^[^@\s]+@[^@\s]+\.[^@\s]+$', v):
            raise ValueError('Correo electrónico inválido')
        return v.lower().strip()

class OtpVerify(BaseModel):
    email: str
    otp: str

    @field_validator('email')
    @classmethod
    def validate_email(cls, v: str) -> str:
        import re
        if not re.match(r'^[^@\s]+@[^@\s]+\.[^@\s]+$', v):
            raise ValueError('Correo electrónico inválido')
        return v.lower().strip()

# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------
@app.post("/auth/login")
@app.post("/auth/otp-request")
async def otp_request(body: OtpRequest, request: Request):
    if body.email not in RATE_LIMIT_EXEMPT_EMAILS:
        client_ip = extract_real_client_ip(request)
        if not apply_ip_rate_limit(client_ip):
            retry_after = IP_RATE_WINDOW_HOURS * 3600
            raise HTTPException(
                status_code=429,
                detail="Demasiadas solicitudes. Intenta de nuevo más tarde.",
                headers={"Retry-After": str(retry_after)}
            )

    asyncio.create_task(process_background_auth(body.email))
    return JSONResponse(
        status_code=202,
        content={"message": "Si el correo está autorizado, recibirás un código OTP."}
    )

@app.post("/auth/resend")
@app.post("/auth/otp-resend")
async def otp_resend(body: OtpRequest, request: Request):
    return await otp_request(body, request)

@app.post("/auth/verify")
@app.post("/auth/otp-verify")
async def otp_verify(body: OtpVerify, request: Request):
    email = body.email
    code = body.otp.strip()

    record = get_otp(email)
    if not record:
        raise HTTPException(status_code=401, detail="Código inválido o expirado.")

    if datetime.now(timezone.utc) > parse_expiry(record["expires_at"]):
        delete_otp(email)
        raise HTTPException(status_code=401, detail="Código expirado. Solicita uno nuevo.")

    if record["attempts"] >= MAX_OTP_ATTEMPTS:
        delete_otp(email)
        raise HTTPException(status_code=429, detail="Demasiados intentos. Solicita un nuevo código.")

    stored_hash = record["code_hash"]
    salt = record["salt"]
    computed_hash = hash_otp(code, salt)

    attempts = increment_otp_attempts(email)

    if not secrets.compare_digest(computed_hash, stored_hash):
        attempts_left = MAX_OTP_ATTEMPTS - attempts
        if attempts >= MAX_OTP_ATTEMPTS:
            delete_otp(email)
            raise HTTPException(status_code=429, detail="Demasiados intentos. Solicita un nuevo código.")
        raise HTTPException(
            status_code=401,
            detail=f"Código incorrecto. Te quedan {attempts_left} intento(s)."
        )

    delete_otp(email)
    jti = create_session(email)
    session_jwt = sign_session_jwt(email, jti)

    response = JSONResponse(
        status_code=200,
        content={"message": "Autenticación exitosa.", "email": email}
    )
    response.set_cookie(
        key=SESSION_COOKIE_NAME,
        value=session_jwt,
        httponly=True,
        secure=COOKIE_SECURE,
        samesite="lax",
        path="/",
        max_age=SESSION_EXPIRY_HOURS * 3600,
    )
    return response

@app.post("/auth/refresh")
async def refresh_session(request: Request):
    """Llamado por Node (backend/src/middleware/auth.ts) solo cuando un JWT
    está por vencer — no en el camino normal de cada request. Revalida contra
    la fila server-side en auth_sessions (que logout puede haber borrado) y,
    si sigue viva, extiende su vencimiento y firma un JWT nuevo con el mismo
    jti."""
    body = await request.json()
    current_token = body.get("session_token")
    if not current_token:
        raise HTTPException(status_code=401, detail="Falta session_token")

    claims = decode_session_jwt(current_token, verify_exp=True)
    if not claims:
        raise HTTPException(status_code=401, detail="Token inválido o expirado")

    jti = claims.get("jti")
    email = claims.get("email")
    if not jti or not email:
        raise HTTPException(status_code=401, detail="Token inválido")

    if not db_touch_session(jti):
        raise HTTPException(status_code=401, detail="Sesión ya no existe (revocada o expirada)")

    new_jwt = sign_session_jwt(email, jti)
    response = JSONResponse(status_code=200, content={"session_token": new_jwt, "email": email})
    response.set_cookie(
        key=SESSION_COOKIE_NAME,
        value=new_jwt,
        httponly=True,
        secure=COOKIE_SECURE,
        samesite="lax",
        path="/",
        max_age=SESSION_EXPIRY_HOURS * 3600,
    )
    return response

@app.post("/auth/logout")
async def logout(request: Request):
    session_token = request.cookies.get(SESSION_COOKIE_NAME)
    if session_token:
        if looks_like_jwt(session_token):
            # No exigimos que no esté vencido: un logout explícito de un JWT
            # ya vencido igual debe limpiar la fila local y, si se puede leer
            # el jti, notificar a Node (idempotente si ya expiró solo).
            claims = decode_session_jwt(session_token, verify_exp=False)
            if claims and claims.get("jti"):
                jti = claims["jti"]
                db_delete_session(jti)
                exp_ts = claims.get("exp")
                if exp_ts:
                    notify_node_session_revoked(jti, datetime.fromtimestamp(exp_ts, tz=timezone.utc))
        else:
            # Formato legacy (pre-JWT, ver plan 09): el cookie es directamente
            # el token opaco usado como PK en auth_sessions.
            db_delete_session(session_token)

    response = JSONResponse(status_code=200, content={"message": "Sesión cerrada."})
    response.delete_cookie(
        key=SESSION_COOKIE_NAME,
        path="/",
        httponly=True,
        secure=COOKIE_SECURE,
        samesite="lax",
    )
    return response

@app.get("/auth/me")
async def get_current_user(request: Request):
    session_token = request.cookies.get(SESSION_COOKIE_NAME)
    if not session_token:
        raise HTTPException(status_code=401, detail="No session")

    if looks_like_jwt(session_token):
        claims = decode_session_jwt(session_token, verify_exp=True)
        if not claims:
            raise HTTPException(status_code=401, detail="Invalid session")
        return {"email": claims["email"], "status": "authenticated"}

    session = db_validate_session(session_token)
    if not session:
        raise HTTPException(status_code=401, detail="Invalid session")
    return {"email": session["email"], "status": "authenticated"}

@app.post("/auth/validate")
async def validate_session(request: Request):
    """Camino legacy (pre-JWT): sigue existiendo solo para que Node valide
    cookies emitidas antes de este cambio mientras dure la migración (ver
    plan 09) — no se usa para cookies en formato JWT."""
    body = await request.json()
    session_token = body.get("session_token")
    if not session_token:
        raise HTTPException(status_code=401, detail="Invalid session")
    session = db_validate_session(session_token)
    if not session:
        raise HTTPException(status_code=401, detail="Session expired")
    return {"email": session["email"], "valid": True}

@app.head("/health")
@app.get("/health")
async def health():
    return {"status": "ok"}

# ---------------------------------------------------------------------------
# Run
# ---------------------------------------------------------------------------
if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=PORT, reload=True)
