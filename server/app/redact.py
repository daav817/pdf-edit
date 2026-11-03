"""Permanent redaction with PyMuPDF.

Redaction removes the text, image pixels and vector graphics under each area
from the PDF itself; nothing can be copied or searched out of it afterwards.
Beyond the page content, a leak can also come from document info, XMP
metadata, bookmarks, comments, form fields and older copies of objects left by
incremental saves, so those are handled too.
"""

from __future__ import annotations

import re

import pymupdf

from app.coords import NormRect, to_norm_rect, to_page_rect

# Patterns offered for search-and-redact. Keys are what the client sends.
PATTERNS: dict[str, tuple[str, str]] = {
    "ssn": ("SSNs", r"\b\d{3}-\d{2}-\d{4}\b"),
    "phone": ("Phone numbers", r"(?:\(\d{3}\)\s?|\b\d{3}[-.\s])\d{3}[-.\s]\d{4}\b"),
    "email": ("Emails", r"\b[\w.+-]+@[\w-]+(?:\.[\w-]+)+\b"),
    "account": ("Account numbers (8+ digits)", r"\b\d{8,20}\b"),
}


def find_matches(
    doc: pymupdf.Document,
    terms: list[str],
    patterns: list[str],
) -> list[tuple[int, pymupdf.Rect, str]]:
    """Every place on every page where a term or pattern occurs.

    Returns (page index, unrotated rect, matched text).
    """
    compiled = []
    for key in patterns:
        if key not in PATTERNS:
            raise ValueError(f"Unknown pattern: {key}")
        compiled.append(re.compile(PATTERNS[key][1]))

    words = [t.strip() for t in terms if t.strip()]
    hits: list[tuple[int, pymupdf.Rect, str]] = []
    for page in doc:
        needles = set(words)
        if compiled:
            text = page.get_text()
            for rx in compiled:
                needles.update(m.group(0) for m in rx.finditer(text))
        for needle in sorted(needles):
            for rect in page.search_for(needle):
                hits.append((page.number, rect, needle))
    return hits


def search(pdf_bytes: bytes, terms: list[str], patterns: list[str]) -> list[dict]:
    """Matches as visible-page fractions, for the client to preview."""
    doc = pymupdf.open(stream=pdf_bytes, filetype="pdf")
    try:
        out = []
        for page_no, rect, text in find_matches(doc, terms, patterns):
            norm = to_norm_rect(doc[page_no], rect)
            out.append({**norm.model_dump(), "text": text})
        return out
    finally:
        doc.close()


def _strip_overlapping_annots(page: pymupdf.Page, rects: list[pymupdf.Rect]) -> None:
    """Remove comments and form fields that sit under a redaction area."""
    for annot in list(page.annots() or []):
        if annot.type[0] == pymupdf.PDF_ANNOT_REDACT:
            continue
        if any(annot.rect.intersects(r) for r in rects):
            page.delete_annot(annot)
    for widget in list(page.widgets() or []):
        if any(widget.rect.intersects(r) for r in rects):
            page.delete_widget(widget)


def _strip_annots_mentioning(doc: pymupdf.Document, removed: set[str]) -> None:
    """Remove comments and form fields whose text contains anything redacted."""

    def mentions(*values) -> bool:
        return any(t in (v or "") for v in values for t in removed)

    for page in doc:
        for annot in list(page.annots() or []):
            info = annot.info
            if mentions(info.get("content"), info.get("title"), info.get("subject")):
                page.delete_annot(annot)
        for widget in list(page.widgets() or []):
            if mentions(str(widget.field_value or ""), widget.field_label):
                page.delete_widget(widget)


def apply_redactions(
    pdf_bytes: bytes,
    regions: list[NormRect],
    terms: list[str] | None = None,
    patterns: list[str] | None = None,
    scrub_metadata: bool = True,
) -> bytes:
    """Apply permanent redactions and return the new PDF bytes."""
    doc = pymupdf.open(stream=pdf_bytes, filetype="pdf")
    try:
        by_page: dict[int, list[pymupdf.Rect]] = {}
        for r in regions:
            if 0 <= r.page < doc.page_count:
                by_page.setdefault(r.page, []).append(to_page_rect(doc[r.page], r))

        removed_text: set[str] = set()
        for page_no, rect, text in find_matches(doc, terms or [], patterns or []):
            by_page.setdefault(page_no, []).append(rect)
            removed_text.add(text)

        for page_no, rects in by_page.items():
            page = doc[page_no]
            for rect in rects:
                snippet = page.get_textbox(rect).strip()
                if snippet:
                    removed_text.add(snippet)
            _strip_overlapping_annots(page, rects)
            for rect in rects:
                page.add_redact_annot(rect, fill=(0, 0, 0))
            page.apply_redactions(
                images=pymupdf.PDF_REDACT_IMAGE_PIXELS,
                graphics=pymupdf.PDF_REDACT_LINE_ART_REMOVE_IF_TOUCHED,
            )

        if removed_text:
            # Comments and form values anywhere in the file can repeat it too.
            _strip_annots_mentioning(doc, removed_text)
            # Bookmark titles can repeat what was on the page.
            toc = doc.get_toc(simple=False)
            kept = [e for e in toc if not any(t in e[1] for t in removed_text)]
            if len(kept) != len(toc):
                doc.set_toc(kept)

        if scrub_metadata:
            doc.set_metadata({})
            doc.del_xml_metadata()

        # A full rewrite (not an incremental save) drops old object copies.
        return doc.tobytes(garbage=4, deflate=True, clean=True)
    finally:
        doc.close()
