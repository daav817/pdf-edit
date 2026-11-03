"""Import from Google Drive through energia-app.

Staff connect Google once in energia-app (account menu → Connect Google);
energia-app keeps their Google tokens. pdf-edit never sees those tokens: it
calls energia-app's Drive routes with the user's energia session token, so each
person sees only their own Drive.

Settings (environment):
  ENERGIA_APP_URL     energia-app base URL inside the cluster (same as sign-in)
  ENERGIA_PUBLIC_URL  energia-app address staff open, for "connect Google" hints
"""

from __future__ import annotations

import json
import os
import re
import urllib.error
import urllib.parse
import urllib.request

from fastapi import HTTPException

FOLDER = "application/vnd.google-apps.folder"
GOOGLE_DOC = "application/vnd.google-apps.document"
GOOGLE_SLIDES = "application/vnd.google-apps.presentation"
IMAGE_TYPES = {"image/jpeg", "image/png"}


def _base() -> str:
    base = os.environ.get("ENERGIA_APP_URL", "").rstrip("/")
    if not base:
        raise HTTPException(500, "Server misconfigured: ENERGIA_APP_URL is not set.")
    return base


def _connect_hint() -> str:
    where = os.environ.get("ENERGIA_PUBLIC_URL", "").strip() or "energia-app"
    return (
        f"Google Drive is not connected for your account. Open {where}, choose "
        "Connect Google in your account menu, then try again."
    )


def import_kind(name: str, mime: str) -> str | None:
    """How a Drive item can be opened here: "pdf", "image", "google" (exported
    to PDF by energia-app), or None when it can't be imported."""
    if mime == "application/pdf":
        return "pdf"
    if mime == "application/octet-stream" and name.lower().endswith(".pdf"):
        return "pdf"
    if mime in IMAGE_TYPES:
        return "image"
    if mime in (GOOGLE_DOC, GOOGLE_SLIDES):
        return "google"
    return None


def _call(token: str, path: str, timeout: float = 30, data: bytes | None = None, content_type: str = ""):
    headers = {"Authorization": f"Bearer {token}"}
    if content_type:
        headers["Content-Type"] = content_type
    req = urllib.request.Request(
        f"{_base()}{path}", data=data, headers=headers, method="POST" if data is not None else "GET"
    )
    try:
        return urllib.request.urlopen(req, timeout=timeout)
    except urllib.error.HTTPError as err:
        try:
            message = str(json.load(err).get("error") or "")
        except Exception:
            message = ""
        if err.code == 401:
            raise HTTPException(401, "Your session ended. Sign in again.")
        if "not connected" in message.lower() or "oauth" in message.lower():
            raise HTTPException(409, _connect_hint())
        if err.code == 404:
            raise HTTPException(404, "That file is no longer in Google Drive.")
        raise HTTPException(502, message or "Google Drive did not answer. Try again.")
    except (urllib.error.URLError, TimeoutError):
        raise HTTPException(502, "Could not reach energia-app for Google Drive.")


def list_files(token: str, folder_id: str = "", query: str = "") -> dict:
    """One folder (or a name search inside it): folders plus importable files."""
    params = {"kind": "all"}
    if folder_id:
        params["folderId"] = folder_id
    if query:
        params["query"] = query
    with _call(token, f"/api/google-drive/files?{urllib.parse.urlencode(params)}") as res:
        body = json.load(res)
    items = []
    for f in body.get("files", []):
        name, mime = str(f.get("name") or ""), str(f.get("mimeType") or "")
        if not f.get("id"):
            continue
        is_folder = mime == FOLDER
        kind = None if is_folder else import_kind(name, mime)
        if not is_folder and kind is None:
            continue
        items.append(
            {
                "id": f["id"],
                "name": name,
                "mimeType": mime,
                "isFolder": is_folder,
                "kind": kind,
                "modifiedTime": f.get("modifiedTime"),
                "size": f.get("size"),
                "owner": f.get("ownerName"),
            }
        )
    return {
        "folderId": body.get("currentFolderId") or folder_id or "root",
        "breadcrumbs": [
            {"id": b.get("id"), "name": b.get("name")} for b in body.get("breadcrumbs", [])
        ],
        "files": items,
    }


def _filename(disposition: str, fallback: str) -> str:
    m = re.search(r"filename\*=UTF-8''([^;]+)", disposition, re.I)
    if m:
        return urllib.parse.unquote(m.group(1))
    m = re.search(r'filename="([^"]+)"', disposition)
    return m.group(1) if m else fallback


def download(token: str, file_id: str, max_bytes: int) -> tuple[bytes, str, str]:
    """(bytes, content type, file name). Google Docs/Slides arrive as PDF."""
    if not re.fullmatch(r"[A-Za-z0-9_-]{5,200}", file_id):
        raise HTTPException(400, "Invalid Drive file id.")
    with _call(token, f"/api/google-drive/files/{file_id}/download", timeout=120) as res:
        data = res.read(max_bytes + 1)
        content_type = res.headers.get("Content-Type", "application/octet-stream")
        name = _filename(res.headers.get("Content-Disposition", ""), "drive-file")
    if len(data) > max_bytes:
        raise HTTPException(413, f"File is larger than {max_bytes // (1024 * 1024)} MB.")
    if data.startswith(b"%PDF"):
        content_type = "application/pdf"
        if not name.lower().endswith(".pdf"):
            name += ".pdf"
    elif content_type.split(";")[0].strip() not in IMAGE_TYPES:
        raise HTTPException(415, f"{name} is not a PDF, JPG or PNG.")
    return data, content_type.split(";")[0].strip(), name


def _safe_name(name: str) -> str:
    name = re.sub(r'[/\\?%*:|"<>\x00-\x1f]', "_", name).strip(". ") or "document"
    if not name.lower().endswith(".pdf"):
        name += ".pdf"
    return name[:200]


def _multipart(fields: dict[str, str], file_field: str, filename: str, data: bytes) -> tuple[bytes, str]:
    boundary = "pdfedit" + os.urandom(12).hex()
    out = bytearray()
    for key, value in fields.items():
        out += f'--{boundary}\r\nContent-Disposition: form-data; name="{key}"\r\n\r\n'.encode()
        out += value.encode("utf-8") + b"\r\n"
    safe = filename.replace('"', "_")
    out += (
        f'--{boundary}\r\nContent-Disposition: form-data; name="{file_field}"; filename="{safe}"\r\n'
        "Content-Type: application/pdf\r\n\r\n"
    ).encode("utf-8")
    out += data + b"\r\n" + f"--{boundary}--\r\n".encode()
    return bytes(out), f"multipart/form-data; boundary={boundary}"


def upload_pdf(token: str, data: bytes, name: str, folder_id: str) -> dict:
    """Put a PDF into a Drive folder (as the signed-in user). Returns id, name, link."""
    if not data.startswith(b"%PDF"):
        raise HTTPException(400, "Only PDFs can be saved to Google Drive here.")
    if folder_id and not re.fullmatch(r"[A-Za-z0-9_-]{1,200}", folder_id):
        raise HTTPException(400, "Invalid Drive folder id.")
    name = _safe_name(name)
    body, content_type = _multipart(
        {"folderId": folder_id or "root", "filename": name}, "file", name, data
    )
    with _call(token, "/api/google-drive/upload", timeout=120, data=body, content_type=content_type) as res:
        reply = json.load(res)
    if not reply.get("id"):
        raise HTTPException(502, "Google Drive did not confirm the upload.")
    return {"id": reply["id"], "name": reply.get("name") or name, "webViewLink": reply.get("webViewLink")}
