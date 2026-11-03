"""Remove the original words under edited text, so Save leaves no trace of them.

When a user edits text, the screen draws the new words over a white box. On
its own that only hides the old words: they are still in the page content and
can be copied, searched or read by a screen reader. Before the new text is
drawn, the client sends each edited area here and gets back the PDF with the
characters in those areas deleted from the page content.

Only text is removed. Images and drawings stay, because the white box covers
them anyway and removing them could leave holes in things like table lines
that run through the edited area.
"""

from __future__ import annotations

import pymupdf

from app.coords import NormRect, to_page_rect

# Each character is removed through a mark slightly smaller than the character
# itself, so the mark never reaches a neighbouring character on the same line
# or on the line above or below.
_SHRINK = 0.25


def _chars_to_remove(page: pymupdf.Page, areas: list[pymupdf.Rect]) -> list[pymupdf.Rect]:
    """Each character whose centre is inside an area, as a shrunken box.

    Going by the centre keeps text that only touches an area's edge, e.g. the
    descenders of the line above an edited line.
    """
    marks: list[pymupdf.Rect] = []
    raw = page.get_text("rawdict", flags=pymupdf.TEXTFLAGS_RAWDICT)
    for block in raw["blocks"]:
        for line in block.get("lines", []):
            for span in line["spans"]:
                for ch in span["chars"]:
                    box = pymupdf.Rect(ch["bbox"])
                    if box.is_empty:
                        continue
                    centre = pymupdf.Point((box.x0 + box.x1) / 2, (box.y0 + box.y1) / 2)
                    if not any(centre in area for area in areas):
                        continue
                    dx = box.width * _SHRINK
                    dy = box.height * _SHRINK
                    marks.append(pymupdf.Rect(box.x0 + dx, box.y0 + dy, box.x1 - dx, box.y1 - dy))
    return marks


def remove_text(pdf_bytes: bytes, regions: list[NormRect]) -> bytes:
    """Delete the characters inside each area and return the new PDF bytes."""
    doc = pymupdf.open(stream=pdf_bytes, filetype="pdf")
    try:
        by_page: dict[int, list[pymupdf.Rect]] = {}
        for r in regions:
            if 0 <= r.page < doc.page_count:
                by_page.setdefault(r.page, []).append(to_page_rect(doc[r.page], r))

        for page_no, areas in by_page.items():
            page = doc[page_no]
            marks = _chars_to_remove(page, areas)
            if not marks:
                continue
            for mark in marks:
                page.add_redact_annot(mark, fill=False)
            page.apply_redactions(
                images=pymupdf.PDF_REDACT_IMAGE_NONE,
                graphics=pymupdf.PDF_REDACT_LINE_ART_NONE,
                text=pymupdf.PDF_REDACT_TEXT_REMOVE,
            )

        # A full rewrite (not an incremental save) drops the old page content.
        return doc.tobytes(garbage=4, deflate=True, clean=True)
    finally:
        doc.close()
