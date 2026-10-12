import os
import secrets
import socket
import tempfile
import time
from collections import defaultdict
from io import BytesIO
from pathlib import Path
from urllib.parse import quote

import qrcode
import qrcode.image.svg
import uvicorn
from fastapi import BackgroundTasks, FastAPI, File, HTTPException, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse, Response

from store import blob_enabled, on_vercel, store

PORT = 8000
FRONTEND_PORT = 5173
UPLOAD_DIR = Path(tempfile.mkdtemp(prefix="dropeasy-"))
PANEL_COOKIE = "dropeasy_panel"
MAX_UPLOAD_BYTES = int(os.getenv("MAX_UPLOAD_BYTES", str(50 * 1024 * 1024)))
UPLOAD_RATE_LIMIT = 30
UPLOAD_RATE_WINDOW = 60.0
CHUNK_SIZE = 1024 * 1024

session_token: str | None = None
_upload_hits: dict[str, list[float]] = defaultdict(list)

app = FastAPI()
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_methods=["*"],
    allow_headers=["*"],
    allow_credentials=True,
)


def lan_ip() -> str:
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect(("10.255.255.255", 1))
        return s.getsockname()[0]
    except OSError:
        return "127.0.0.1"
    finally:
        s.close()


def share_url(token: str) -> str:
    if on_vercel():
        if os.getenv("VERCEL_ENV") == "production" and os.getenv("VERCEL_PROJECT_PRODUCTION_URL"):
            base = "https://" + os.environ["VERCEL_PROJECT_PRODUCTION_URL"]
        else:
            base = "https://" + os.environ["VERCEL_URL"]
        return f"{base}/send?t={token}"
    return f"http://{lan_ip()}:{FRONTEND_PORT}/send?t={token}"


async def active_token() -> str | None:
    if blob_enabled():
        return await store.read_session()
    return session_token


def tokens_match(t: str | None, expected: str | None) -> bool:
    return bool(
        expected
        and t
        and len(t) == len(expected)
        and secrets.compare_digest(t, expected)
    )


async def check(t: str | None):
    if not tokens_match(t, await active_token()):
        raise HTTPException(403, "Token non valido")


def panel_secret() -> str | None:
    value = os.getenv("PANEL_SECRET")
    return value if value else None


def require_panel(request: Request):
    if not on_vercel():
        host = request.client.host if request.client else ""
        if host not in {"127.0.0.1", "::1"}:
            raise HTTPException(403, "Solo dal PC")
        return

    secret = panel_secret()
    if not secret:
        raise HTTPException(503, "Imposta PANEL_SECRET sul progetto Vercel")

    provided = request.cookies.get(PANEL_COOKIE) or request.headers.get("X-Panel-Secret")
    if not tokens_match(provided, secret):
        raise HTTPException(403, "Apri il pannello con il link che contiene il segreto (?k=…)")


def require_storage():
    if on_vercel() and not blob_enabled():
        raise HTTPException(503, "Collega un Blob store al progetto Vercel")


def drop_token(request: Request, t: str | None) -> str | None:
    return request.headers.get("X-Drop-Token") or t


def check_upload_rate(token: str):
    now = time.monotonic()
    window_start = now - UPLOAD_RATE_WINDOW
    hits = [ts for ts in _upload_hits[token] if ts >= window_start]
    if len(hits) >= UPLOAD_RATE_LIMIT:
        _upload_hits[token] = hits
        raise HTTPException(429, "Troppi upload, riprova tra un minuto")
    hits.append(now)
    _upload_hits[token] = hits


async def read_limited(file: UploadFile, limit: int) -> bytes:
    chunks: list[bytes] = []
    total = 0
    while True:
        chunk = await file.read(CHUNK_SIZE)
        if not chunk:
            break
        total += len(chunk)
        if total > limit:
            raise HTTPException(413, f"File troppo grande (max {limit} byte)")
        chunks.append(chunk)
    return b"".join(chunks)


def unique_local_path(name: str) -> Path:
    stem = Path(name).stem
    suffix = Path(name).suffix
    for _ in range(32):
        candidate = UPLOAD_DIR / f"{stem}_{secrets.token_hex(4)}{suffix}"
        try:
            fd = os.open(candidate, os.O_CREAT | os.O_EXCL | os.O_WRONLY)
            os.close(fd)
            return candidate
        except FileExistsError:
            continue
    raise HTTPException(500, "Impossibile salvare il file")


@app.post("/api/panel/unlock")
async def unlock_panel(request: Request, k: str | None = None):
    secret = panel_secret()
    if not secret:
        if on_vercel():
            raise HTTPException(503, "Imposta PANEL_SECRET sul progetto Vercel")
        return {"ok": True}

    provided = k
    if provided is None:
        try:
            body = await request.json()
            if isinstance(body, dict):
                provided = body.get("k")
        except Exception:
            provided = None

    if not tokens_match(provided if isinstance(provided, str) else None, secret):
        raise HTTPException(403, "Segreto pannello non valido")

    response = JSONResponse({"ok": True})
    response.set_cookie(
        key=PANEL_COOKIE,
        value=secret,
        httponly=True,
        secure=on_vercel(),
        samesite="lax",
        path="/",
        max_age=60 * 60 * 24 * 365,
    )
    return response


@app.post("/api/session")
async def start_session(request: Request):
    global session_token
    require_panel(request)
    require_storage()
    token = secrets.token_urlsafe(16)
    if blob_enabled():
        await store.write_session(token)
    else:
        session_token = token
    return {"url": share_url(token)}


@app.get("/api/session")
async def get_session(request: Request):
    require_panel(request)
    require_storage()
    token = await active_token()
    if not token:
        raise HTTPException(404, "Nessuna condivisione attiva")
    return {"url": share_url(token)}


@app.get("/api/qr")
async def qr(request: Request):
    require_panel(request)
    require_storage()
    token = await active_token()
    if not token:
        raise HTTPException(404, "Nessuna condivisione attiva")
    image = qrcode.make(share_url(token), image_factory=qrcode.image.svg.SvgPathImage)
    buffer = BytesIO()
    image.save(buffer)
    return Response(
        buffer.getvalue(),
        media_type="image/svg+xml",
        headers={"Cache-Control": "no-store"},
    )


def stored_file(name: str) -> Path:
    safe = Path(name).name
    if not safe or safe != name:
        raise HTTPException(400, "Nome non valido")
    dest = (UPLOAD_DIR / safe).resolve()
    if dest.parent != UPLOAD_DIR.resolve() or not dest.is_file():
        raise HTTPException(404, "File non trovato")
    return dest


def safe_name(name: str) -> str:
    safe = Path(name).name
    if not safe or safe != name:
        raise HTTPException(400, "Nome non valido")
    return safe


@app.get("/api/files")
async def files(request: Request):
    require_panel(request)
    require_storage()
    if blob_enabled():
        return await store.list_files()
    saved = [path for path in UPLOAD_DIR.iterdir() if path.is_file()]
    saved.sort(key=lambda path: path.stat().st_mtime, reverse=True)
    return [{"name": path.name, "size": path.stat().st_size} for path in saved]


def remove_file(path: Path):
    path.unlink(missing_ok=True)


@app.get("/api/files/{name}")
async def download_file(name: str, request: Request, background: BackgroundTasks):
    require_panel(request)
    require_storage()
    safe = safe_name(name)
    if blob_enabled():
        try:
            data = await store.read_file(safe)
        except FileNotFoundError:
            raise HTTPException(404, "File non trovato")
        background.add_task(store.delete_file, safe)
        return Response(
            data,
            media_type="application/octet-stream",
            headers={
                "Content-Disposition": f"attachment; filename=\"{safe}\"; filename*=UTF-8''{quote(safe)}"
            },
        )
    path = stored_file(safe)
    background.add_task(remove_file, path)
    return FileResponse(path, filename=safe, content_disposition_type="attachment")


@app.delete("/api/files/{name}")
async def delete_saved_file(name: str, request: Request):
    require_panel(request)
    require_storage()
    safe = safe_name(name)
    if blob_enabled():
        await store.delete_file(safe)
        return {"deleted": safe}
    path = stored_file(safe)
    remove_file(path)
    return {"deleted": safe}


@app.get("/api/invite")
async def invite(request: Request, t: str | None = None):
    await check(drop_token(request, t))
    return Response(
        b'{"ok":true}',
        media_type="application/json",
        headers={"Cache-Control": "no-store"},
    )


@app.post("/upload")
async def upload(request: Request, t: str | None = None, file: UploadFile = File(...)):
    token = drop_token(request, t)
    await check(token)
    assert token is not None
    check_upload_rate(token)
    name = safe_name(Path(file.filename or "file").name)
    if blob_enabled():
        data = await read_limited(file, MAX_UPLOAD_BYTES)
        saved = await store.save_file(name, data)
        return {"saved": saved}

    dest = unique_local_path(name)
    written = 0
    try:
        with open(dest, "wb") as out:
            while chunk := await file.read(CHUNK_SIZE):
                written += len(chunk)
                if written > MAX_UPLOAD_BYTES:
                    raise HTTPException(413, f"File troppo grande (max {MAX_UPLOAD_BYTES} byte)")
                out.write(chunk)
    except HTTPException:
        dest.unlink(missing_ok=True)
        raise
    except Exception:
        dest.unlink(missing_ok=True)
        raise
    return {"saved": dest.name}


if __name__ == "__main__":
    print(f"\nPannello PC: http://localhost:{FRONTEND_PORT}")
    print(f"Pagina telefono: http://localhost:{FRONTEND_PORT}/send")
    print(f"Server in ascolto sulla porta {PORT}\n")
    uvicorn.run(app, host="0.0.0.0", port=PORT)
