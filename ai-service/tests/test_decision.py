"""Unit tests for the decision engine — verdict / confidence sanity across PASS/FAIL/REVIEW."""

from __future__ import annotations

import pytest

from app.decision_engine import evaluate_criterion, run_evaluation


def _ocr_doc(doc_id, doc_type, filename, text, q=0.95):
    return {
        "id": doc_id,
        "doc_type": doc_type,
        "filename": filename,
        "ocr": {"text": text, "quality_score": q},
    }


def _crit(**kw):
    base = {
        "id": "c-test",
        "field": "annual_turnover",
        "operator": ">=",
        "value": 50000000.0,
        "unit": "INR",
        "mandatory": True,
        "source_priority": ["audited_balance_sheet", "ca_certificate"],
        "extraction_confidence": 0.85,
        "semantic_ambiguity_score": 0.1,
    }
    base.update(kw)
    return base


# ---------------------------------------------------------------------------
# Numeric: PASS / FAIL
# ---------------------------------------------------------------------------

def test_numeric_pass_high_confidence():
    crit = _crit()
    docs = [_ocr_doc("d1", "audited_balance_sheet", "abs.pdf",
                     "Annual turnover for FY23: Rs. 8 Crore.")]
    out = evaluate_criterion(crit, "b1", docs)
    assert out["verdict"] == "ELIGIBLE"
    assert out["confidence"] >= 0.7


def test_numeric_fail_below_threshold():
    crit = _crit()
    docs = [_ocr_doc("d1", "audited_balance_sheet", "abs.pdf",
                     "Annual turnover for FY23: Rs. 1 Crore.")]
    out = evaluate_criterion(crit, "b1", docs)
    assert out["verdict"] == "NOT_ELIGIBLE"
    assert out["confidence"] >= 0.6


def test_numeric_no_evidence_review():
    crit = _crit()
    docs = [_ocr_doc("d1", "supporting", "blank.pdf", "Cover letter, no financial info.")]
    out = evaluate_criterion(crit, "b1", docs)
    assert out["verdict"] == "NEEDS_REVIEW"
    assert out["reason"] == "NO_EVIDENCE"


def test_numeric_conflict_triggers_review():
    crit = _crit()
    docs = [
        _ocr_doc("d1", "audited_balance_sheet", "abs.pdf", "Turnover Rs. 8 Crore."),
        _ocr_doc("d2", "ca_certificate", "ca.pdf", "Turnover Rs. 1 Crore."),
    ]
    out = evaluate_criterion(crit, "b1", docs)
    assert out["verdict"] == "NEEDS_REVIEW"
    assert out["reason"] == "CONFLICT_DETECTED"
    assert "evidence_conflicting" in out and len(out["evidence_conflicting"]) >= 2


# ---------------------------------------------------------------------------
# Boolean / presence
# ---------------------------------------------------------------------------

def test_gst_pass_via_text():
    crit = _crit(
        id="c-gst",
        field="gst_registration",
        operator="==",
        value=1,
        unit="bool",
        source_priority=["gst_certificate"],
    )
    docs = [_ocr_doc("d1", "gst_certificate", "gst.pdf",
                     "Goods and Services Tax registration. GSTIN 27ABCDE1234F1Z5.")]
    out = evaluate_criterion(crit, "b1", docs)
    assert out["verdict"] == "ELIGIBLE"


def test_iso14001_pass_via_text():
    crit = _crit(
        id="c-iso14001",
        field="iso_14001",
        operator="==",
        value=1,
        unit="bool",
        source_priority=["iso_certificate"],
    )
    docs = [_ocr_doc("d1", "iso_certificate", "iso.pdf",
                     "Certificate of registration: ISO 14001:2015.")]
    out = evaluate_criterion(crit, "b1", docs)
    assert out["verdict"] == "ELIGIBLE"


def test_doc_presence_fallback_pass_when_text_silent():
    """If text doesn't say 'GST', but the bidder uploads a gst_certificate, we should still PASS."""
    crit = _crit(
        id="c-gst",
        field="gst_registration",
        operator="==",
        value=1,
        unit="bool",
        source_priority=["gst_certificate"],
    )
    # OCR returned only header noise; doc_type provides the signal.
    docs = [_ocr_doc("d1", "gst_certificate", "gst.pdf", "Certificate page header only.")]
    out = evaluate_criterion(crit, "b1", docs)
    assert out["verdict"] == "ELIGIBLE"
    assert out["confidence"] >= 0.6


def test_doc_presence_fallback_fail_when_no_matching_doc():
    crit = _crit(
        id="c-gst",
        field="gst_registration",
        operator="==",
        value=1,
        unit="bool",
        source_priority=["gst_certificate"],
    )
    docs = [_ocr_doc("d1", "supporting", "random.pdf", "Cover letter only.")]
    out = evaluate_criterion(crit, "b1", docs)
    assert out["verdict"] == "NOT_ELIGIBLE"
    assert out["reason"] == "DOC_MISSING"


# ---------------------------------------------------------------------------
# Counts
# ---------------------------------------------------------------------------

def test_experience_years_pass():
    crit = _crit(
        id="c-exp",
        field="experience_years",
        operator=">=",
        value=5.0,
        unit="years",
        source_priority=["experience_letters"],
    )
    docs = [_ocr_doc("d1", "experience_letters", "exp.pdf",
                     "We have 7 years of experience in similar work.")]
    out = evaluate_criterion(crit, "b1", docs)
    assert out["verdict"] == "ELIGIBLE"


def test_experience_years_fail():
    crit = _crit(
        id="c-exp",
        field="experience_years",
        operator=">=",
        value=10.0,
        unit="years",
        source_priority=["experience_letters"],
    )
    docs = [_ocr_doc("d1", "experience_letters", "exp.pdf",
                     "We have 3 years of experience in similar work.")]
    out = evaluate_criterion(crit, "b1", docs)
    assert out["verdict"] == "NOT_ELIGIBLE"


# ---------------------------------------------------------------------------
# Unknown field handling without API key (must NOT return NO_API_KEY blanket)
# ---------------------------------------------------------------------------

def test_unknown_field_with_matching_doc_passes(monkeypatch):
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    crit = _crit(
        id="c-weird",
        field="totally_made_up_field_name",  # not in KNOWN_FIELDS
        operator="==",
        value=1,
        unit="bool",
        source_priority=["weird_certificate"],
    )
    # Doc-presence fallback shouldn't trigger because field isn't a known bool field.
    docs = [_ocr_doc("d1", "weird_certificate", "w.pdf", "Some text.")]
    out = evaluate_criterion(crit, "b1", docs)
    # Without LLM and without bool-field handling, this falls into NEEDS_REVIEW.
    # The point: we should NOT see reason == "NO_API_KEY" — that contract was the bug.
    assert out["verdict"] == "NEEDS_REVIEW"
    assert out.get("reason") != "NO_API_KEY"


# ---------------------------------------------------------------------------
# run_evaluation end-to-end shape
# ---------------------------------------------------------------------------

def test_run_evaluation_shape():
    payload = {
        "tender_id": "T1",
        "criteria": [
            _crit(),
            _crit(id="c-gst", field="gst_registration", operator="==", value=1,
                  unit="bool", source_priority=["gst_certificate"]),
        ],
        "bidders": [
            {
                "bidder_id": "b1",
                "documents": [
                    _ocr_doc("d1", "audited_balance_sheet", "abs.pdf",
                             "Turnover Rs. 8 Crore."),
                    _ocr_doc("d2", "gst_certificate", "gst.pdf",
                             "GSTIN 27ABCDE1234F1Z5"),
                ],
            }
        ],
    }
    result = run_evaluation(payload)
    assert "graph" in result
    assert "decisions" in result
    assert "review_items" in result
    assert len(result["decisions"]) == 2
    for d in result["decisions"]:
        assert "verdict" in d
        assert "confidence" in d
        assert d["tender_id"] == "T1"
