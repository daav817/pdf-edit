"""pdf-edit server: the API under /api and the built React screen at /.

Every PDF is handled in memory for the length of one request and never
written to disk.
"""

from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Annotated
from urllib.parse import quote

from fastapi import Depends, FastAPI, File, Form, HTTPException, Request, Response, UploadFile
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, TypeAdapter, ValidationError

from app import auth, drive, export, pages, redact, textedit
from app.coords import NormRect

MAX_UPLOAD_BYTES = int(os.environ.get("MAX_UPLOAD_MB", "100")) * 1024 * 1024
STATIC_DIR = Path(
    os.environ.get("STATIC_DIR", Path(__file__).resolve().parents[2] / "client" / "dist")
)

app = FastAPI(title="pdf-edit", version="0.1.0")

User = Annotated[auth.User, Depends(auth.require_user)]


async def read_pdf(file: UploadFile) -> bytes:
    data = await file.read(MAX_UPLOAD_BYTES + 1)
    if len(data) > MAX_UPLOAD_BYTES:
        raise HTTPException(413, f"File is larger than {MAX_UPLOAD_BYTES // (1024 * 1024)} MB.")
    if not data.startswith(b"%PDF"):
        raise HTTPException(400, f"{file.filename or 'File'} is not a PDF.")
    return data


def parse_json(raw: str, model, field: str):
    try:
        return TypeAdapter(model).validate_json(raw)
    except ValidationError as err:
        raise HTTPException(400, f"Invalid {field}: {err.errors()[0]['msg']}")


def download(body: bytes, media_type: str, filename: str, headers: dict | None = None) -> Response:
    return Response(
        body,
        media_type=media_type,
        headers={
            "Content-Disposition": f"attachment; filename*=UTF-8''{quote(filename)}",
            **(headers or {}),
        },
    )


@app.exception_handler(ValueError)
async def value_error(_request, exc: ValueError):
    return JSONResponse({"detail": str(exc)}, status_code=400)


# --- auth -------------------------------------------------------------------


class LoginBody(BaseModel):
    email: str
    password: str


@app.get("/api/health")
def health():
    return {"ok": True, "version": os.environ.get("APP_VERSION", "dev")}


@app.post("/api/auth/login")
def login(body: LoginBody, response: Response):
    return auth.login(body.email, body.password, response)


@app.post("/api/auth/logout")
def logout(response: Response):
    return auth.logout(response)


# --- Google Drive (through energia-app) ---------------------------------------


def _drive_token(request: Request) -> str:
    token = auth.session_token(request)
    if not token:
        raise HTTPException(503, "Google Drive needs a real sign-in (not available with sign-in switched off).")
    return token


@app.get("/api/drive/files")
def drive_files(request: Request, _user: User, folderId: str = "", query: str = ""):
    return drive.list_files(_drive_token(request), folderId.strip(), query.strip()[:200])


@app.post("/api/drive/upload")
async def drive_upload(
    request: Request,
    _user: User,
    file: UploadFile = File(...),
    name: str = Form(""),
    folderId: str = Form(""),
):
    data = await file.read(MAX_UPLOAD_BYTES + 1)
    if len(data) > MAX_UPLOAD_BYTES:
        raise HTTPException(413, f"File is larger than {MAX_UPLOAD_BYTES // (1024 * 1024)} MB.")
    return drive.upload_file(_drive_token(request), data, name or file.filename or "document.pdf", folderId.strip())


@app.get("/api/drive/files/{file_id}/download")
def drive_download(request: Request, _user: User, file_id: str):
    data, media_type, name = drive.download(_drive_token(request), file_id, MAX_UPLOAD_BYTES)
    return download(data, media_type, name)


@app.get("/api/auth/me")
def me(user: User):
    return {"id": user.id, "org": user.org, "role": user.role, "authDisabled": auth.auth_disabled()}


# --- redact -----------------------------------------------------------------


@app.get("/api/redact/patterns")
def redact_patterns(_user: User):
    return [{"id": k, "label": label} for k, (label, _rx) in redact.PATTERNS.items()]


@app.post("/api/redact/search")
async def redact_search(
    _user: User,
    file: UploadFile = File(...),
    terms: str = Form("[]"),
    patterns: str = Form("[]"),
):
    data = await read_pdf(file)
    return redact.search(data, parse_json(terms, list[str], "terms"), parse_json(patterns, list[str], "patterns"))


@app.post("/api/redact")
async def redact_apply(
    _user: User,
    file: UploadFile = File(...),
    regions: str = Form("[]"),
    terms: str = Form("[]"),
    patterns: str = Form("[]"),
    scrub_metadata: bool = Form(True),
):
    data = await read_pdf(file)
    region_list = parse_json(regions, list[NormRect], "regions")
    term_list = parse_json(terms, list[str], "terms")
    pattern_list = parse_json(patterns, list[str], "patterns")
    if not region_list and not any(t.strip() for t in term_list) and not pattern_list:
        raise HTTPException(400, "Nothing to redact: draw an area or give search terms.")
    out = redact.apply_redactions(data, region_list, term_list, pattern_list, scrub_metadata)
    return download(out, "application/pdf", "redacted.pdf")


# --- text edits -------------------------------------------------------------


@app.post("/api/text/remove")
async def text_remove(_user: User, file: UploadFile = File(...), regions: str = Form("[]")):
    """Delete the original words under edited text before the new text is drawn."""
    data = await read_pdf(file)
    region_list = parse_json(regions, list[NormRect], "regions")
    if not region_list:
        raise HTTPException(400, "No areas given.")
    return download(textedit.remove_text(data, region_list), "application/pdf", file.filename or "document.pdf")


# --- pages ------------------------------------------------------------------


@app.post("/api/split")
async def split(_user: User, file: UploadFile = File(...), parts: str = Form(...)):
    data = await read_pdf(file)
    body, media_type, name = pages.split(data, parse_json(parts, list[pages.SplitPart], "parts"))
    stem = Path(file.filename or "document").stem
    return download(body, media_type, name or f"{stem}_split.zip")


@app.post("/api/merge")
async def merge(_user: User, files: list[UploadFile] = File(...)):
    datas = [await read_pdf(f) for f in files]
    return download(pages.merge(datas), "application/pdf", "merged.pdf")


@app.post("/api/organize")
async def organize(_user: User, file: UploadFile = File(...), pages_json: str = Form(..., alias="pages")):
    data = await read_pdf(file)
    out = pages.organize(data, parse_json(pages_json, list[pages.PageSpec], "pages"))
    return download(out, "application/pdf", file.filename or "document.pdf")


# --- export -----------------------------------------------------------------


@app.post("/api/export")
async def export_text(_user: User, file: UploadFile = File(...), format: str = Form("txt")):
    data = await read_pdf(file)
    result = export.export(data, format)
    # Named after the file staff opened (like every other save); the PDF's own
    # title is only a fallback.
    stem = Path(file.filename or "").stem.strip()
    name = f"{stem}{Path(result.filename).suffix}" if stem else result.filename
    return download(
        result.body,
        result.mime_type,
        name,
        {"X-Extraction-Method": result.method},
    )


# --- screen -----------------------------------------------------------------

# Pages (index.html, viewer.html) are always re-checked, so a new version shows
# on the next normal reload. Files under /assets have the build hash in their
# names, so browsers may keep them for good.
PAGE_CACHE = "no-cache"
ASSET_CACHE = "public, max-age=31536000, immutable"


def cache_control_for(path: str) -> str:
    return ASSET_CACHE if path.startswith("assets/") else PAGE_CACHE


class AssetFiles(StaticFiles):
    async def get_response(self, path, scope):
        response = await super().get_response(path, scope)
        if response.status_code == 200:
            response.headers["Cache-Control"] = ASSET_CACHE
        return response


if STATIC_DIR.is_dir():
    app.mount("/assets", AssetFiles(directory=STATIC_DIR / "assets"), name="assets")

    @app.get("/{path:path}", include_in_schema=False)
    def spa(path: str):
        target = (STATIC_DIR / path).resolve()
        if path and target.is_file() and STATIC_DIR.resolve() in target.parents:
            return FileResponse(target, headers={"Cache-Control": cache_control_for(path)})
        return FileResponse(STATIC_DIR / "index.html", headers={"Cache-Control": PAGE_CACHE})
