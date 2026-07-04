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
from pathlib import Path
from typing import Optional

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel, field_validator
from dotenv import load_dotenv

# ---------------------------------------------------------------------------
# Config from environment
# ---------------------------------------------------------------------------
load_dotenv()
GMAIL_SENDER_EMAIL = os.getenv("GMAIL_SENDER_EMAIL", "tu_correo@gmail.com")
GMAIL_APP_PASSWORD = os.getenv("GMAIL_APP_PASSWORD", "")
PORT = int(os.getenv("PORT", "3001"))
ENVIRONMENT = os.getenv("ENVIRONMENT", "development")
COOKIE_SECURE = ENVIRONMENT == "production"

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------
OTP_EXPIRY_MINUTES = 5
OTP_LENGTH = 6
MAX_OTP_ATTEMPTS = 3
SESSION_EXPIRY_HOURS = 24
IP_RATE_LIMIT = 5
IP_RATE_WINDOW_HOURS = 1
WHITELIST_REFRESH_SECONDS = 60
CLEANUP_INTERVAL_SECONDS = 60

SESSION_COOKIE_NAME = "session_token"
WHITELIST_PATH = Path(__file__).parent / "whitelist.json"

# ---------------------------------------------------------------------------
# In-memory stores
# ---------------------------------------------------------------------------
otp_store: dict[str, dict] = {}
session_store: dict[str, dict] = {}
ip_rate_limits: dict[str, list[datetime]] = {}
whitelist_emails: set[str] = set()
_whitelist_lock = threading.Lock()

# ---------------------------------------------------------------------------
# Whitelist loader
# ---------------------------------------------------------------------------
def load_whitelist():
    global whitelist_emails
    try:
        with open(WHITELIST_PATH, "r", encoding="utf-8") as f:
            data = json.load(f)
        emails = set(data.get("authorized_emails", []))
        with _whitelist_lock:
            whitelist_emails = emails
    except Exception:
        pass

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
def extract_real_client_ip(request: Request) -> str:
    cf_ip = request.headers.get("CF-Connecting-IP")
    if cf_ip:
        return cf_ip
    xff = request.headers.get("X-Forwarded-For")
    if xff:
        return xff.split(",")[0].strip()
    return request.client.host if request.client else "127.0.0.1"

def apply_ip_rate_limit(client_ip: str) -> bool:
    now = datetime.now(timezone.utc)
    one_hour_ago = now - timedelta(hours=IP_RATE_WINDOW_HOURS)
    if client_ip not in ip_rate_limits:
        ip_rate_limits[client_ip] = []
    ip_rate_limits[client_ip] = [ts for ts in ip_rate_limits[client_ip] if ts > one_hour_ago]
    if len(ip_rate_limits[client_ip]) >= IP_RATE_LIMIT:
        return False
    ip_rate_limits[client_ip].append(now)
    return True

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
    session_token = secrets.token_urlsafe(32)
    session_store[session_token] = {
        "email": email,
        "created_at": datetime.now(timezone.utc),
        "expires_at": datetime.now(timezone.utc) + timedelta(hours=SESSION_EXPIRY_HOURS),
    }
    return session_token

# ---------------------------------------------------------------------------
# Background tasks
# ---------------------------------------------------------------------------
async def periodic_cleanup():
    while True:
        await asyncio.sleep(CLEANUP_INTERVAL_SECONDS)
        now = datetime.now(timezone.utc)
        expired_otps = [k for k, v in otp_store.items() if now > v["expires_at"]]
        for k in expired_otps:
            otp_store.pop(k, None)
        expired_sessions = [k for k, v in list(session_store.items()) if now > v["expires_at"]]
        for k in expired_sessions:
            session_store.pop(k, None)

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
        otp_store[email] = {
            "hash": otp_hash,
            "salt": salt,
            "attempts": 0,
            "expires_at": datetime.now(timezone.utc) + timedelta(minutes=OTP_EXPIRY_MINUTES),
            "created_at": datetime.now(timezone.utc),
        }
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
    allow_origins=["http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ---------------------------------------------------------------------------
# Startup / Shutdown
# ---------------------------------------------------------------------------
@app.on_event("startup")
async def startup():
    load_whitelist()
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
    client_ip = extract_real_client_ip(request)
    if not apply_ip_rate_limit(client_ip):
        raise HTTPException(status_code=429, detail="Demasiadas solicitudes. Intenta de nuevo más tarde.")

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

    if email not in otp_store:
        raise HTTPException(status_code=401, detail="Código inválido o expirado.")

    record = otp_store[email]

    if datetime.now(timezone.utc) > record["expires_at"]:
        otp_store.pop(email, None)
        raise HTTPException(status_code=401, detail="Código expirado. Solicita uno nuevo.")

    if record["attempts"] >= MAX_OTP_ATTEMPTS:
        otp_store.pop(email, None)
        raise HTTPException(status_code=429, detail="Demasiados intentos. Solicita un nuevo código.")

    stored_hash = record["hash"]
    salt = record["salt"]
    computed_hash = hash_otp(code, salt)

    record["attempts"] += 1

    if not secrets.compare_digest(computed_hash, stored_hash):
        attempts_left = MAX_OTP_ATTEMPTS - record["attempts"]
        if record["attempts"] >= MAX_OTP_ATTEMPTS:
            otp_store.pop(email, None)
            raise HTTPException(status_code=429, detail="Demasiados intentos. Solicita un nuevo código.")
        raise HTTPException(
            status_code=401,
            detail=f"Código incorrecto. Te quedan {attempts_left} intento(s)."
        )

    otp_store.pop(email, None)
    session_token = create_session(email)

    response = JSONResponse(
        status_code=200,
        content={"message": "Autenticación exitosa.", "email": email}
    )
    response.set_cookie(
        key=SESSION_COOKIE_NAME,
        value=session_token,
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
    if session_token and session_token in session_store:
        session_store.pop(session_token, None)
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
    if session_token not in session_store:
        raise HTTPException(status_code=401, detail="Invalid session")
    session = session_store[session_token]
    if datetime.now(timezone.utc) > session["expires_at"]:
        session_store.pop(session_token, None)
        raise HTTPException(status_code=401, detail="Session expired")
    return {"email": session["email"], "status": "authenticated"}

@app.post("/auth/validate")
async def validate_session(request: Request):
    body = await request.json()
    session_token = body.get("session_token")
    if not session_token or session_token not in session_store:
        raise HTTPException(status_code=401, detail="Invalid session")
    session = session_store[session_token]
    if datetime.now(timezone.utc) > session["expires_at"]:
        session_store.pop(session_token, None)
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
