"""Split, merge and organize pages."""

from __future__ import annotations

import io
import re
import zipfile

from pydantic import BaseModel, Field

import pymupdf


class SplitPart(BaseModel):
    name: str = ""
    start: int = Field(ge=0, description="first page, 0-based")
    end: int = Field(ge=0, description="last page, 0-based, inclusive")


class PageSpec(BaseModel):
    source: int = Field(ge=0, description="0-based page in the input")
    rotate: int = Field(default=0, description="extra clockwise rotation, multiple of 90")


def safe_pdf_name(name: str, index: int) -> str:
    raw = re.sub(r'[<>:"/\\|?*\x00-\x1f]', "_", name.strip()).strip(". ")
    if raw.lower().endswith(".pdf"):
        raw = raw[:-4].strip()
    return (raw or f"part_{index + 1:03d}") + ".pdf"


def _unique(names: list[str]) -> list[str]:
    seen: set[str] = set()
    out = []
    for name in names:
        stem, candidate, n = name[:-4], name, 0
        while candidate.lower() in seen:
            n += 1
            candidate = f"{stem}_{n}.pdf"
        seen.add(candidate.lower())
        out.append(candidate)
    return out


def split_to_zip(pdf_bytes: bytes, parts: list[SplitPart]) -> bytes:
    """One PDF per part, in a ZIP. Parts may overlap or skip pages."""
    src = pymupdf.open(stream=pdf_bytes, filetype="pdf")
    try:
        if not parts:
            raise ValueError("No parts given.")
        for p in parts:
            if p.start > p.end or p.end >= src.page_count:
                raise ValueError(
                    f"Pages {p.start + 1}-{p.end + 1} are outside 1-{src.page_count}."
                )
        names = _unique([safe_pdf_name(p.name, i) for i, p in enumerate(parts)])
        buf = io.BytesIO()
        with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
            for part, name in zip(parts, names):
                out = pymupdf.open()
                out.insert_pdf(src, from_page=part.start, to_page=part.end)
                zf.writestr(name, out.tobytes(garbage=3, deflate=True))
                out.close()
        return buf.getvalue()
    finally:
        src.close()


def merge(pdfs: list[bytes]) -> bytes:
    if not pdfs:
        raise ValueError("No files given.")
    out = pymupdf.open()
    try:
        for data in pdfs:
            src = pymupdf.open(stream=data, filetype="pdf")
            out.insert_pdf(src)
            src.close()
        return out.tobytes(garbage=3, deflate=True)
    finally:
        out.close()


def organize(pdf_bytes: bytes, pages: list[PageSpec]) -> bytes:
    """Build a new PDF from a list of source pages: reorder, delete, rotate, extract."""
    src = pymupdf.open(stream=pdf_bytes, filetype="pdf")
    out = pymupdf.open()
    try:
        if not pages:
            raise ValueError("The result would have no pages.")
        for spec in pages:
            if spec.source >= src.page_count:
                raise ValueError(f"Page {spec.source + 1} does not exist.")
            if spec.rotate % 90:
                raise ValueError("Rotation must be a multiple of 90 degrees.")
            out.insert_pdf(src, from_page=spec.source, to_page=spec.source)
            if spec.rotate:
                page = out[-1]
                page.set_rotation((page.rotation + spec.rotate) % 360)
        return out.tobytes(garbage=3, deflate=True)
    finally:
        out.close()
        src.close()
