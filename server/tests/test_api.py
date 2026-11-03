import io
import json
import time
import zipfile

import jwt
import pymupdf
import pytest

from conftest import make_pdf, page_text


def pdf_file(data: bytes, name="doc.pdf"):
    return {"file": (name, data, "application/pdf")}


def test_health(client):
    body = client.get("/api/health").json()
    assert body["ok"] is True and body["version"]


def test_redact_endpoint(client):
    pdf = make_pdf([((72, 60), "HEADER SECRET"), ((72, 600), "Body")])
    regions = [{"page": 0, "x": 0, "y": 0, "width": 1, "height": 0.15}]
    res = client.post("/api/redact", files=pdf_file(pdf), data={"regions": json.dumps(regions)})
    assert res.status_code == 200
    assert "HEADER" not in page_text(res.content)


def test_redact_nothing_requested(client):
    res = client.post("/api/redact", files=pdf_file(make_pdf([((72, 72), "x")])))
    assert res.status_code == 400


def test_rejects_non_pdf(client):
    res = client.post("/api/redact", files=pdf_file(b"hello", "x.txt"), data={"terms": '["a"]'})
    assert res.status_code == 400


def test_search_endpoint(client):
    pdf = make_pdf([((72, 72), "Call 614-555-0199")])
    res = client.post("/api/redact/search", files=pdf_file(pdf), data={"patterns": '["phone"]'})
    hits = res.json()
    assert len(hits) == 1 and hits[0]["text"] == "614-555-0199"
    assert 0 <= hits[0]["x"] < 1 and 0 <= hits[0]["y"] < 1


def test_split_endpoint(client):
    pdf = make_pdf([((72, 72), "Page {n}")], pages=5)
    parts = [{"name": "intro", "start": 0, "end": 1}, {"name": "rest", "start": 2, "end": 4}]
    res = client.post("/api/split", files=pdf_file(pdf), data={"parts": json.dumps(parts)})
    zf = zipfile.ZipFile(io.BytesIO(res.content))
    assert zf.namelist() == ["intro.pdf", "rest.pdf"]
    rest = zf.read("rest.pdf")
    assert pymupdf.open(stream=rest, filetype="pdf").page_count == 3
    assert "Page 3" in page_text(rest)


def test_split_out_of_range(client):
    pdf = make_pdf([((72, 72), "x")], pages=2)
    res = client.post("/api/split", files=pdf_file(pdf), data={"parts": '[{"start":0,"end":5}]'})
    assert res.status_code == 400


def test_split_chosen_pages_single_pdf(client):
    """Pages 1, 3, 5 into one file: a plain PDF, the skipped pages are not in it."""
    pdf = make_pdf([((72, 72), "Page {n}")], pages=5)
    parts = [{"name": "picked", "pages": [0, 2, 4]}]
    res = client.post("/api/split", files=pdf_file(pdf), data={"parts": json.dumps(parts)})
    assert res.status_code == 200
    assert res.headers["content-type"] == "application/pdf"
    assert "picked.pdf" in res.headers["content-disposition"]
    doc = pymupdf.open(stream=res.content, filetype="pdf")
    assert [doc[i].get_text().strip() for i in range(doc.page_count)] == ["Page 1", "Page 3", "Page 5"]
    for skipped in ("Page 2", "Page 4"):
        assert not any(page.search_for(skipped) for page in doc)


def test_split_chosen_pages_zip(client):
    pdf = make_pdf([((72, 72), "Page {n}")], pages=6)
    parts = [{"name": "a", "pages": [0, 2]}, {"name": "b", "pages": [5, 3]}]
    res = client.post("/api/split", files=pdf_file(pdf), data={"parts": json.dumps(parts)})
    assert res.headers["content-type"] == "application/zip"
    zf = zipfile.ZipFile(io.BytesIO(res.content))
    assert zf.namelist() == ["a.pdf", "b.pdf"]
    b = pymupdf.open(stream=zf.read("b.pdf"), filetype="pdf")
    assert [p.get_text().strip() for p in b] == ["Page 6", "Page 4"]


@pytest.mark.parametrize(
    "parts",
    [
        [{"pages": []}],
        [{"pages": [0, 9]}],
        [{"pages": [-1]}],
        [{"pages": [0], "start": 0, "end": 0}],
        [{"start": 1}],
        [],
    ],
)
def test_split_bad_parts(client, parts):
    pdf = make_pdf([((72, 72), "x")], pages=3)
    res = client.post("/api/split", files=pdf_file(pdf), data={"parts": json.dumps(parts)})
    assert res.status_code == 400


def test_merge_endpoint(client):
    a = make_pdf([((72, 72), "A{n}")], pages=2)
    b = make_pdf([((72, 72), "B{n}")], pages=1)
    res = client.post(
        "/api/merge",
        files=[("files", ("a.pdf", a, "application/pdf")), ("files", ("b.pdf", b, "application/pdf"))],
    )
    assert pymupdf.open(stream=res.content, filetype="pdf").page_count == 3
    assert "B1" in page_text(res.content, 2)


def test_organize_reorders_rotates_deletes(client):
    pdf = make_pdf([((72, 72), "P{n}")], pages=3)
    spec = [{"source": 2, "rotate": 90}, {"source": 0}]
    res = client.post("/api/organize", files=pdf_file(pdf), data={"pages": json.dumps(spec)})
    doc = pymupdf.open(stream=res.content, filetype="pdf")
    assert doc.page_count == 2
    assert "P3" in doc[0].get_text() and doc[0].rotation == 90
    assert "P1" in doc[1].get_text()


@pytest.mark.parametrize("fmt", ["txt", "docx", "html", "md", "json", "rtf"])
def test_export_formats(client, fmt):
    pdf = make_pdf([((72, 72), "Quarterly usage report")])
    res = client.post("/api/export", files=pdf_file(pdf), data={"format": fmt})
    assert res.status_code == 200
    assert res.headers["x-extraction-method"] == "text-layer"
    if fmt == "docx":
        from docx import Document

        text = "\n".join(p.text for p in Document(io.BytesIO(res.content)).paragraphs)
    else:
        text = res.content.decode()
    assert "Quarterly usage report" in text


def test_export_bad_format(client):
    res = client.post("/api/export", files=pdf_file(make_pdf([((72, 72), "x")])), data={"format": "exe"})
    assert res.status_code == 400


# --- auth -------------------------------------------------------------------


@pytest.fixture
def secured(monkeypatch):
    from fastapi.testclient import TestClient

    monkeypatch.delenv("AUTH_DISABLED", raising=False)
    monkeypatch.setenv("JWT_SECRET", "test-secret")
    from app.main import app

    return TestClient(app)


def token(secret="test-secret", **claims):
    base = {"sub": "u1", "org": "o1", "role": "BROKER", "exp": int(time.time()) + 600}
    return jwt.encode({**base, **claims}, secret, algorithm="HS256")


def test_protected_without_token(secured):
    assert secured.get("/api/auth/me").status_code == 401
    assert secured.get("/api/health").status_code == 200


def test_valid_energia_token(secured):
    res = secured.get("/api/auth/me", headers={"Authorization": f"Bearer {token()}"})
    assert res.status_code == 200 and res.json()["id"] == "u1"


def test_session_cookie(secured):
    secured.cookies.set("pdfedit_session", token())
    assert secured.get("/api/auth/me").status_code == 200


@pytest.mark.parametrize(
    "bad",
    [
        token(secret="other-secret"),
        token(exp=int(time.time()) - 10),
        "not-a-jwt",
    ],
)
def test_rejected_tokens(secured, bad):
    assert secured.get("/api/auth/me", headers={"Authorization": f"Bearer {bad}"}).status_code == 401


def test_must_change_password_blocked(secured):
    res = secured.get("/api/auth/me", headers={"Authorization": f"Bearer {token(must_change_password=True)}"})
    assert res.status_code == 403
