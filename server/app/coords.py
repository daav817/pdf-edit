"""Convert between the browser's view of a page and PyMuPDF page coordinates.

The client draws on the page exactly as PDF.js shows it: rotation applied and
cropped to the CropBox. It sends rectangles as fractions (0..1) of that visible
page, so they do not depend on zoom. PyMuPDF's ``page.rect`` is that same
visible box, and ``page.derotation_matrix`` maps it back to the unrotated
coordinates that redaction and text search use.
"""

from __future__ import annotations

from pydantic import BaseModel, Field

import pymupdf


class NormRect(BaseModel):
    """A rectangle on one page, as fractions of the visible page."""

    page: int = Field(ge=0, description="0-based page index")
    x: float
    y: float
    width: float = Field(gt=0)
    height: float = Field(gt=0)


def to_page_rect(page: pymupdf.Page, r: NormRect) -> pymupdf.Rect:
    """Visible-page fractions -> unrotated PyMuPDF coordinates."""
    vis = page.rect
    visible = pymupdf.Rect(
        r.x * vis.width,
        r.y * vis.height,
        (r.x + r.width) * vis.width,
        (r.y + r.height) * vis.height,
    )
    return (visible * page.derotation_matrix).normalize()


def to_norm_rect(page: pymupdf.Page, rect: pymupdf.Rect) -> NormRect:
    """Unrotated PyMuPDF coordinates -> visible-page fractions."""
    vis = page.rect
    shown = (pymupdf.Rect(rect) * page.rotation_matrix).normalize()
    return NormRect(
        page=page.number,
        x=shown.x0 / vis.width,
        y=shown.y0 / vis.height,
        width=max(shown.width / vis.width, 1e-6),
        height=max(shown.height / vis.height, 1e-6),
    )
