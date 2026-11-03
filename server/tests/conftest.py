import sys
from pathlib import Path

import pymupdf
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))


def make_pdf(lines: list[tuple[tuple[float, float], str]], rotation: int = 0, cropbox=None, pages: int = 1) -> bytes:
    """A letter-size PDF with text at the given unrotated points."""
    doc = pymupdf.open()
    for n in range(pages):
        page = doc.new_page(width=612, height=792)
        for point, text in lines:
            page.insert_text(point, text.replace("{n}", str(n + 1)), fontsize=14)
        if cropbox:
            page.set_cropbox(pymupdf.Rect(*cropbox))
        if rotation:
            page.set_rotation(rotation)
    data = doc.tobytes()
    doc.close()
    return data


def page_text(pdf: bytes, page: int = 0) -> str:
    doc = pymupdf.open(stream=pdf, filetype="pdf")
    try:
        return doc[page].get_text()
    finally:
        doc.close()


@pytest.fixture
def client(monkeypatch):
    from fastapi.testclient import TestClient

    monkeypatch.setenv("AUTH_DISABLED", "1")
    from app.main import app

    return TestClient(app)
