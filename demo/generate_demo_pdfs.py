#!/usr/bin/env python3
"""
Generate three deterministic demo PDFs aligned with tendersense heuristic extraction
and decision_engine regexes. Run from repo root:

  cd demo && pip install -r requirements.txt && python generate_demo_pdfs.py
"""

from __future__ import annotations

from pathlib import Path

from fpdf import FPDF


OUT = Path(__file__).resolve().parent / "pdfs"


class PDF(FPDF):
    def footer(self) -> None:
        self.set_y(-12)
        self.set_font("Helvetica", "I", 8)
        self.set_text_color(100, 100, 100)
        self.cell(0, 8, f"Page {self.page_no()}", align="C")


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


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    tender_pdf()
    bidder_clean_pdf()
    bidder_conflict_pdf()
    print("\nDone. Upload order for live demo:")
    print("  1) 01_TENDER_CRPF_DEMO.pdf  (tender document)")
    print("  2) Register bidders; upload 02_ as Bidder A (ca_certificate / gst_certificate as needed)")
    print("  3) Upload 03_ as Bidder B - expect NEEDS_REVIEW / CONFLICT on turnover")


if __name__ == "__main__":
    main()
