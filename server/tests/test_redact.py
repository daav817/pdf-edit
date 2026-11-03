"""Redaction must remove content, not just cover it."""

import io

import pymupdf
import pytest

from app.coords import NormRect, to_norm_rect
from app.redact import apply_redactions, search
from conftest import make_pdf, page_text


def visible_rect_of(pdf: bytes, needle: str) -> NormRect:
    """Where the browser would see `needle`, as visible-page fractions."""
    doc = pymupdf.open(stream=pdf, filetype="pdf")
    page = doc[0]
    hit = page.search_for(needle)[0]
    norm = to_norm_rect(page, hit + (-2, -2, 2, 2))
    doc.close()
    return norm


def test_overlay_only_still_leaks_text():
    """Why this module exists: a black box drawn on top hides nothing."""
    doc = pymupdf.open()
    page = doc.new_page()
    page.insert_text((72, 72), "SECRET PASSWORD: hunter2", fontsize=12)
    page.draw_rect(pymupdf.Rect(60, 55, 360, 85), fill=(0, 0, 0))
    data = doc.tobytes()
    doc.close()
    assert "SECRET" in page_text(data)


def test_text_and_bytes_removed():
    pdf = make_pdf([((72, 72), "SECRET PASSWORD: hunter2"), ((72, 200), "Public line")])
    out = apply_redactions(pdf, [visible_rect_of(pdf, "SECRET PASSWORD: hunter2")])
    text = page_text(out)
    assert "hunter2" not in text and "SECRET" not in text
    assert "Public line" in text
    assert b"hunter2" not in out


@pytest.mark.parametrize("rotation", [0, 90, 180, 270])
def test_rotated_pages(rotation):
    pdf = make_pdf([((72, 100), "TOP SECRET"), ((72, 700), "Public footer")], rotation=rotation)
    out = apply_redactions(pdf, [visible_rect_of(pdf, "TOP SECRET")])
    text = page_text(out)
    assert "TOP SECRET" not in text
    assert "Public footer" in text


def test_rotated_page_visible_corner():
    """On a page rotated 90 degrees, text at the unrotated top-left shows at the visible top-right."""
    pdf = make_pdf([((40, 60), "CORNER"), ((300, 400), "Middle")], rotation=90)
    norm = visible_rect_of(pdf, "CORNER")
    assert norm.x > 0.8 and norm.y < 0.2
    assert "CORNER" not in page_text(apply_redactions(pdf, [norm]))


def test_cropped_page():
    pdf = make_pdf([((150, 150), "HIDDEN ID"), ((150, 400), "Visible")], cropbox=(100, 100, 500, 700))
    out = apply_redactions(pdf, [visible_rect_of(pdf, "HIDDEN ID")])
    text = page_text(out)
    assert "HIDDEN ID" not in text
    assert "Visible" in text


def test_region_math_from_browser_fractions():
    """A box the user draws over the top 15% of a plain page removes text there only."""
    pdf = make_pdf([((72, 60), "HEADER SECRET"), ((72, 600), "Body text")])
    out = apply_redactions(pdf, [NormRect(page=0, x=0, y=0, width=1, height=0.15)])
    assert "HEADER" not in page_text(out)
    assert "Body text" in page_text(out)


def test_search_and_redact_patterns():
    pdf = make_pdf(
        [
            ((72, 72), "SSN 123-45-6789"),
            ((72, 120), "Call (614) 555-0199"),
            ((72, 168), "Account 0123456789012"),
            ((72, 216), "Mail jane.doe@example.com"),
            ((72, 264), "Keep this"),
        ]
    )
    out = apply_redactions(pdf, [], patterns=["ssn", "phone", "account", "email"])
    text = page_text(out)
    for gone in ("123-45-6789", "555-0199", "0123456789012", "jane.doe@example.com"):
        assert gone not in text
    assert "Keep this" in text


def test_search_terms_every_page():
    pdf = make_pdf([((72, 72), "Customer: ACME Corp page {n}")], pages=3)
    hits = search(pdf, ["ACME Corp"], [])
    assert sorted(h["page"] for h in hits) == [0, 1, 2]
    out = apply_redactions(pdf, [], terms=["ACME Corp"])
    for p in range(3):
        assert "ACME" not in page_text(out, p)


def test_unknown_pattern_rejected():
    with pytest.raises(ValueError):
        search(make_pdf([((72, 72), "x")]), [], ["nope"])


def test_metadata_bookmarks_and_annotations_scrubbed():
    doc = pymupdf.open()
    page = doc.new_page()
    page.insert_text((72, 72), "Client: Jane Roe", fontsize=14)
    page.insert_text((72, 300), "Other", fontsize=14)
    page.add_text_annot((80, 70), "note about Jane Roe")
    doc.set_metadata({"title": "Jane Roe contract", "author": "Jane Roe"})
    doc.set_toc([[1, "Jane Roe", 1]])
    pdf = doc.tobytes()
    doc.close()

    out = apply_redactions(pdf, [], terms=["Jane Roe"])
    assert b"Jane Roe" not in out
    doc = pymupdf.open(stream=out, filetype="pdf")
    assert not (doc.metadata.get("title") or doc.metadata.get("author"))
    assert doc.get_toc() == []
    assert list(doc[0].annots()) == []
    doc.close()


def test_image_pixels_changed():
    """A box over part of an image changes those pixels in the saved file."""
    pix = pymupdf.Pixmap(pymupdf.csRGB, pymupdf.IRect(0, 0, 200, 200), False)
    pix.set_rect(pix.irect, (255, 0, 0))
    doc = pymupdf.open()
    page = doc.new_page(width=200, height=200)
    page.insert_image(page.rect, stream=pix.tobytes("png"))
    pdf = doc.tobytes()
    doc.close()

    out = apply_redactions(pdf, [NormRect(page=0, x=0, y=0, width=0.5, height=0.5)])
    doc = pymupdf.open(stream=out, filetype="pdf")
    xref = doc[0].get_images()[0][0]
    img = pymupdf.Pixmap(doc, xref)
    assert img.pixel(10, 10)[:3] != (255, 0, 0)  # redacted corner
    assert img.pixel(img.width - 10, img.height - 10)[:3] == (255, 0, 0)  # untouched corner
    doc.close()
