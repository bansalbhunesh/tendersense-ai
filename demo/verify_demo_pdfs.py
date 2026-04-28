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

    # 04 Hindi tender — verify Devanagari clauses round-tripped through pdfplumber.
    # We assert on stems rather than full sentences so minor shaping differences
    # (e.g. matras rendered as separate clusters) don't break the check.
    t4 = text_of("04_TENDER_BHARAT_HINDI.pdf")
    expected_hindi = [
        "टर्नओवर",     # turnover
        "जीएसटी",       # GST
        "करोड़",        # crore
        "परियोजना",     # project (covers परियोजनाएँ etc.)
        "आईएसओ",        # ISO
        "पात्रता",      # eligibility
    ]
    missing = [w for w in expected_hindi if w not in t4]
    assert not missing, f"04 hindi tender: missing keywords {missing!r}\nGot text:\n{t4[:600]}"
    print("04 tender (Hindi): OK (Devanagari criteria phrases present)")

    print("\nAll demo PDF checks passed.")


if __name__ == "__main__":
    main()
