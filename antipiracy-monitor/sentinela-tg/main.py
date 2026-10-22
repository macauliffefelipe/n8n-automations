"""Sentinela · microservicio de apoyo para n8n.

- Telegram (Telethon, cuenta de usuario): buscar, descubrir canales, verificar mensajes, exportar membresías.
- Páginas web: descarga segura de texto (/pagina) y capturas de evidencia con Playwright (/captura).

Todos los endpoints (menos /health) exigen el header X-API-Key.
"""
import asyncio
import base64
import hmac
import io
import ipaddress
import os
import random
import re
import socket
import time
from contextlib import asynccontextmanager
from pathlib import Path
from urllib.parse import urlparse, urljoin

import httpx
from fastapi import Depends, FastAPI, Header, HTTPException
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field
from telethon import TelegramClient, errors, functions, types

API_KEY = os.environ.get("API_KEY", "")
TG_API_ID = int(os.environ.get("TG_API_ID", "0") or 0)
TG_API_HASH = os.environ.get("TG_API_HASH", "")
SESSION_PATH = os.environ.get("TG_SESSION", "/data/sentinela")
CAPTURAS_DIR = Path(os.environ.get("CAPTURAS_DIR", "/data/capturas"))
PAUSA_MIN = float(os.environ.get("PAUSA_MIN", "2"))
PAUSA_MAX = float(os.environ.get("PAUSA_MAX", "6"))
MAX_BYTES_PAGINA = 400_000

LIBRO_EXT = (".pdf", ".epub", ".mobi", ".azw3", ".azw", ".docx", ".zip", ".rar", ".7z")
UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/124.0 Safari/537.36")

client: TelegramClient | None = None
tg_ok = False
LOCK = asyncio.Lock()          # un solo request a Telegram a la vez
_pw = None
_browser = None
_browser_lock = asyncio.Lock()
_cap_sem = asyncio.Semaphore(2)


# ------------------------------------------------------------------ arranque
@asynccontextmanager
async def lifespan(app: FastAPI):
    global client, tg_ok
    if not API_KEY:
        raise RuntimeError("Falta API_KEY en el entorno")
    CAPTURAS_DIR.mkdir(parents=True, exist_ok=True)
    if TG_API_ID and TG_API_HASH:
        client = TelegramClient(SESSION_PATH, TG_API_ID, TG_API_HASH)
        await client.connect()
        tg_ok = await client.is_user_authorized()
        if not tg_ok:
            print("AVISO: la sesión de Telegram no está autorizada. Corré login.py una vez.")
    yield
    if client:
        await client.disconnect()
    if _browser:
        await _browser.close()
    if _pw:
        await _pw.stop()


app = FastAPI(title="Sentinela", lifespan=lifespan)


def auth(x_api_key: str = Header(default="")):
    if not hmac.compare_digest(x_api_key.encode(), API_KEY.encode()):
        raise HTTPException(401, "API key inválida")


def requiere_tg():
    if client is None or not tg_ok:
        raise HTTPException(503, "Sesión de Telegram no disponible. Corré login.py.")


# ------------------------------------------------------------------ utilidades
_dns_cache: dict[str, tuple[float, bool]] = {}


async def url_publica(url: str) -> bool:
    """False si la URL apunta a una IP privada, loopback o link-local (protección SSRF)."""
    try:
        p = urlparse(url)
        if p.scheme in ("data", "blob", "about"):
            return True
        if p.scheme not in ("http", "https") or not p.hostname:
            return False
        host = p.hostname
        hit = _dns_cache.get(host)
        if hit and time.time() - hit[0] < 300:
            return hit[1]
        infos = await asyncio.to_thread(socket.getaddrinfo, host, None)
        ok = True
        for info in infos:
            ip = ipaddress.ip_address(info[4][0])
            if (ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_reserved
                    or ip.is_multicast or ip.is_unspecified):
                ok = False
                break
        _dns_cache[host] = (time.time(), ok)
        return ok
    except socket.gaierror:
        raise
    except Exception:
        return False


async def tg_call(fn, *args, **kwargs):
    """Serializa llamadas a Telegram, con pausa humana y backoff ante FloodWait."""
    async with LOCK:
        await asyncio.sleep(random.uniform(PAUSA_MIN, PAUSA_MAX))
        for intento in range(2):
            try:
                return await fn(*args, **kwargs)
            except errors.FloodWaitError as e:
                if intento == 0 and e.seconds <= 90:
                    await asyncio.sleep(e.seconds + 2)
                    continue
                raise HTTPException(429, f"FloodWait {e.seconds}s",
                                    headers={"Retry-After": str(e.seconds)})


def link_mensaje(chat, msg_id: int) -> str | None:
    username = getattr(chat, "username", None)
    if username:
        return f"https://t.me/{username}/{msg_id}"
    if isinstance(chat, types.Channel):
        return f"https://t.me/c/{chat.id}/{msg_id}"
    return None


def info_documento(msg) -> tuple[str | None, int | None, str | None]:
    media = getattr(msg, "media", None)
    doc = getattr(media, "document", None)
    if not doc:
        return None, None, None
    nombre = None
    for a in getattr(doc, "attributes", []) or []:
        if isinstance(a, types.DocumentAttributeFilename):
            nombre = a.file_name
    return nombre, getattr(doc, "size", None), getattr(doc, "mime_type", None)


def tipo_chat(ent) -> str:
    if isinstance(ent, types.Channel):
        return "canal" if ent.broadcast else "grupo"
    return "grupo"


# ------------------------------------------------------------------ modelos
class Buscar(BaseModel):
    query: str
    limit: int = Field(30, ge=1, le=100)


class Descubrir(BaseModel):
    terminos: list[str]
    limite: int = Field(15, ge=1, le=50)


class Verificar(BaseModel):
    link: str


class Pagina(BaseModel):
    url: str


class Captura(BaseModel):
    achado_id: int
    url: str


class Capturas(BaseModel):
    ids: list[int]
    ancho: int = Field(640, ge=200, le=1200)


# ------------------------------------------------------------------ rutas
@app.get("/health")
async def health():
    return {"ok": True, "telegram": tg_ok}


@app.post("/buscar", dependencies=[Depends(auth)])
async def buscar(body: Buscar):
    """Busca en TODOS los chats donde la cuenta ya es miembro (SearchGlobal)."""
    requiere_tg()
    res = await tg_call(
        client,
        functions.messages.SearchGlobalRequest(
            q=body.query, filter=types.InputMessagesFilterEmpty(),
            min_date=None, max_date=None, offset_rate=0,
            offset_peer=types.InputPeerEmpty(), offset_id=0, limit=body.limit),
    )
    chats = {c.id: c for c in getattr(res, "chats", [])}
    out = []
    for m in getattr(res, "messages", []):
        peer = getattr(m, "peer_id", None)
        cid = getattr(peer, "channel_id", None) or getattr(peer, "chat_id", None)
        chat = chats.get(cid)
        if chat is None:
            continue
        url = link_mensaje(chat, m.id)
        if not url:
            continue
        nombre, tamano, mime = info_documento(m)
        texto = (getattr(m, "message", "") or "")[:500]
        out.append({
            "url": url,
            "texto": texto,
            "archivo": nombre,
            "tamano": tamano,
            "mime": mime,
            "es_libro": bool(nombre and nombre.lower().endswith(LIBRO_EXT)),
            "canal_id": chat.id,
            "canal_titulo": getattr(chat, "title", None),
            "canal_username": getattr(chat, "username", None),
            "fecha": m.date.isoformat() if getattr(m, "date", None) else None,
        })
    return {"query": body.query, "total": len(out), "resultados": out}


@app.post("/descubrir", dependencies=[Depends(auth)])
async def descubrir(body: Descubrir):
    """Busca canales y grupos públicos por nombre. No se une a nada."""
    requiere_tg()
    vistos: dict[str, dict] = {}
    for termino in body.terminos:
        termino = termino.strip()
        if not termino:
            continue
        res = await tg_call(client, functions.contacts.SearchRequest(q=termino, limit=body.limite))
        mios = {getattr(p, "channel_id", None) for p in getattr(res, "my_results", [])}
        for c in getattr(res, "chats", []):
            if not isinstance(c, types.Channel) or not c.username:
                continue
            u = c.username.lower()
            if u in vistos:
                continue
            vistos[u] = {
                "username": c.username,
                "titulo": c.title,
                "tipo": tipo_chat(c),
                "miembros": getattr(c, "participants_count", None),
                "termino": termino,
                "ya_miembro": c.id in mios,
            }
    lista = sorted(vistos.values(), key=lambda x: -(x["miembros"] or 0))
    return {"total": len(lista), "canales": lista}


@app.get("/export_dialogs", dependencies=[Depends(auth)])
async def export_dialogs():
    """Lista de grupos y canales donde la cuenta es miembro (para reconstruir con otra cuenta)."""
    requiere_tg()
    out = []
    async with LOCK:
        async for d in client.iter_dialogs():
            e = d.entity
            if isinstance(e, (types.Channel, types.Chat)):
                out.append({
                    "chat_id": e.id,
                    "titulo": getattr(e, "title", None),
                    "username": getattr(e, "username", None),
                    "tipo": tipo_chat(e),
                    "miembros": getattr(e, "participants_count", None),
                })
    return {"total": len(out), "grupos": out}


LINK_RE = re.compile(r"https?://t\.me/(?:s/)?(?:(c)/(\d+)|([A-Za-z0-9_]{4,}))/(\d+)")


@app.post("/verificar", dependencies=[Depends(auth)])
async def verificar(body: Verificar):
    """estado: activo | removido | indeterminado. Solo 'removido' cuando hay evidencia clara."""
    requiere_tg()
    m = LINK_RE.match(body.link.strip())
    if not m:
        raise HTTPException(422, "Link de mensaje de Telegram no reconocido")
    es_privado, cid, username, msg_id = m.group(1), m.group(2), m.group(3), int(m.group(4))
    ref = types.PeerChannel(int(cid)) if es_privado else username
    try:
        ent = await tg_call(client.get_entity, ref)
    except (errors.UsernameNotOccupiedError, errors.UsernameInvalidError):
        return {"estado": "removido", "nota": "el canal ya no existe"}
    except (errors.ChannelPrivateError, errors.ChannelInvalidError, ValueError):
        return {"estado": "indeterminado", "nota": "sin acceso al canal (privado, baneo o borrado)"}
    restr = getattr(ent, "restriction_reason", None) or []
    por_copyright = any(
        "copyright" in ((r.reason or "") + " " + (r.text or "")).lower() for r in restr)
    if getattr(ent, "restricted", False) and por_copyright:
        return {"estado": "removido", "nota": "canal restringido por copyright"}
    try:
        msg = await tg_call(client.get_messages, ent, ids=msg_id)
    except (errors.ChannelPrivateError, errors.ChannelInvalidError):
        return {"estado": "indeterminado", "nota": "sin acceso para leer el mensaje"}
    if msg is None or isinstance(msg, types.MessageEmpty):
        return {"estado": "removido", "nota": "mensaje borrado"}
    return {"estado": "activo", "nota": "el mensaje sigue publicado"}


# ------------------------------------------------------------------ web
def _texto_html(html: str) -> tuple[str, str]:
    t = re.search(r"<title[^>]*>(.*?)</title>", html, re.I | re.S)
    titulo = re.sub(r"\s+", " ", t.group(1)).strip() if t else ""
    html = re.sub(r"(?is)<(script|style|noscript|svg)[^>]*>.*?</\1>", " ", html)
    txt = re.sub(r"(?s)<[^>]+>", " ", html)
    txt = re.sub(r"&nbsp;|&#160;", " ", txt)
    txt = re.sub(r"\s+", " ", txt).strip()
    return titulo[:200], txt[:3000]


async def _bajar(url: str) -> dict:
    """Descarga SEGURA: tope de bytes, no baja binarios, bloquea IPs internas."""
    try:
        async with httpx.AsyncClient(follow_redirects=False, timeout=15,
                                     headers={"User-Agent": UA, "Accept-Language": "pt-BR,pt;q=0.9"},
                                     verify=False) as c:
            for _ in range(5):
                try:
                    if not await url_publica(url):
                        return {"error": "bloqueada", "status": None, "nota": "destino no público"}
                except socket.gaierror:
                    return {"error": "dns", "status": None}
                async with c.stream("GET", url) as r:
                    if r.status_code in (301, 302, 303, 307, 308) and r.headers.get("location"):
                        url = urljoin(url, r.headers["location"])
                        continue
                    ctype = (r.headers.get("content-type") or "").split(";")[0].strip().lower()
                    largo = r.headers.get("content-length")
                    out = {"url_final": url, "status": r.status_code, "content_type": ctype,
                           "bytes": int(largo) if largo and largo.isdigit() else None,
                           "titulo": "", "texto": "", "error": None}
                    if ctype.startswith("text/") or "html" in ctype or "xml" in ctype or ctype == "":
                        buf = b""
                        async for chunk in r.aiter_bytes():
                            buf += chunk
                            if len(buf) >= MAX_BYTES_PAGINA:
                                break
                        out["titulo"], out["texto"] = _texto_html(
                            buf.decode(r.encoding or "utf-8", errors="ignore"))
                    return out
            return {"error": "demasiadas_redirecciones", "status": None}
    except (httpx.ConnectTimeout, httpx.ReadTimeout, httpx.PoolTimeout):
        return {"error": "timeout", "status": None}
    except httpx.ConnectError:
        return {"error": "conexion", "status": None}
    except httpx.HTTPError as e:
        return {"error": f"http:{type(e).__name__}", "status": None}


def _es_telegram(url: str) -> bool:
    return (urlparse(url).hostname or "").lower() in ("t.me", "telegram.me")


@app.post("/pagina", dependencies=[Depends(auth)])
async def pagina(body: Pagina):
    """Texto de una página para el triage. Los enlaces de Telegram se omiten."""
    if _es_telegram(body.url):
        return {"omitido": True, "nota": "enlaces de Telegram se verifican con /verificar"}
    return await _bajar(body.url)


@app.post("/chequear", dependencies=[Depends(auth)])
async def chequear(body: Pagina):
    """Verificación unificada: Telegram -> /verificar, web -> descarga segura."""
    if _es_telegram(body.url):
        requiere_tg()
        r = await verificar(Verificar(link=body.url))
        return {"tipo": "telegram", **r}
    return {"tipo": "web", **(await _bajar(body.url))}


async def get_browser():
    global _pw, _browser
    async with _browser_lock:
        if _browser is None:
            from playwright.async_api import async_playwright
            _pw = await async_playwright().start()
            _browser = await _pw.chromium.launch(args=["--no-sandbox"])
        return _browser


@app.post("/captura", dependencies=[Depends(auth)])
async def captura(body: Captura):
    """Screenshot de evidencia. Telegram privado (t.me/c/...) no tiene vista pública: no se captura."""
    url = body.url
    p = urlparse(url)
    if (p.hostname or "").lower() in ("t.me", "telegram.me"):
        m = LINK_RE.match(url)
        if not m or m.group(1):
            return {"ok": False, "motivo": "enlace privado de Telegram, sin vista pública"}
        url = f"https://t.me/s/{m.group(3)}?before={int(m.group(4)) + 1}"
    try:
        if not await url_publica(url):
            return {"ok": False, "motivo": "destino no público"}
    except socket.gaierror:
        return {"ok": False, "motivo": "dns"}
    async with _cap_sem:
        browser = await get_browser()
        ctx = await browser.new_context(
            viewport={"width": 1280, "height": 900}, user_agent=UA, locale="pt-BR",
            ignore_https_errors=True, accept_downloads=False)
        page = await ctx.new_page()

        async def guard(route):
            req = route.request
            try:
                if req.resource_type in ("media", "font") or not await url_publica(req.url):
                    await route.abort()
                    return
            except Exception:
                await route.abort()
                return
            await route.continue_()

        await page.route("**/*", guard)
        try:
            resp = await page.goto(url, wait_until="domcontentloaded", timeout=30000)
            await page.wait_for_timeout(2500)
            destino = CAPTURAS_DIR / f"{body.achado_id}.png"
            await page.screenshot(path=str(destino), full_page=False)
            titulo = (await page.title())[:200]
            return {"ok": True, "print_url": f"/captura/{body.achado_id}.png",
                    "titulo": titulo, "status": resp.status if resp else None}
        except Exception as e:
            msg = str(e)
            if "Download is starting" in msg or "net::ERR_ABORTED" in msg:
                return {"ok": False, "motivo": "descarga directa: el archivo está disponible, sin página para capturar"}
            return {"ok": False, "motivo": msg[:200]}
        finally:
            await ctx.close()


@app.get("/captura/{achado_id}.png", dependencies=[Depends(auth)])
async def ver_captura(achado_id: int):
    f = CAPTURAS_DIR / f"{achado_id}.png"
    if not f.exists():
        raise HTTPException(404, "sin captura")
    return FileResponse(f, media_type="image/png")


@app.post("/capturas_b64", dependencies=[Depends(auth)])
async def capturas_b64(body: Capturas):
    """Miniaturas JPEG en data-URI para incrustar en el PDF del reporte."""
    from PIL import Image
    out = {}
    for i in body.ids[:30]:
        f = CAPTURAS_DIR / f"{i}.png"
        if not f.exists():
            continue
        with Image.open(f) as im:
            im = im.convert("RGB")
            h = int(im.height * body.ancho / im.width)
            im = im.resize((body.ancho, h))
            buf = io.BytesIO()
            im.save(buf, "JPEG", quality=70)
        out[str(i)] = "data:image/jpeg;base64," + base64.b64encode(buf.getvalue()).decode()
    return {"imagenes": out}
