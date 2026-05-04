"""End-to-end smoke tests of the FastAPI surface using TestClient."""

from __future__ import annotations

import importlib
import sys

import pytest
from fastapi.testclient import TestClient


def test_import_main_without_allowed_origins_raises(tmp_path, monkeypatch):
    """Misconfigured deploy must not fall back to localhost CORS at import."""
    monkeypatch.delenv("ALLOWED_ORIGINS", raising=False)
    monkeypatch.setenv("DATA_DIR", str(tmp_path))
    if "main" in sys.modules:
        del sys.modules["main"]
    with pytest.raises(RuntimeError, match="ALLOWED_ORIGINS"):
        importlib.import_module("main")


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
    assert body["version"] == "0.2.0"
    assert body["git_sha"] == "abc123def"
    assert "llm_backend" in body
    assert "translation_backend" in body


def test_version_endpoint_no_sha(tmp_data_dir, monkeypatch):
    monkeypatch.delenv("GIT_SHA", raising=False)
    main_mod = _fresh_app(monkeypatch, tmp_data_dir)
    client = TestClient(main_mod.app)
    r = client.get("/v1/version")
    assert r.status_code == 200
    body = r.json()
    assert body["version"] == "0.2.0"
    assert body["git_sha"] == ""
    assert "llm_backend" in body
    assert "translation_backend" in body


def test_version_endpoint_includes_active_backends(tmp_data_dir, monkeypatch):
    monkeypatch.setenv("LLM_BACKEND", "disabled")
    monkeypatch.setenv("TRANSLATION_BACKEND", "disabled")
    main_mod = _fresh_app(monkeypatch, tmp_data_dir)
    client = TestClient(main_mod.app)
    r = client.get("/v1/version")
    assert r.status_code == 200
    body = r.json()
    assert body["llm_backend"] == "disabled"
    assert body["translation_backend"] == "disabled"


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


# ---------------------------------------------------------------------------
# Bharat-first additions: detect-language, translate, Hindi extract-criteria.
# ---------------------------------------------------------------------------

def _set_bhashini_env(monkeypatch):
    monkeypatch.setenv("BHASHINI_USER_ID", "test-user")
    monkeypatch.setenv("BHASHINI_API_KEY", "test-key")
    monkeypatch.setenv("BHASHINI_PIPELINE_ID", "test-pipeline")
    monkeypatch.setenv("BHASHINI_INFERENCE_URL", "https://example.invalid/infer")


def _clear_translator_cache():
    from app.translation import get_translator as _gt
    _gt.cache_clear()


def test_detect_language_endpoint_english(tmp_data_dir, monkeypatch):
    main_mod = _fresh_app(monkeypatch, tmp_data_dir)
    client = TestClient(main_mod.app)
    r = client.post(
        "/v1/detect-language",
        json={"text": "Bidder shall have annual turnover of Rs. 5 Crore."},
    )
    assert r.status_code == 200
    body = r.json()
    assert body["lang"] == "en"
    assert "confidence" in body
    assert body["devanagari_ratio"] == 0.0


def test_detect_language_endpoint_hindi(tmp_data_dir, monkeypatch):
    main_mod = _fresh_app(monkeypatch, tmp_data_dir)
    client = TestClient(main_mod.app)
    r = client.post(
        "/v1/detect-language",
        json={"text": "बोलीदाता का वार्षिक कारोबार पाँच करोड़ रुपये होना चाहिए।"},
    )
    assert r.status_code == 200
    body = r.json()
    assert body["lang"] == "hi"
    assert body["devanagari_ratio"] > 0.5


def test_translate_endpoint_disabled_returns_503(tmp_data_dir, monkeypatch):
    monkeypatch.setenv("TRANSLATION_BACKEND", "disabled")
    _clear_translator_cache()
    main_mod = _fresh_app(monkeypatch, tmp_data_dir)
    client = TestClient(main_mod.app)
    r = client.post(
        "/v1/translate",
        json={"text": "नमस्ते", "src": "hi", "tgt": "en"},
    )
    assert r.status_code == 503


def test_translate_endpoint_unconfigured_returns_503(tmp_data_dir, monkeypatch):
    """Backend=bhashini but envs missing → factory degrades to disabled → 503."""
    monkeypatch.setenv("TRANSLATION_BACKEND", "bhashini")
    for k in ("BHASHINI_USER_ID", "BHASHINI_API_KEY", "BHASHINI_PIPELINE_ID", "BHASHINI_INFERENCE_URL"):
        monkeypatch.delenv(k, raising=False)
    _clear_translator_cache()
    main_mod = _fresh_app(monkeypatch, tmp_data_dir)
    client = TestClient(main_mod.app)
    r = client.post("/v1/translate", json={"text": "नमस्ते", "src": "hi", "tgt": "en"})
    assert r.status_code == 503


def _install_bhashini_stub(monkeypatch, target_payload):
    """Patch BhashiniTranslator.translate directly so we don't fight TestClient's
    own use of httpx. Returns target_payload regardless of input."""
    from app import translation as _t

    def fake_translate(self, text: str, src: str, tgt: str) -> str:
        if not text:
            return text
        return target_payload

    monkeypatch.setattr(_t.BhashiniTranslator, "translate", fake_translate)


def test_translate_endpoint_bhashini_happy_path(tmp_data_dir, monkeypatch):
    _set_bhashini_env(monkeypatch)
    monkeypatch.setenv("TRANSLATION_BACKEND", "bhashini")
    _clear_translator_cache()
    _install_bhashini_stub(monkeypatch, "Hello")

    main_mod = _fresh_app(monkeypatch, tmp_data_dir)
    client = TestClient(main_mod.app)
    r = client.post("/v1/translate", json={"text": "नमस्ते", "src": "hi", "tgt": "en"})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["translated"] == "Hello"
    assert body["backend"] == "bhashini"


def test_extract_criteria_hindi_with_bhashini_translation(tmp_data_dir, monkeypatch):
    """Hindi tender text + Bhashini translator → English extraction with
    source_text_lang=hi tagged on each criterion."""
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    _set_bhashini_env(monkeypatch)
    monkeypatch.setenv("TRANSLATION_BACKEND", "bhashini")
    _clear_translator_cache()

    hindi_text = (
        "निविदा: उपकरण की आपूर्ति।\n"
        "पात्रता मानदंड:\n"
        "बोलीदाता का वार्षिक कारोबार पाँच करोड़ रुपये होना चाहिए।\n"
        "वैध जीएसटी पंजीकरण अनिवार्य है।\n"
    )

    english_translation = (
        "Tender: Supply of equipment.\n"
        "Eligibility criteria:\n"
        "Bidder must have annual turnover of Rs. 5 Crore.\n"
        "Valid GST registration is mandatory.\n"
    )

    _install_bhashini_stub(monkeypatch, english_translation)
    main_mod = _fresh_app(monkeypatch, tmp_data_dir)
    client = TestClient(main_mod.app)
    r = client.post(
        "/v1/extract-criteria",
        json={"text": hindi_text, "tender_id": "T-hi"},
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body.get("source_text_lang") == "hi"
    crits = body.get("criteria") or []
    assert crits, "expected at least one criterion from translated text"
    fields = {c.get("field") for c in crits}
    assert "annual_turnover" in fields or "gst_registration" in fields
    # Each criterion should be stamped with source_text_lang.
    for c in crits:
        assert c.get("source_text_lang") == "hi"


def test_extract_criteria_hindi_disabled_translator_warns(tmp_data_dir, monkeypatch):
    """Hindi text + TRANSLATION_BACKEND=disabled → still extracts on raw text but
    flags ``extraction_warning=untranslated_indic_text``."""
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    monkeypatch.setenv("TRANSLATION_BACKEND", "disabled")
    _clear_translator_cache()

    hindi_text = "बोलीदाता का वार्षिक कारोबार पाँच करोड़ रुपये होना चाहिए।"
    main_mod = _fresh_app(monkeypatch, tmp_data_dir)
    client = TestClient(main_mod.app)
    r = client.post(
        "/v1/extract-criteria",
        json={"text": hindi_text, "tender_id": "T-hi-disabled"},
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body.get("source_text_lang") == "hi"
    assert body.get("extraction_warning") == "untranslated_indic_text"
    # Criteria should still be a list — degradation shouldn't crash.
    assert isinstance(body.get("criteria"), list)
