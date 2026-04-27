"""End-to-end smoke tests of the FastAPI surface using TestClient."""

from __future__ import annotations

import importlib
import sys

import pytest
from fastapi.testclient import TestClient


def _fresh_app(monkeypatch, data_dir):
    """Reload `main` so DATA_DIR (captured at import time) reflects test env."""
    monkeypatch.setenv("DATA_DIR", str(data_dir))
    monkeypatch.setenv("ALLOWED_ORIGINS", "*")
    if "main" in sys.modules:
        del sys.modules["main"]
    import main as _main  # noqa: F401
    importlib.reload(_main)
    return _main


def test_health_ok(tmp_data_dir, monkeypatch):
    main_mod = _fresh_app(monkeypatch, tmp_data_dir)
    client = TestClient(main_mod.app)
    r = client.get("/health")
    assert r.status_code == 200
    body = r.json()
    assert body["status"] == "ok"
    assert body["service"] == "tendersense-ai"


def test_version_endpoint(tmp_data_dir, monkeypatch):
    monkeypatch.setenv("GIT_SHA", "abc123def")
    main_mod = _fresh_app(monkeypatch, tmp_data_dir)
    client = TestClient(main_mod.app)
    r = client.get("/v1/version")
    assert r.status_code == 200
    body = r.json()
    assert body == {"version": "0.2.0", "git_sha": "abc123def"}


def test_version_endpoint_no_sha(tmp_data_dir, monkeypatch):
    monkeypatch.delenv("GIT_SHA", raising=False)
    main_mod = _fresh_app(monkeypatch, tmp_data_dir)
    client = TestClient(main_mod.app)
    r = client.get("/v1/version")
    assert r.status_code == 200
    assert r.json() == {"version": "0.2.0", "git_sha": ""}


def test_process_document_happy_path(tmp_data_dir, monkeypatch, synthetic_pdf):
    pdf = synthetic_pdf("happy.pdf", "Tender body. Annual turnover Rs. 5 Crore. ISO 9001 certified.")
    main_mod = _fresh_app(monkeypatch, tmp_data_dir)
    client = TestClient(main_mod.app)
    r = client.post("/v1/process-document", json={"path": str(pdf), "document_id": "doc-1"})
    assert r.status_code == 200, r.text
    body = r.json()
    assert "text" in body
    assert "quality_score" in body
    assert body["quality_score"] > 0
    assert "ISO 9001" in body["text"] or "Tender" in body["text"]


def test_process_document_path_traversal_blocked(tmp_data_dir, monkeypatch):
    main_mod = _fresh_app(monkeypatch, tmp_data_dir)
    client = TestClient(main_mod.app)
    r = client.post(
        "/v1/process-document",
        json={"path": "../../etc/passwd", "document_id": "evil"},
    )
    # Endpoint catches the HTTPException(403) and returns a structured error,
    # but it must not return file contents.
    assert r.status_code == 200
    body = r.json()
    assert body.get("error") == "invalid path"
    assert body.get("text") == ""
    assert body.get("quality_score") == 0.0


def test_process_document_missing_file(tmp_data_dir, monkeypatch):
    main_mod = _fresh_app(monkeypatch, tmp_data_dir)
    client = TestClient(main_mod.app)
    target = tmp_data_dir / "ghost.pdf"
    r = client.post(
        "/v1/process-document",
        json={"path": str(target), "document_id": "ghost"},
    )
    assert r.status_code == 200
    body = r.json()
    assert body.get("error") == "file not found"
    assert body.get("text") == ""
    assert body.get("engine") == "missing_file"


def test_extract_criteria_deterministic_no_api_key(tmp_data_dir, monkeypatch, sample_tender_text):
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    main_mod = _fresh_app(monkeypatch, tmp_data_dir)
    client = TestClient(main_mod.app)
    r = client.post(
        "/v1/extract-criteria",
        json={"text": sample_tender_text, "tender_id": "T-1"},
    )
    assert r.status_code == 200, r.text
    body = r.json()
    crits = body.get("criteria") or []
    assert len(crits) >= 6, f"expected several criteria, got {len(crits)}: {crits}"

    fields = {c.get("field") for c in crits}
    expected = {
        "annual_turnover",
        "gst_registration",
        "iso_9001",
        "experience_years",
        "emd_amount",
    }
    missing = expected - fields
    assert not missing, f"missing fallback fields: {missing}; got {fields}"

    # Every criterion has the canonical shape.
    for c in crits:
        assert {"id", "field", "operator", "value"}.issubset(c.keys())
        assert "category" in c  # additive but stable


def test_extract_criteria_with_fake_api_key_still_falls_back(tmp_data_dir, monkeypatch, sample_tender_text):
    """Setting ANTHROPIC_API_KEY=fake should not break — Anthropic call will fail and we
    must return the deterministic fallback rather than crash."""
    monkeypatch.setenv("ANTHROPIC_API_KEY", "fake-key-not-real")
    main_mod = _fresh_app(monkeypatch, tmp_data_dir)
    client = TestClient(main_mod.app)
    r = client.post("/v1/extract-criteria", json={"text": sample_tender_text, "tender_id": "T-2"})
    assert r.status_code == 200
    body = r.json()
    assert isinstance(body.get("criteria"), list)


def test_evaluate_returns_pass_and_fail(tmp_data_dir, monkeypatch):
    """Without an API key, the deterministic engine should produce concrete PASS/FAIL,
    not blanket NEEDS_REVIEW."""
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    main_mod = _fresh_app(monkeypatch, tmp_data_dir)
    client = TestClient(main_mod.app)

    criteria = [
        {
            "id": "c-turnover",
            "field": "annual_turnover",
            "operator": ">=",
            "value": 50000000.0,
            "unit": "INR",
            "mandatory": True,
            "source_priority": ["audited_balance_sheet", "ca_certificate"],
            "extraction_confidence": 0.85,
            "semantic_ambiguity_score": 0.1,
        },
        {
            "id": "c-gst",
            "field": "gst_registration",
            "operator": "==",
            "value": 1,
            "unit": "bool",
            "mandatory": True,
            "source_priority": ["gst_certificate"],
            "extraction_confidence": 0.9,
            "semantic_ambiguity_score": 0.05,
        },
        {
            "id": "c-iso",
            "field": "iso_9001",
            "operator": "==",
            "value": 1,
            "unit": "bool",
            "mandatory": False,
            "source_priority": ["iso_certificate"],
            "extraction_confidence": 0.85,
            "semantic_ambiguity_score": 0.05,
        },
    ]
    bidders = [
        {
            "bidder_id": "b-pass",
            "documents": [
                {
                    "id": "d1",
                    "filename": "abs.pdf",
                    "doc_type": "audited_balance_sheet",
                    "ocr": {
                        "text": "Annual turnover for FY23: Rs. 8 Crore.",
                        "quality_score": 0.95,
                    },
                },
                {
                    "id": "d2",
                    "filename": "gst.pdf",
                    "doc_type": "gst_certificate",
                    "ocr": {
                        "text": "GST registration certificate. GSTIN 27ABCDE1234F1Z5.",
                        "quality_score": 0.95,
                    },
                },
                {
                    "id": "d3",
                    "filename": "iso.pdf",
                    "doc_type": "iso_certificate",
                    "ocr": {
                        "text": "This is to certify ISO 9001:2015 conformance.",
                        "quality_score": 0.95,
                    },
                },
            ],
        },
        {
            "bidder_id": "b-fail-turnover",
            "documents": [
                {
                    "id": "d4",
                    "filename": "abs2.pdf",
                    "doc_type": "audited_balance_sheet",
                    "ocr": {
                        "text": "Annual turnover for FY23: Rs. 1 Crore.",
                        "quality_score": 0.95,
                    },
                },
                {
                    "id": "d5",
                    "filename": "gst2.pdf",
                    "doc_type": "gst_certificate",
                    "ocr": {
                        "text": "GST registration valid. GSTIN 22XYZAB9876C1Z2.",
                        "quality_score": 0.95,
                    },
                },
            ],
        },
    ]
    r = client.post(
        "/v1/evaluate",
        json={"tender_id": "T-99", "criteria": criteria, "bidders": bidders},
    )
    assert r.status_code == 200, r.text
    body = r.json()
    decisions = body.get("decisions") or []
    assert len(decisions) == len(criteria) * len(bidders)

    verdicts = [d.get("verdict") for d in decisions]
    # Should produce a mix: at least one PASS (ELIGIBLE), at least one FAIL.
    assert "ELIGIBLE" in verdicts, f"no ELIGIBLE verdicts: {verdicts}"
    assert "NOT_ELIGIBLE" in verdicts, f"no NOT_ELIGIBLE verdicts: {verdicts}"

    # The bidder that has Rs. 1 Crore for a Rs. 5 Crore requirement must FAIL on turnover.
    fail_turnover = next(
        d for d in decisions
        if d.get("bidder_id") == "b-fail-turnover" and d.get("criterion_id") == "c-turnover"
    )
    assert fail_turnover["verdict"] == "NOT_ELIGIBLE"
    assert fail_turnover["confidence"] >= 0.6

    # The bidder that has Rs. 8 Crore should PASS.
    pass_turnover = next(
        d for d in decisions
        if d.get("bidder_id") == "b-pass" and d.get("criterion_id") == "c-turnover"
    )
    assert pass_turnover["verdict"] == "ELIGIBLE"
    assert pass_turnover["confidence"] >= 0.6
