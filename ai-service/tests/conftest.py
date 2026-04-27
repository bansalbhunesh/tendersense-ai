"""Shared pytest fixtures.

The repo lacks a sys.path entry for the ai-service root; we ensure pytest can
import `main` and `app.*` regardless of where it's invoked from.
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parents[1]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))


@pytest.fixture(scope="session")
def repo_root() -> Path:
    return REPO_ROOT


@pytest.fixture
def tmp_data_dir(tmp_path, monkeypatch) -> Path:
    """Override DATA_DIR + ALLOWED_ORIGINS so the FastAPI module-level constants
    work in tests without touching the real filesystem layout."""
    data_dir = tmp_path / "uploads"
    data_dir.mkdir(parents=True, exist_ok=True)
    monkeypatch.setenv("DATA_DIR", str(data_dir))
    monkeypatch.setenv("ALLOWED_ORIGINS", "*")
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    monkeypatch.delenv("REDIS_URL", raising=False)

    # Force the cached `main.DATA_DIR` to follow the env var, since main.py
    # captures it at import time.
    if "main" in sys.modules:
        import main as _main  # type: ignore
        _main.DATA_DIR = os.path.abspath(str(data_dir))
    return data_dir


def _build_synthetic_pdf(path: Path, body: str) -> Path:
    """Render a tiny single-page PDF containing `body` text using reportlab."""
    from reportlab.lib.pagesizes import LETTER
    from reportlab.pdfgen import canvas

    c = canvas.Canvas(str(path), pagesize=LETTER)
    width, height = LETTER
    text = c.beginText(40, height - 60)
    text.setFont("Helvetica", 11)
    for line in body.splitlines():
        text.textLine(line)
    c.drawText(text)
    c.showPage()
    c.save()
    return path


@pytest.fixture
def synthetic_pdf(tmp_data_dir):
    """Factory: write a PDF inside DATA_DIR with the given filename + body."""
    def _make(filename: str, body: str) -> Path:
        full = tmp_data_dir / filename
        full.parent.mkdir(parents=True, exist_ok=True)
        return _build_synthetic_pdf(full, body)
    return _make


@pytest.fixture
def sample_tender_text() -> str:
    return (
        "Tender for supply and installation of equipment.\n"
        "Eligibility Criteria:\n"
        "1. Bidder shall have an annual turnover of at least Rs. 5 Crore in any "
        "of the last 3 financial years.\n"
        "2. Valid GST registration is mandatory; GSTIN should be quoted on the bid form.\n"
        "3. ISO 9001 certified manufacturers shall be preferred. ISO 14001 certification is required.\n"
        "4. Bidder must have minimum 5 years of experience in similar work.\n"
        "5. EMD of Rs. 50,000 must be submitted along with the bid.\n"
        "6. Bid validity shall be 90 days from the date of opening.\n"
        "7. Bidder shall not be blacklisted by any Government department.\n"
        "8. PAN registration and TDS compliance required.\n"
        "9. MSME / Udyam registered firms get preference under MSE Order 2012.\n"
        "10. Bidder shall have at least 25 employees on rolls.\n"
        "11. Bank guarantee of Rs. 2 Lakh towards performance security.\n"
        "12. Net worth must be positive and at least Rs. 1 Crore.\n"
        "13. Bidder shall have completed 3 similar projects in last 5 years.\n"
    )
