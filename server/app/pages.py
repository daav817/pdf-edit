"""Split, merge and organize pages."""

from __future__ import annotations

import io
import re
import zipfile

from pydantic import BaseModel, Field, model_validator

import pymupdf


class SplitPart(BaseModel):
    """One output file: either a page range (start..end) or a list of pages."""

    name: str = ""
    start: int | None = Field(default=None, ge=0, description="first page, 0-based")
    end: int | None = Field(default=None, ge=0, description="last page, 0-based, inclusive")
    pages: list[int] | None = Field(
        default=None, description="0-based pages in output order; others are left out"
    )

    @model_validator(mode="after")
    def _one_form(self):
        has_range = self.start is not None or self.end is not None
        if self.pages is not None:
            if has_range:
                raise ValueError("Give either pages or start/end, not both.")
            if not self.pages:
                raise ValueError("A part needs at least one page.")
            if any(n < 0 for n in self.pages):
                raise ValueError("Page numbers cannot be negative.")
        elif self.start is None or self.end is None:
            raise ValueError("Give pages, or both start and end.")
        elif self.start > self.end:
            raise ValueError("start must not be after end.")
        return self

    def page_list(self) -> list[int]:
        if self.pages is not None:
            return list(self.pages)
        return list(range(self.start, self.end + 1))  # type: ignore[arg-type]


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


def _extract(src: pymupdf.Document, page_list: list[int]) -> bytes:
    out = pymupdf.open()
    try:
        for n in page_list:
            out.insert_pdf(src, from_page=n, to_page=n)
        return out.tobytes(garbage=3, deflate=True)
    finally:
        out.close()


def split(pdf_bytes: bytes, parts: list[SplitPart]) -> tuple[bytes, str, str]:
    """Build the parts. Returns (body, media type, file name).

    One part gives a plain PDF; several give a ZIP with one PDF each. Parts may
    overlap, skip pages, or list pages in any order.
    """
    src = pymupdf.open(stream=pdf_bytes, filetype="pdf")
    try:
        if not parts:
            raise ValueError("No parts given.")
        lists = [p.page_list() for p in parts]
        for pl in lists:
            bad = [n for n in pl if n >= src.page_count]
            if bad:
                raise ValueError(
                    f"Page {bad[0] + 1} is outside 1-{src.page_count}."
                )
        names = _unique([safe_pdf_name(p.name, i) for i, p in enumerate(parts)])
        if len(parts) == 1:
            return _extract(src, lists[0]), "application/pdf", names[0]
        buf = io.BytesIO()
        with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
            for pl, name in zip(lists, names):
                zf.writestr(name, _extract(src, pl))
        return buf.getvalue(), "application/zip", ""
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
