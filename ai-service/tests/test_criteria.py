"""Unit tests for the deterministic criteria fallback in app.criteria_extractor."""

from __future__ import annotations

import pytest

from app.criteria_extractor import _fallback_criteria, extract_criteria_llm


def _fields(crits):
    return {c["field"] for c in crits}


def _by_field(crits, field):
    matches = [c for c in crits if c.get("field") == field]
    assert matches, f"no criterion with field={field}; have {_fields(crits)}"
    return matches[0]


def test_canonical_shape():
    crits = _fallback_criteria("Bidder must have ISO 9001 certification.")
    assert crits, "expected at least one criterion"
    keys = {"id", "category", "text_raw", "field", "operator", "value", "unit",
            "mandatory", "source_priority", "depends_on", "extraction_confidence",
            "semantic_ambiguity_score"}
    for c in crits:
        assert keys.issubset(c.keys()), f"missing keys: {keys - set(c.keys())}"


def test_turnover_in_crore():
    text = "Annual turnover of at least Rs. 5 Crore in any of the last 3 years."
    crits = _fallback_criteria(text)
    c = _by_field(crits, "annual_turnover")
    assert c["operator"] == ">="
    assert c["value"] == pytest.approx(5e7)
    assert c["unit"] == "INR"
    assert c["category"] == "financial"


def test_turnover_in_lakh():
    text = "Minimum turnover Rs. 50 Lakh per year."
    crits = _fallback_criteria(text)
    c = _by_field(crits, "annual_turnover")
    assert c["value"] == pytest.approx(5e6)


def test_gst_pan_tds_extracted():
    text = (
        "Bidder shall hold a valid GST registration. "
        "PAN card mandatory. TDS / TAN compliance required."
    )
    crits = _fallback_criteria(text)
    fields = _fields(crits)
    assert "gst_registration" in fields
    assert "pan_registration" in fields
    assert "tds_registration" in fields


def test_iso_variants_each_emitted():
    text = "ISO 9001, ISO 14001 and ISO 27001 certifications are required. NABL accreditation preferred."
    crits = _fallback_criteria(text)
    fields = _fields(crits)
    assert {"iso_9001", "iso_14001", "iso_27001", "nabl_accreditation"}.issubset(fields)
    for f in ("iso_9001", "iso_14001", "iso_27001", "nabl_accreditation"):
        c = _by_field(crits, f)
        assert c["category"] == "certification"
        assert c["operator"] == "=="
        assert c["value"] == 1


def test_experience_years_numeric():
    text = "Bidder must have minimum 5 years of experience in similar projects."
    crits = _fallback_criteria(text)
    c = _by_field(crits, "experience_years")
    assert c["operator"] == ">="
    assert c["value"] == 5.0


def test_similar_projects_count():
    text = "Bidder shall have completed 3 similar projects in the last 5 years."
    crits = _fallback_criteria(text)
    c = _by_field(crits, "similar_projects_count")
    assert c["operator"] == ">="
    assert c["value"] == 3.0
    assert c["category"] == "experience"


def test_emd_and_bank_guarantee():
    text = (
        "EMD of Rs. 50,000 must be submitted along with the bid. "
        "Bank guarantee of Rs. 2 Lakh towards performance security."
    )
    crits = _fallback_criteria(text)
    emd = _by_field(crits, "emd_amount")
    assert emd["value"] == pytest.approx(50000)
    bg = _by_field(crits, "bank_guarantee")
    assert bg["value"] == pytest.approx(2e5)


def test_bid_validity():
    text = "Bid validity shall be 90 days from the date of bid opening."
    crits = _fallback_criteria(text)
    c = _by_field(crits, "bid_validity_days")
    assert c["operator"] == ">="
    assert c["value"] == 90.0
    assert c["unit"] == "days"


def test_msme_registration():
    text = "MSME / Udyam registered firms shall be eligible for preference."
    crits = _fallback_criteria(text)
    c = _by_field(crits, "msme_registration")
    assert c["category"] == "preference"
    assert c["value"] == 1


def test_manpower_count():
    text = "Bidder shall have at least 25 employees on rolls."
    crits = _fallback_criteria(text)
    c = _by_field(crits, "manpower_count")
    assert c["operator"] == ">="
    assert c["value"] == 25.0
    assert c["category"] == "capacity"


def test_blacklisting_declaration():
    text = "Bidder shall not be blacklisted by any Government department."
    crits = _fallback_criteria(text)
    c = _by_field(crits, "blacklisting_declaration")
    assert c["category"] == "compliance"
    assert c["value"] == 1


def test_empty_text_returns_placeholder():
    crits = _fallback_criteria("")
    assert len(crits) == 1
    assert crits[0]["field"] == "generic_compliance"


def test_extract_criteria_llm_falls_back_when_no_key(monkeypatch):
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    text = "Annual turnover Rs. 10 Crore. ISO 9001 required."
    crits = extract_criteria_llm(text)
    fields = _fields(crits)
    assert "annual_turnover" in fields
    assert "iso_9001" in fields


def test_aggregate_kitchen_sink(sample_tender_text):
    """The full sample tender should yield criteria from each major category."""
    crits = _fallback_criteria(sample_tender_text)
    cats = {c["category"] for c in crits}
    expected_cats = {"financial", "tax", "certification", "experience", "compliance"}
    missing = expected_cats - cats
    assert not missing, f"missing categories: {missing}; got {cats}"
