import secrets
import socket
import tempfile
from io import BytesIO
from pathlib import Path

import qrcode
import qrcode.image.svg
import uvicorn
from fastapi import BackgroundTasks, FastAPI, File, HTTPException, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, HTMLResponse, Response

PORT = 8000
UPLOAD_DIR = Path(tempfile.mkdtemp(prefix="dropeasy-"))

session_token: str | None = None

app = FastAPI()
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_methods=["*"],
    allow_headers=["*"],
)

PAGE = """<!doctype html>
<html lang="it"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Invia al PC</title>
<style>
  body{font-family:system-ui;max-width:480px;margin:2rem auto;padding:0 1rem}
  button{width:100%;padding:.9rem;font-size:1rem;margin-top:1rem}
  .row{margin:.6rem 0;font-size:.9rem}
  progress{width:100%}
</style></head><body>
<h2>Invia file al PC</h2>
<input type="file" id="f" multiple>
<button id="b">Invia</button>
<div id="out"></div>
<script>
const T = new URLSearchParams(location.search).get("t");
const out = document.getElementById("out");

function send(file) {
  return new Promise(res => {
    const row = document.createElement("div");
    row.className = "row";
    row.innerHTML = file.name + '<br><progress max="100" value="0"></progress> <span></span>';
    out.appendChild(row);
    const bar = row.querySelector("progress"), st = row.querySelector("span");
    const fd = new FormData();
    fd.append("file", file);
    const x = new XMLHttpRequest();
    x.open("POST", "/upload?t=" + encodeURIComponent(T));
    x.upload.onprogress = e => { if (e.lengthComputable) bar.value = e.loaded / e.total * 100; };
    x.onload = () => { st.textContent = x.status === 200 ? "✔" : "✘ " + x.status; res(); };
    x.onerror = () => { st.textContent = "✘ errore di rete"; res(); };
    x.send(fd);
  });
}

document.getElementById("b").onclick = async () => {
  const files = document.getElementById("f").files;
  for (const f of files) await send(f);
};
</script></body></html>"""


def lan_ip() -> str:
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect(("10.255.255.255", 1))
        return s.getsockname()[0]
    except OSError:
        return "127.0.0.1"
    finally:
        s.close()


def share_url() -> str:
    return f"http://{lan_ip()}:{PORT}/?t={session_token}"


def check(t: str | None):
    if (
        not session_token
        or not t
        or len(t) != len(session_token)
        or not secrets.compare_digest(t, session_token)
    ):
        raise HTTPException(403, "Token non valido")


def local_only(request: Request):
    host = request.client.host if request.client else ""
    if host not in {"127.0.0.1", "::1"}:
        raise HTTPException(403, "Solo dal PC")


@app.post("/api/session")
def start_session(request: Request):
    global session_token
    local_only(request)
    session_token = secrets.token_urlsafe(8)
    return {"url": share_url()}


@app.get("/api/session")
def get_session(request: Request):
    local_only(request)
    if not session_token:
        raise HTTPException(404, "Nessuna condivisione attiva")
    return {"url": share_url()}


@app.get("/api/qr")
def qr(request: Request):
    local_only(request)
    if not session_token:
        raise HTTPException(404, "Nessuna condivisione attiva")
    image = qrcode.make(share_url(), image_factory=qrcode.image.svg.SvgPathImage)
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


@app.get("/api/files")
def files(request: Request):
    local_only(request)
    saved = [path for path in UPLOAD_DIR.iterdir() if path.is_file()]
    saved.sort(key=lambda path: path.stat().st_mtime, reverse=True)
    return [{"name": path.name, "size": path.stat().st_size} for path in saved]


def remove_file(path: Path):
    path.unlink(missing_ok=True)


@app.get("/api/files/{name}")
def download_file(name: str, request: Request, background: BackgroundTasks):
    local_only(request)
    path = stored_file(name)
    background.add_task(remove_file, path)
    return FileResponse(path, filename=name, content_disposition_type="attachment")


@app.get("/", response_class=HTMLResponse)
def index(t: str | None = None):
    check(t)
    return PAGE


@app.post("/upload")
async def upload(t: str | None = None, file: UploadFile = File(...)):
    check(t)
    name = Path(file.filename or "file").name  # evita path traversal
    dest = UPLOAD_DIR / name
    i = 1
    while dest.exists():  # non sovrascrive
        dest = UPLOAD_DIR / f"{Path(name).stem}_{i}{Path(name).suffix}"
        i += 1
    with open(dest, "wb") as out:
        while chunk := await file.read(1024 * 1024):
            out.write(chunk)
    return {"saved": dest.name}


if __name__ == "__main__":
    print(f"\nPannello PC: http://localhost:5173")
    print(f"Server in ascolto sulla porta {PORT}\n")
    uvicorn.run(app, host="0.0.0.0", port=PORT)
