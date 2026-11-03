import json

import pymupdf

from app.coords import NormRect
from app.textedit import remove_text
from conftest import make_pdf, page_text

FONT = 14


def line_area(x0: float, baseline: float, x1: float, page: int = 0) -> NormRect:
    """The area the editor draws around one line of 14 pt text (see textExtract.ts)."""
    top = baseline - FONT * 1.05
    return NormRect(page=page, x=x0 / 612, y=top / 792, width=(x1 - x0) / 612, height=FONT * 1.35 / 792)


def test_removes_only_the_edited_line_even_when_lines_are_tight():
    # 16 pt between baselines: each line's box overlaps its neighbours' glyphs.
    pdf = make_pdf([
        ((72, 184), "Above line stays"),
        ((72, 200), "Price is $4.25 per MCF"),
        ((72, 216), "Below line stays"),
    ])
    out = remove_text(pdf, [line_area(72, 200, 300)])
    text = page_text(out)
    assert "4.25" not in text and "Price" not in text
    assert "Above line stays" in text
    assert "Below line stays" in text


def test_keeps_words_beside_the_area():
    pdf = make_pdf([((72, 200), "Keep"), ((300, 200), "Remove me")])
    out = remove_text(pdf, [line_area(290, 200, 420)])
    text = page_text(out)
    assert "Keep" in text
    assert "Remove" not in text


def test_old_words_are_gone_from_the_file_bytes():
    pdf = make_pdf([((72, 200), "SECRETWORD here")])
    out = remove_text(pdf, [line_area(72, 200, 300)])
    doc = pymupdf.open(stream=out, filetype="pdf")
    try:
        assert not doc[0].search_for("SECRETWORD")
        # Nothing left in any object, including old copies of the page content.
        for xref in range(1, doc.xref_length()):
            if doc.xref_is_stream(xref):
                assert b"SECRETWORD" not in (doc.xref_stream(xref) or b"")
    finally:
        doc.close()


def test_keeps_drawings_and_images_under_the_area():
    doc = pymupdf.open()
    page = doc.new_page(width=612, height=792)
    page.insert_text((72, 200), "Edited text", fontsize=FONT)
    page.draw_line((60, 195), (400, 195))  # a table rule through the line
    pix = pymupdf.Pixmap(pymupdf.csRGB, pymupdf.IRect(0, 0, 4, 4), False)
    pix.clear_with(200)
    page.insert_image(pymupdf.Rect(150, 188, 170, 202), pixmap=pix)
    pdf = doc.tobytes()
    doc.close()

    out = remove_text(pdf, [line_area(60, 200, 400)])
    doc = pymupdf.open(stream=out, filetype="pdf")
    try:
        assert "Edited" not in doc[0].get_text()
        assert len(doc[0].get_drawings()) == 1
        assert len(doc[0].get_images()) == 1
    finally:
        doc.close()


def test_rotated_page_uses_the_visible_layout():
    # Text at unrotated (72, 200); on a page rotated 90° it shows elsewhere,
    # and the client sends the area as it is shown.
    pdf = make_pdf([((72, 200), "Turned text"), ((72, 400), "Other text")], rotation=90)
    doc = pymupdf.open(stream=pdf, filetype="pdf")
    page = doc[0]
    hit = page.search_for("Turned text")[0]
    shown = (hit * page.rotation_matrix).normalize()
    vis = page.rect
    area = NormRect(
        page=0,
        x=(shown.x0 - 2) / vis.width,
        y=(shown.y0 - 2) / vis.height,
        width=(shown.width + 4) / vis.width,
        height=(shown.height + 4) / vis.height,
    )
    doc.close()
    text = page_text(remove_text(pdf, [area]))
    assert "Turned" not in text
    assert "Other text" in text


def test_api_endpoint(client):
    pdf = make_pdf([((72, 200), "Old words"), ((72, 300), "Untouched")])
    area = line_area(72, 200, 300).model_dump()
    res = client.post(
        "/api/text/remove",
        files={"file": ("a.pdf", pdf, "application/pdf")},
        data={"regions": json.dumps([area])},
    )
    assert res.status_code == 200
    text = page_text(res.content)
    assert "Old words" not in text and "Untouched" in text


def test_api_rejects_no_areas(client):
    pdf = make_pdf([((72, 200), "x")])
    res = client.post("/api/text/remove", files={"file": ("a.pdf", pdf, "application/pdf")}, data={"regions": "[]"})
    assert res.status_code == 400
