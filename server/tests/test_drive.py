"""Google Drive import through energia-app, against a fake energia-app."""

import json
import threading
import time
from http.server import BaseHTTPRequestHandler, HTTPServer

import jwt
import pytest
from fastapi.testclient import TestClient

from conftest import make_pdf

SECRET = "drive-test-secret-0123456789abcdef"
PDF = make_pdf([((72, 72), "From Drive")])

FILES = {
    "currentFolderId": "root",
    "breadcrumbs": [{"id": "root", "name": "My Drive"}],
    "files": [
        {"id": "folder123", "name": "Contracts", "mimeType": "application/vnd.google-apps.folder"},
        {"id": "pdf12345", "name": "bill.pdf", "mimeType": "application/pdf", "size": 1000},
        {"id": "oct12345", "name": "scan.PDF", "mimeType": "application/octet-stream"},
        {"id": "img12345", "name": "photo.jpg", "mimeType": "image/jpeg"},
        {"id": "doc12345", "name": "Letter", "mimeType": "application/vnd.google-apps.document"},
        {"id": "xls12345", "name": "Usage", "mimeType": "application/vnd.google-apps.spreadsheet"},
        {"id": "zip12345", "name": "old.zip", "mimeType": "application/zip"},
    ],
}


class FakeEnergia(BaseHTTPRequestHandler):
    seen: list[tuple[str, str]] = []
    connected = True

    def log_message(self, *_):
        pass

    def _json(self, code, body):
        raw = json.dumps(body).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)

    def do_GET(self):
        FakeEnergia.seen.append((self.path, self.headers.get("Authorization", "")))
        if not FakeEnergia.connected:
            return self._json(500, {"error": "Gmail not connected. Complete OAuth flow first."})
        if self.path.startswith("/api/google-drive/files?"):
            return self._json(200, FILES)
        if self.path == "/api/google-drive/files/pdf12345/download":
            self.send_response(200)
            self.send_header("Content-Type", "application/pdf")
            self.send_header("Content-Disposition", "attachment; filename=\"bill.pdf\"; filename*=UTF-8''bill%20%C3%A9.pdf")
            self.send_header("Content-Length", str(len(PDF)))
            self.end_headers()
            self.wfile.write(PDF)
            return
        if self.path == "/api/google-drive/files/zip12345/download":
            self.send_response(200)
            self.send_header("Content-Type", "application/zip")
            self.end_headers()
            self.wfile.write(b"PK\x03\x04")
            return
        return self._json(404, {"error": "File not found"})


@pytest.fixture
def energia():
    server = HTTPServer(("127.0.0.1", 0), FakeEnergia)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    FakeEnergia.seen = []
    FakeEnergia.connected = True
    yield f"http://127.0.0.1:{server.server_port}"
    server.shutdown()


@pytest.fixture
def signed_in(monkeypatch, energia):
    monkeypatch.delenv("AUTH_DISABLED", raising=False)
    monkeypatch.setenv("JWT_SECRET", SECRET)
    monkeypatch.setenv("ENERGIA_APP_URL", energia)
    monkeypatch.setenv("ENERGIA_PUBLIC_URL", "https://crm.example.test")
    from app.main import app

    token = jwt.encode({"sub": "u1", "org": "o1", "role": "staff", "exp": int(time.time()) + 600}, SECRET, algorithm="HS256")
    c = TestClient(app)
    c.cookies.set("pdfedit_session", token)
    return c, token


def test_list_shows_folders_and_importable_files_only(signed_in):
    c, token = signed_in
    res = c.get("/api/drive/files", params={"folderId": "folder123", "query": "bill"})
    assert res.status_code == 200
    body = res.json()
    assert [(f["id"], f["kind"]) for f in body["files"]] == [
        ("folder123", None),
        ("pdf12345", "pdf"),
        ("oct12345", "pdf"),
        ("img12345", "image"),
        ("doc12345", "google"),
    ]
    assert body["breadcrumbs"] == [{"id": "root", "name": "My Drive"}]
    path, auth_header = FakeEnergia.seen[-1]
    # Called as the signed-in user, with their folder and search.
    assert auth_header == f"Bearer {token}"
    assert "folderId=folder123" in path and "query=bill" in path


def test_download_pdf(signed_in):
    c, _ = signed_in
    res = c.get("/api/drive/files/pdf12345/download")
    assert res.status_code == 200
    assert res.headers["content-type"] == "application/pdf"
    assert res.content == PDF
    assert "bill%20%C3%A9.pdf" in res.headers["content-disposition"]


def test_download_rejects_other_types(signed_in):
    c, _ = signed_in
    assert c.get("/api/drive/files/zip12345/download").status_code == 415


def test_download_bad_id(signed_in):
    c, _ = signed_in
    assert c.get("/api/drive/files/a..b/download").status_code in (400, 404)
    assert c.get("/api/drive/files/missing1/download").status_code == 404


def test_not_connected_points_to_energia(signed_in):
    c, _ = signed_in
    FakeEnergia.connected = False
    res = c.get("/api/drive/files")
    assert res.status_code == 409
    assert "Connect Google" in res.json()["detail"]
    assert "https://crm.example.test" in res.json()["detail"]


def test_requires_sign_in(signed_in):
    c, _ = signed_in
    c.cookies.clear()
    assert c.get("/api/drive/files").status_code == 401
    assert FakeEnergia.seen == []


def test_dev_mode_has_no_drive(client):
    assert client.get("/api/drive/files").status_code == 503


class FakeEnergiaUpload(FakeEnergia):
    uploads: list[bytes] = []

    def do_POST(self):
        FakeEnergia.seen.append((self.path, self.headers.get("Authorization", "")))
        if self.path != "/api/google-drive/upload":
            return self._json(404, {})
        body = self.rfile.read(int(self.headers.get("Content-Length", 0)))
        FakeEnergiaUpload.uploads.append(body)
        if not self.headers.get("Content-Type", "").startswith("multipart/form-data; boundary="):
            return self._json(400, {"error": "Use multipart/form-data with a file field."})
        return self._json(200, {"id": "new12345", "name": "part1.pdf", "webViewLink": "https://drive.example/new12345"})


@pytest.fixture
def uploader(monkeypatch):
    server = HTTPServer(("127.0.0.1", 0), FakeEnergiaUpload)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    FakeEnergia.seen = []
    FakeEnergia.connected = True
    FakeEnergiaUpload.uploads = []
    monkeypatch.delenv("AUTH_DISABLED", raising=False)
    monkeypatch.setenv("JWT_SECRET", SECRET)
    monkeypatch.setenv("ENERGIA_APP_URL", f"http://127.0.0.1:{server.server_port}")
    from app.main import app

    token = jwt.encode({"sub": "u1", "org": "o1", "role": "staff", "exp": int(time.time()) + 600}, SECRET, algorithm="HS256")
    c = TestClient(app)
    c.cookies.set("pdfedit_session", token)
    yield c, token
    server.shutdown()


def test_upload_pdf_to_folder(uploader):
    c, token = uploader
    res = c.post(
        "/api/drive/upload",
        files={"file": ("x.pdf", PDF, "application/pdf")},
        data={"name": 'part "1"', "folderId": "folder123"},
    )
    assert res.status_code == 200
    assert res.json() == {"id": "new12345", "name": "part1.pdf", "webViewLink": "https://drive.example/new12345"}
    body = FakeEnergiaUpload.uploads[-1]
    assert b'name="folderId"\r\n\r\nfolder123\r\n' in body
    assert b'name="filename"\r\n\r\npart _1_.pdf\r\n' in body or b'part "1".pdf' in body
    assert PDF in body
    assert FakeEnergia.seen[-1] == ("/api/google-drive/upload", f"Bearer {token}")


def test_upload_rejects_non_pdf_and_bad_folder(uploader):
    c, _ = uploader
    assert c.post("/api/drive/upload", files={"file": ("x.pdf", b"hello", "application/pdf")}).status_code == 400
    res = c.post("/api/drive/upload", files={"file": ("x.pdf", PDF, "application/pdf")}, data={"folderId": "../x"})
    assert res.status_code == 400
    assert FakeEnergiaUpload.uploads == []
