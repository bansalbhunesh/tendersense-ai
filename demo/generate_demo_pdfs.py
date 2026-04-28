#!/usr/bin/env python3
"""
Generate four deterministic demo PDFs aligned with tendersense heuristic extraction
and decision_engine regexes. Run from repo root:

  cd demo && pip install -r requirements.txt && python generate_demo_pdfs.py

PDF #4 (`04_TENDER_BHARAT_HINDI.pdf`) carries the same eligibility rules as PDF #1
expressed in Devanagari, demonstrating the Bharat-first ingestion path.
"""

from __future__ import annotations

import sys
import urllib.request
from pathlib import Path

from fpdf import FPDF


OUT = Path(__file__).resolve().parent / "pdfs"
FONT_DIR = Path(__file__).resolve().parent / ".fonts"
FONT_FILENAME = "NotoSansDevanagari-Regular.ttf"
# Stable mirror via google/fonts. The notofonts/devanagari hinted/ttf path is
# unstable (404s for some snapshots); google/fonts ships the variable TTF that
# fpdf2 happily embeds. We store the .ttf under demo/.fonts/ which is gitignored.
FONT_URL = (
    "https://github.com/google/fonts/raw/main/ofl/notosansdevanagari/"
    "NotoSansDevanagari%5Bwdth%2Cwght%5D.ttf"
)


class PDF(FPDF):
    def footer(self) -> None:
        self.set_y(-12)
        self.set_font("Helvetica", "I", 8)
        self.set_text_color(100, 100, 100)
        self.cell(0, 8, f"Page {self.page_no()}", align="C")


class HindiPDF(FPDF):
    """FPDF subclass that uses the embedded Devanagari font for body + footer."""

    def footer(self) -> None:
        self.set_y(-12)
        self.set_font("NotoDeva", "", 8)
        self.set_text_color(100, 100, 100)
        self.cell(0, 8, f"पृष्ठ {self.page_no()}", align="C")


def paragraph(pdf: PDF, text: str) -> None:
    pdf.set_font("Helvetica", "", 11)
    pdf.set_text_color(30, 30, 30)
    pdf.multi_cell(0, 6, text)
    pdf.ln(4)


def heading(pdf: PDF, title: str) -> None:
    pdf.set_font("Helvetica", "B", 14)
    pdf.set_text_color(10, 40, 80)
    pdf.multi_cell(0, 8, title)
    pdf.ln(2)


def hindi_paragraph(pdf: HindiPDF, text: str) -> None:
    pdf.set_font("NotoDeva", "", 12)
    pdf.set_text_color(30, 30, 30)
    pdf.multi_cell(0, 7, text)
    pdf.ln(3)


def hindi_heading(pdf: HindiPDF, title: str) -> None:
    pdf.set_font("NotoDeva", "", 15)
    pdf.set_text_color(10, 40, 80)
    pdf.multi_cell(0, 9, title)
    pdf.ln(2)


def ensure_devanagari_font() -> Path:
    """Make sure NotoSansDevanagari is on disk under demo/.fonts/.

    Downloads from a stable google/fonts mirror on first use. The cache directory
    is gitignored — we never commit the binary. If the network is unavailable,
    raise a clear error so the operator knows what to fetch manually.
    """

    FONT_DIR.mkdir(parents=True, exist_ok=True)
    target = FONT_DIR / FONT_FILENAME
    if target.exists() and target.stat().st_size > 50_000:
        return target
    print(f"Downloading Devanagari font -> {target}")
    try:
        with urllib.request.urlopen(FONT_URL, timeout=30) as r:  # noqa: S310 (trusted host)
            data = r.read()
        if len(data) < 50_000:
            raise RuntimeError(
                f"font download too small ({len(data)} bytes); refusing to write"
            )
        target.write_bytes(data)
    except Exception as e:  # pragma: no cover - network path
        raise SystemExit(
            f"Could not fetch NotoSansDevanagari from {FONT_URL}: {e}\n"
            f"Manually place a .ttf at {target} and re-run."
        ) from e
    return target


def tender_pdf() -> None:
    pdf = PDF()
    pdf.set_auto_page_break(auto=True, margin=18)
    pdf.add_page()
    heading(pdf, "CRPF - Representative Tender (Demo) - Construction Services")
    paragraph(
        pdf,
        "This document is a mock tender for hackathon demonstration only. "
        "Eligibility criteria are stated below in formal procurement language.",
    )
    heading(pdf, "Section 4 - Eligibility criteria")
    paragraph(
        pdf,
        "4.1 Financial eligibility: The bidder shall have a minimum annual turnover of "
        "Rs. 5 Crore in any one of the last three financial years, certified by a Chartered Accountant.",
    )
    paragraph(
        pdf,
        "4.2 Experience: The bidder shall have successfully completed at least 3 similar projects "
        "in the last 5 years as evidenced by work completion certificates.",
    )
    paragraph(
        pdf,
        "4.3 Tax compliance: Valid Goods and Services Tax (GST) registration is mandatory for participation.",
    )
    paragraph(
        pdf,
        "4.4 Quality (optional preference): ISO 9001 certification is desirable for technical evaluation scoring.",
    )
    path = OUT / "01_TENDER_CRPF_DEMO.pdf"
    pdf.output(str(path))
    print("Wrote", path)


def bidder_clean_pdf() -> None:
    pdf = PDF()
    pdf.set_auto_page_break(auto=True, margin=18)
    pdf.add_page()
    heading(pdf, "ACME Infrastructure Pvt Ltd - Bidder supporting pack (Demo)")
    paragraph(
        pdf,
        "CONFIDENTIAL - Mock financial and compliance excerpts for TenderSense demonstration.",
    )
    heading(pdf, "Annexure A - Audited financial summary (FY 2023-24)")
    paragraph(
        pdf,
        "Total Turnover (as per audited statement): Rs. 5.23 Crore (Rupees Five Crore Twenty Three Lakh only). "
        "Figures are indicative for eligibility verification.",
    )
    heading(pdf, "Annexure B - GST registration")
    paragraph(
        pdf,
        "GSTIN: 27AAAAA1234A1Z5 - Active registration under Central Goods and Services Tax. "
        "Registration certificate attached for verification.",
    )
    heading(pdf, "Annexure C - Quality management")
    paragraph(
        pdf,
        "The company holds ISO 9001 certification for quality management systems (scope: civil construction).",
    )
    heading(pdf, "Annexure D - Similar projects")
    paragraph(
        pdf,
        "We have completed 4 similar projects in road and building works in the last 5 years; "
        "references available on request.",
    )
    path = OUT / "02_BIDDER_ACME_ELIGIBLE.pdf"
    pdf.output(str(path))
    print("Wrote", path)


def bidder_conflict_pdf() -> None:
    pdf = PDF()
    pdf.set_auto_page_break(auto=True, margin=18)
    pdf.add_page()
    heading(pdf, "Beta Constructors LLP - Bidder supporting pack (Demo - conflict scenario)")
    paragraph(
        pdf,
        "This pack intentionally contains inconsistent turnover figures across sections to demonstrate "
        "cross-document conflict detection.",
    )
    heading(pdf, "Section 1 - CA certificate (FY 2023-24)")
    paragraph(
        pdf,
        "We certify that the total turnover of the entity for the financial year is "
        "Rs. 5.23 Crore as per books of account reviewed by us.",
    )
    heading(pdf, "Section 2 - Income tax return / computation excerpt")
    paragraph(
        pdf,
        "Total turnover from business as declared: INR 3,10,00,000 (Rupees Three Crore Ten Lakh only). "
        "This summary is extracted from the filed return for independent verification.",
    )
    heading(pdf, "Section 3 - GST")
    paragraph(
        pdf,
        "GSTIN 06BBBBB5678B2Z3 is active. GST registration is submitted for eligibility.",
    )
    path = OUT / "03_BIDDER_BETA_CONFLICT.pdf"
    pdf.output(str(path))
    print("Wrote", path)


def tender_pdf_hindi() -> None:
    """Devanagari counterpart to 01_TENDER_CRPF_DEMO.pdf.

    Same eligibility rules: turnover >= Rs 5 Cr, >=3 similar projects in 5 yrs,
    GST mandatory, ISO 9001 desirable. Sentences are real Hindi (not transliteration)
    so the OCR/translation pipeline has a meaningful Bharat-first input to chew on.
    """

    font_path = ensure_devanagari_font()
    pdf = HindiPDF()
    # fpdf2 v2.5.1+ embeds TTF in unicode mode by default; the legacy `uni=True`
    # kwarg is deprecated and unused.
    pdf.add_font("NotoDeva", "", str(font_path))
    pdf.set_auto_page_break(auto=True, margin=18)
    pdf.add_page()

    hindi_heading(pdf, "सीआरपीएफ - प्रतिनिधि निविदा (डेमो) - निर्माण सेवाएँ")
    hindi_paragraph(
        pdf,
        "यह दस्तावेज़ केवल हैकथॉन प्रदर्शन हेतु एक नमूना निविदा है। "
        "पात्रता मानदंड औपचारिक खरीद भाषा में नीचे दिए गए हैं।",
    )
    hindi_heading(pdf, "खंड 4 - पात्रता मानदंड")
    hindi_paragraph(
        pdf,
        "4.1 वित्तीय पात्रता: बोलीदाता का पिछले तीन वित्तीय वर्षों में से किसी एक में "
        "न्यूनतम वार्षिक टर्नओवर रु. 5 करोड़ होना चाहिए, जो किसी चार्टर्ड अकाउंटेंट द्वारा प्रमाणित हो।",
    )
    hindi_paragraph(
        pdf,
        "4.2 अनुभव: बोलीदाता ने पिछले 5 वर्षों में कम से कम 3 समान परियोजनाएँ "
        "सफलतापूर्वक पूरी की हों, जिसका प्रमाण कार्य पूर्णता प्रमाणपत्र से दिया जाए।",
    )
    hindi_paragraph(
        pdf,
        "4.3 कर अनुपालन: भागीदारी हेतु वैध जीएसटी (वस्तु एवं सेवा कर) पंजीकरण अनिवार्य है।",
    )
    hindi_paragraph(
        pdf,
        "4.4 गुणवत्ता (वैकल्पिक वरीयता): तकनीकी मूल्यांकन में आईएसओ 9001 प्रमाणन वांछनीय है।",
    )
    hindi_heading(pdf, "टिप्पणी")
    hindi_paragraph(
        pdf,
        "यह निविदा अंग्रेज़ी संस्करण (01_TENDER_CRPF_DEMO.pdf) के समान नियमों को "
        "हिन्दी में दोहराती है ताकि भारतीय भाषाओं में पारदर्शी मूल्यांकन प्रदर्शित हो सके।",
    )
    path = OUT / "04_TENDER_BHARAT_HINDI.pdf"
    pdf.output(str(path))
    print("Wrote", path)


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    tender_pdf()
    bidder_clean_pdf()
    bidder_conflict_pdf()
    try:
        tender_pdf_hindi()
    except SystemExit as e:
        # Surface but don't kill EN PDFs that already wrote — operator may be offline.
        print(f"WARNING: skipped Hindi PDF: {e}", file=sys.stderr)
    print("\nDone. Upload order for live demo:")
    print("  1) 01_TENDER_CRPF_DEMO.pdf  (tender document)")
    print("  2) Register bidders; upload 02_ as Bidder A (ca_certificate / gst_certificate as needed)")
    print("  3) Upload 03_ as Bidder B - expect NEEDS_REVIEW / CONFLICT on turnover")
    print("  4) For Bharat-first beat, upload 04_TENDER_BHARAT_HINDI.pdf as the tender")


if __name__ == "__main__":
    main()
