"""Language detection and pluggable translation backends for Bharat-first ingest.

Provides:
- detect_language: pure-python Devanagari ratio classifier.
- Translator protocol with DisabledTranslator and BhashiniTranslator implementations.
- get_translator factory memoized on env (call cache_clear() in tests).

The Bhashini integration constructs a request body matching the public ULCA
"Translation" pipeline contract. It does NOT call the real service in tests —
agents monkeypatch httpx.Client.post.
"""

from __future__ import annotations

import functools
import logging
import os
from typing import Literal, Protocol

import httpx

logger = logging.getLogger("tendersense-ai")

LanguageTag = Literal["hi", "en", "mixed"]

_DEVANAGARI_START = 0x0900  # ऀ
_DEVANAGARI_END = 0x097F  # ॿ


def _devanagari_ratio(text: str) -> float:
    """Return the fraction of letter-like characters that are Devanagari."""
    if not text:
        return 0.0
    letters = 0
    devanagari = 0
    for ch in text:
        if ch.isspace() or not ch.isprintable():
            continue
        # Count any non-whitespace printable as a "letter-like" candidate.
        # We're after a coarse ratio, not perfect linguistic accuracy.
        if ch.isalpha() or _DEVANAGARI_START <= ord(ch) <= _DEVANAGARI_END:
            letters += 1
            if _DEVANAGARI_START <= ord(ch) <= _DEVANAGARI_END:
                devanagari += 1
    if letters == 0:
        return 0.0
    return devanagari / letters


def detect_language(text: str) -> LanguageTag:
    """Classify text as 'hi' (Devanagari-dominant), 'en', or 'mixed' based on the
    ratio of Devanagari letters to letter-like characters. Pure python, no deps."""
    ratio = _devanagari_ratio(text)
    if ratio > 0.3:
        return "hi"
    if ratio < 0.05:
        return "en"
    return "mixed"


class Translator(Protocol):
    """A translator can convert ``text`` from ``src`` to ``tgt`` BCP-47-ish codes."""

    def translate(self, text: str, src: str, tgt: str) -> str:  # pragma: no cover - protocol
        ...


class DisabledTranslator:
    """Passthrough translator. Used when TRANSLATION_BACKEND=disabled (default)."""

    name: str = "disabled"

    def translate(self, text: str, src: str, tgt: str) -> str:
        return text


class BhashiniTranslator:
    """HTTP client for the Bhashini ULCA Translation pipeline.

    Reads four envs at construction: BHASHINI_USER_ID, BHASHINI_API_KEY,
    BHASHINI_PIPELINE_ID, BHASHINI_INFERENCE_URL. Raises RuntimeError if any
    are missing — callers should catch and degrade gracefully.

    The request body matches the public "computeTask" schema; tests monkeypatch
    httpx.Client.post so we never hit the wire.
    """

    name: str = "bhashini"

    def __init__(self) -> None:
        missing: list[str] = []
        self.user_id = (os.getenv("BHASHINI_USER_ID") or "").strip()
        self.api_key = (os.getenv("BHASHINI_API_KEY") or "").strip()
        self.pipeline_id = (os.getenv("BHASHINI_PIPELINE_ID") or "").strip()
        self.inference_url = (os.getenv("BHASHINI_INFERENCE_URL") or "").strip()
        for k, v in [
            ("BHASHINI_USER_ID", self.user_id),
            ("BHASHINI_API_KEY", self.api_key),
            ("BHASHINI_PIPELINE_ID", self.pipeline_id),
            ("BHASHINI_INFERENCE_URL", self.inference_url),
        ]:
            if not v:
                missing.append(k)
        if missing:
            raise RuntimeError(
                f"BhashiniTranslator missing required env: {', '.join(missing)}"
            )
        self._client = httpx.Client(timeout=30)

    def _build_body(self, text: str, src: str, tgt: str) -> dict[str, object]:
        return {
            "pipelineTasks": [
                {
                    "taskType": "translation",
                    "config": {
                        "language": {
                            "sourceLanguage": src,
                            "targetLanguage": tgt,
                        },
                    },
                }
            ],
            "inputData": {
                "input": [{"source": text}],
            },
        }

    def _headers(self) -> dict[str, str]:
        return {
            "Content-Type": "application/json",
            "userID": self.user_id,
            "ulcaApiKey": self.api_key,
            "x-bhashini-pipeline-id": self.pipeline_id,
        }

    def translate(self, text: str, src: str, tgt: str) -> str:
        if not text:
            return text
        body = self._build_body(text, src, tgt)
        try:
            resp = self._client.post(
                self.inference_url, json=body, headers=self._headers()
            )
        except httpx.HTTPError as e:
            raise RuntimeError(f"Bhashini request failed: {e!s}") from e
        if resp.status_code >= 400:
            raise RuntimeError(
                f"Bhashini returned HTTP {resp.status_code}: {resp.text[:200]}"
            )
        try:
            data = resp.json()
        except ValueError as e:
            raise RuntimeError(f"Bhashini returned non-JSON: {e!s}") from e
        # Public ULCA shape:
        # {"pipelineResponse":[{"taskType":"translation","output":[{"source":"...","target":"..."}]}]}
        try:
            tasks = data.get("pipelineResponse") or []
            for task in tasks:
                if task.get("taskType") != "translation":
                    continue
                outputs = task.get("output") or []
                if outputs and isinstance(outputs[0], dict):
                    target = outputs[0].get("target")
                    if isinstance(target, str):
                        return target
        except AttributeError:
            pass
        # Fall back to the raw input if the response shape is unexpected; better
        # than crashing the extraction pipeline.
        logger.warning("BhashiniTranslator: unexpected response shape, returning input")
        return text


@functools.lru_cache(maxsize=1)
def get_translator() -> Translator:
    """Construct a translator based on TRANSLATION_BACKEND env. Memoized — call
    ``get_translator.cache_clear()`` in tests after changing env."""
    backend = (os.getenv("TRANSLATION_BACKEND") or "disabled").strip().lower()
    if backend == "bhashini":
        try:
            return BhashiniTranslator()
        except RuntimeError as e:
            logger.warning(
                "BhashiniTranslator unavailable, falling back to disabled: %s", e
            )
            return DisabledTranslator()
    return DisabledTranslator()


def translate_in_chunks(
    translator: Translator, text: str, src: str, tgt: str, chunk_size: int = 4000
) -> str:
    """Split ``text`` into ≤chunk_size pieces and translate each. Splits on
    paragraph boundaries when possible, falling back to hard slicing."""
    if not text:
        return text
    if len(text) <= chunk_size:
        return translator.translate(text, src, tgt)
    out: list[str] = []
    paragraphs = text.split("\n")
    buf = ""
    for p in paragraphs:
        candidate = (buf + "\n" + p) if buf else p
        if len(candidate) > chunk_size and buf:
            out.append(translator.translate(buf, src, tgt))
            buf = p
        else:
            buf = candidate
        # If a single paragraph still exceeds chunk_size, slice it hard.
        while len(buf) > chunk_size:
            out.append(translator.translate(buf[:chunk_size], src, tgt))
            buf = buf[chunk_size:]
    if buf:
        out.append(translator.translate(buf, src, tgt))
    return "\n".join(out)
