"""Export a PDF's text as TXT, DOCX, HTML, Markdown, JSON or RTF.

Ported from pdf-viewer's Node export server. Text comes from the PDF's own text
layer; pages without one are read with OCR when Tesseract is installed.
"""

from __future__ import annotations

import html
import io
import json
import re
from dataclasses import dataclass

import pymupdf

MIN_TEXT_CHARS = 12
OCR_DPI = 300

FORMATS: dict[str, tuple[str, str]] = {
    "txt": ("txt", "text/plain; charset=utf-8"),
    "docx": (
        "docx",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ),
    "html": ("html", "text/html; charset=utf-8"),
    "md": ("md", "text/markdown; charset=utf-8"),
    "json": ("json", "application/json; charset=utf-8"),
    "rtf": ("rtf", "application/rtf"),
}


@dataclass
class Extracted:
    text: str
    title: str | None
    author: str | None
    pages: int
    method: str  # "text-layer", "ocr", "text-layer+ocr" or "none"


@dataclass
class ExportResult:
    body: bytes
    mime_type: str
    filename: str
    method: str


def _meaningful(text: str) -> bool:
    return len(re.sub(r"\s", "", text)) >= MIN_TEXT_CHARS


def _ocr_page(page: pymupdf.Page) -> str | None:
    """OCR one page, or None when Tesseract is not installed."""
    try:
        tp = page.get_textpage_ocr(dpi=OCR_DPI, full=True)
    except Exception:
        return None
    return page.get_text(textpage=tp)


def extract(pdf_bytes: bytes) -> Extracted:
    doc = pymupdf.open(stream=pdf_bytes, filetype="pdf")
    try:
        parts: list[str] = []
        used_text = used_ocr = False
        for page in doc:
            text = page.get_text().strip()
            if _meaningful(text):
                used_text = True
            else:
                ocr = _ocr_page(page)
                if ocr and ocr.strip():
                    text, used_ocr = ocr.strip(), True
            if text:
                parts.append(text)
        method = (
            "text-layer+ocr"
            if used_text and used_ocr
            else "ocr" if used_ocr else "text-layer" if used_text else "none"
        )
        meta = doc.metadata or {}
        return Extracted(
            text="\n\n".join(parts),
            title=(meta.get("title") or "").strip() or None,
            author=(meta.get("author") or "").strip() or None,
            pages=doc.page_count,
            method=method,
        )
    finally:
        doc.close()


def _paragraphs(text: str) -> list[str]:
    return [p.strip() for p in re.split(r"\n{2,}", text) if p.strip()]


def _safe_name(name: str | None) -> str:
    if not name:
        return ""
    return re.sub(r'[<>:"/\\|?*\x00-\x1f]', "", name).strip()[:120]


def _docx(ex: Extracted) -> bytes:
    from docx import Document

    d = Document()
    if ex.title:
        d.add_heading(ex.title, level=1)
    paras = _paragraphs(ex.text)
    for p in paras or ["(No extractable text)"]:
        d.add_paragraph(p.replace("\n", " "))
    buf = io.BytesIO()
    d.save(buf)
    return buf.getvalue()


def _html(ex: Extracted) -> str:
    title = ex.title or "Exported PDF"
    blocks = "\n".join(
        f"<p>{html.escape(p).replace(chr(10), '<br>')}</p>" for p in _paragraphs(ex.text)
    )
    return f"""<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>{html.escape(title)}</title>
  <style>
    body {{ font-family: Georgia, serif; max-width: 48rem; margin: 2rem auto; line-height: 1.6; padding: 0 1rem; }}
    h1 {{ font-size: 1.5rem; }}
    p {{ margin: 0 0 1rem; }}
  </style>
</head>
<body>
  <h1>{html.escape(title)}</h1>
  {blocks or "<p><em>No extractable text found in this PDF.</em></p>"}
</body>
</html>"""


def _markdown(ex: Extracted) -> str:
    parts = [f"# {ex.title}\n"] if ex.title else []
    paras = _paragraphs(ex.text)
    parts.append("\n\n".join(paras) if paras else "_No extractable text found in this PDF._\n")
    return "\n".join(parts)


def _json(ex: Extracted) -> str:
    return json.dumps(
        {
            "title": ex.title,
            "author": ex.author,
            "pages": ex.pages,
            "extractionMethod": ex.method,
            "text": ex.text,
            "paragraphs": _paragraphs(ex.text),
        },
        indent=2,
        ensure_ascii=False,
    )


def _rtf(ex: Extracted) -> str:
    def esc(s: str) -> str:
        s = s.replace("\\", "\\\\").replace("{", "\\{").replace("}", "\\}")
        s = re.sub(r"\r?\n", r"\\par ", s)
        # Non-ASCII as RTF unicode escapes so Word shows it correctly.
        return "".join(c if ord(c) < 128 else f"\\u{ord(c) if ord(c) < 32768 else ord(c) - 65536}?" for c in s)

    return "{\\rtf1\\ansi\\deff0 " + esc(ex.text or "(No extractable text)") + " }"


def export(pdf_bytes: bytes, fmt: str) -> ExportResult:
    fmt = fmt.lower()
    if fmt not in FORMATS:
        raise ValueError(f'Unsupported format "{fmt}". Use: {", ".join(FORMATS)}.')
    ext, mime = FORMATS[fmt]
    ex = extract(pdf_bytes)
    builders = {
        "txt": lambda: ex.text.encode("utf-8"),
        "docx": lambda: _docx(ex),
        "html": lambda: _html(ex).encode("utf-8"),
        "md": lambda: _markdown(ex).encode("utf-8"),
        "json": lambda: _json(ex).encode("utf-8"),
        "rtf": lambda: _rtf(ex).encode("utf-8"),
    }
    return ExportResult(
        body=builders[fmt](),
        mime_type=mime,
        filename=f"{_safe_name(ex.title) or 'document'}.{ext}",
        method=ex.method,
    )
