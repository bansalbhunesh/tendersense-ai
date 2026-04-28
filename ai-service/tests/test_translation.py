"""Unit tests for app.translation: detection, translators, factory dispatch."""

from __future__ import annotations

import json
from typing import Any

import httpx
import pytest

from app.translation import (
    BhashiniTranslator,
    DisabledTranslator,
    detect_language,
    get_translator,
)


# ---------------------------------------------------------------------------
# detect_language
# ---------------------------------------------------------------------------

def test_detect_english_only():
    assert detect_language("Bidder shall have annual turnover of Rs. 5 Crore.") == "en"


def test_detect_hindi_only():
    text = "बोलीदाता का वार्षिक कारोबार पाँच करोड़ रुपये होना चाहिए।"
    assert detect_language(text) == "hi"


def test_detect_mixed_text():
    # Mix English clauses with Devanagari clauses so the ratio lands between
    # 0.05 and 0.30 (the 'mixed' band).
    text = (
        "Bidder shall have annual turnover of at least 5 Crore. "
        "बोलीदाता का वार्षिक कारोबार पाँच करोड़ होना चाहिए। "
        "Valid GST registration is mandatory for participation in this tender."
    )
    assert detect_language(text) == "mixed"


def test_detect_empty_string_is_english():
    # No Devanagari → ratio 0.0 → "en".
    assert detect_language("") == "en"


# ---------------------------------------------------------------------------
# DisabledTranslator
# ---------------------------------------------------------------------------

def test_disabled_translator_passthrough():
    t = DisabledTranslator()
    assert t.translate("hello", "en", "hi") == "hello"
    assert t.translate("नमस्ते", "hi", "en") == "नमस्ते"
    assert t.name == "disabled"


# ---------------------------------------------------------------------------
# BhashiniTranslator
# ---------------------------------------------------------------------------

def _set_bhashini_env(monkeypatch):
    monkeypatch.setenv("BHASHINI_USER_ID", "test-user")
    monkeypatch.setenv("BHASHINI_API_KEY", "test-key")
    monkeypatch.setenv("BHASHINI_PIPELINE_ID", "test-pipeline")
    monkeypatch.setenv("BHASHINI_INFERENCE_URL", "https://example.invalid/infer")


class _FakeResponse:
    def __init__(self, status_code: int, payload: Any):
        self.status_code = status_code
        self._payload = payload
        self.text = json.dumps(payload) if not isinstance(payload, str) else payload

    def json(self):
        if isinstance(self._payload, str):
            raise ValueError("not json")
        return self._payload


def test_bhashini_constructor_fails_when_env_missing(monkeypatch):
    for k in ("BHASHINI_USER_ID", "BHASHINI_API_KEY", "BHASHINI_PIPELINE_ID", "BHASHINI_INFERENCE_URL"):
        monkeypatch.delenv(k, raising=False)
    with pytest.raises(RuntimeError) as ei:
        BhashiniTranslator()
    msg = str(ei.value)
    assert "BHASHINI_USER_ID" in msg
    assert "BHASHINI_API_KEY" in msg


def test_bhashini_constructor_fails_when_one_env_missing(monkeypatch):
    _set_bhashini_env(monkeypatch)
    monkeypatch.delenv("BHASHINI_API_KEY", raising=False)
    with pytest.raises(RuntimeError) as ei:
        BhashiniTranslator()
    assert "BHASHINI_API_KEY" in str(ei.value)


def test_bhashini_translate_happy_path(monkeypatch):
    _set_bhashini_env(monkeypatch)
    captured: dict[str, Any] = {}

    def fake_post(self, url, json=None, headers=None):  # noqa: A002
        captured["url"] = url
        captured["json"] = json
        captured["headers"] = headers
        return _FakeResponse(
            200,
            {
                "pipelineResponse": [
                    {
                        "taskType": "translation",
                        "output": [{"source": "नमस्ते", "target": "Hello"}],
                    }
                ]
            },
        )

    monkeypatch.setattr(httpx.Client, "post", fake_post)
    t = BhashiniTranslator()
    out = t.translate("नमस्ते", "hi", "en")
    assert out == "Hello"

    # Request shape sanity.
    assert captured["url"] == "https://example.invalid/infer"
    body = captured["json"]
    assert body["pipelineTasks"][0]["taskType"] == "translation"
    cfg = body["pipelineTasks"][0]["config"]["language"]
    assert cfg["sourceLanguage"] == "hi"
    assert cfg["targetLanguage"] == "en"
    assert body["inputData"]["input"][0]["source"] == "नमस्ते"

    headers = captured["headers"]
    assert headers["userID"] == "test-user"
    assert headers["ulcaApiKey"] == "test-key"
    assert headers["x-bhashini-pipeline-id"] == "test-pipeline"


def test_bhashini_translate_http_error(monkeypatch):
    _set_bhashini_env(monkeypatch)

    def fake_post(self, url, json=None, headers=None):  # noqa: A002
        return _FakeResponse(500, {"error": "server"})

    monkeypatch.setattr(httpx.Client, "post", fake_post)
    t = BhashiniTranslator()
    with pytest.raises(RuntimeError):
        t.translate("नमस्ते", "hi", "en")


def test_bhashini_translate_empty_returns_empty(monkeypatch):
    _set_bhashini_env(monkeypatch)
    # Should not even hit the wire.
    called = {"hit": False}

    def fake_post(self, url, json=None, headers=None):  # noqa: A002
        called["hit"] = True
        return _FakeResponse(200, {})

    monkeypatch.setattr(httpx.Client, "post", fake_post)
    t = BhashiniTranslator()
    assert t.translate("", "hi", "en") == ""
    assert called["hit"] is False


# ---------------------------------------------------------------------------
# get_translator factory
# ---------------------------------------------------------------------------

def test_get_translator_default_is_disabled(monkeypatch):
    monkeypatch.delenv("TRANSLATION_BACKEND", raising=False)
    get_translator.cache_clear()
    t = get_translator()
    assert isinstance(t, DisabledTranslator)


def test_get_translator_disabled_explicit(monkeypatch):
    monkeypatch.setenv("TRANSLATION_BACKEND", "disabled")
    get_translator.cache_clear()
    t = get_translator()
    assert isinstance(t, DisabledTranslator)


def test_get_translator_bhashini(monkeypatch):
    _set_bhashini_env(monkeypatch)
    monkeypatch.setenv("TRANSLATION_BACKEND", "bhashini")
    get_translator.cache_clear()
    t = get_translator()
    assert isinstance(t, BhashiniTranslator)


def test_get_translator_bhashini_missing_env_degrades(monkeypatch):
    monkeypatch.setenv("TRANSLATION_BACKEND", "bhashini")
    for k in ("BHASHINI_USER_ID", "BHASHINI_API_KEY", "BHASHINI_PIPELINE_ID", "BHASHINI_INFERENCE_URL"):
        monkeypatch.delenv(k, raising=False)
    get_translator.cache_clear()
    t = get_translator()
    # Construction failed — factory should fall back to disabled, not crash.
    assert isinstance(t, DisabledTranslator)
