#!/usr/bin/env python3
"""Quick sanity check: pdfplumber text + turnover signals (no DB). Run after generate_demo_pdfs.py."""

from __future__ import annotations

import re
import sys
from pathlib import Path

try:
    import pdfplumber
except ImportError:
    print("Install: pip install pdfplumber", file=sys.stderr)
    sys.exit(1)

ROOT = Path(__file__).resolve().parent / "pdfs"


def text_of(name: str) -> str:
    p = ROOT / name
    if not p.exists():
        raise SystemExit(f"Missing {p} - run generate_demo_pdfs.py first")
    chunks: list[str] = []
    with pdfplumber.open(p) as pdf:
        for page in pdf.pages:
            chunks.append(page.extract_text() or "")
    return "\n".join(chunks)


def main() -> None:
    t1 = text_of("01_TENDER_CRPF_DEMO.pdf")
    assert "minimum annual turnover" in t1.lower() and "5" in t1 and "similar projects" in t1.lower()
    assert "iso 9001" in t1.lower() or "iso 9001" in t1
    print("01 tender: OK (criteria phrases present)")

    t2 = text_of("02_BIDDER_ACME_ELIGIBLE.pdf")
    assert "5.23" in t2 and "crore" in t2.lower()
    compact = re.sub(r"\s+", "", t2)
    assert "27AAAAA1234A1Z5" in compact.upper()
    assert "similar projects" in t2.lower()
    print("02 bidder A: OK (turnover, GSTIN, similar projects)")

    t3 = text_of("03_BIDDER_BETA_CONFLICT.pdf")
    assert "5.23" in t3 and "3,10,00,000" in t3
    print("03 bidder B: OK (conflicting turnover figures in one pack)")

    print("\nAll demo PDF checks passed.")


if __name__ == "__main__":
    main()
