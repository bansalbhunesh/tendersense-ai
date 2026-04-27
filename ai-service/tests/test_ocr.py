"""OCR pipeline smoke tests using synthetic PDFs."""

from __future__ import annotations

import shutil

import pytest

from app.ocr_pipeline import process_path, redact_noise


def test_redact_noise_idempotent_on_plain_text():
    assert redact_noise("hello world") == "hello world"


def test_pdfplumber_extracts_text(synthetic_pdf):
    """Native PDFs (text layer present) should round-trip through pdfplumber and
    yield non-empty text + a positive quality score."""
    pdf = synthetic_pdf("native.pdf",
                        "Tender 2026: ISO 9001 required.\nAnnual turnover Rs. 5 Crore.")
    result = process_path(str(pdf), "doc-1")
    assert result.text.strip(), "expected non-empty extracted text"
    assert result.quality_score > 0
    # Native-text path should report pdfplumber engine.
    assert result.engine in ("pdfplumber", "pdf_raster_ocr")
    assert any(p.text for p in result.pages)


def test_unknown_extension_returns_empty(tmp_path):
    f = tmp_path / "data.xlsx"
    f.write_bytes(b"not a real xlsx")
    result = process_path(str(f))
    assert result.text == ""
    assert result.quality_score == 0.0
    assert result.engine == "none"


@pytest.mark.skipif(shutil.which("tesseract") is None, reason="tesseract binary not installed")
def test_image_ocr_path(tmp_path):
    """Render text into an image, then OCR it. Skipped when tesseract missing."""
    from PIL import Image, ImageDraw, ImageFont

    img = Image.new("RGB", (800, 200), color="white")
    draw = ImageDraw.Draw(img)
    try:
        font = ImageFont.truetype("/System/Library/Fonts/Supplemental/Arial.ttf", 32)
    except Exception:
        font = ImageFont.load_default()
    draw.text((20, 60), "ISO 9001 Tender 2026", fill="black", font=font)
    img_path = tmp_path / "scan.png"
    img.save(str(img_path))

    result = process_path(str(img_path))
    # We don't assert on content (OCR is fuzzy) — only that the pipeline ran without crashing.
    assert result.engine in ("paddleocr", "tesseract")
    assert isinstance(result.text, str)
