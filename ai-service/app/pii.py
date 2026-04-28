"""Deterministic PII redaction for logs and audit payloads.

Masks Indian identifiers — PAN, Aadhaar, GSTIN — before they reach stdout
or any persisted log surface. Operational data paths (decisions table,
documents.ocr_payload, criteria) are intentionally untouched: the officer
UI and audit-trail-of-record still need the originals.

Format conventions (last 4 chars retained for traceability):
    PAN:     ABCDE1234F  -> [PAN:******234F]
    Aadhaar: 1234 5678 9012 -> [AADHAAR:********9012]
    GSTIN:   22ABCDE1234F1Z5 -> [GSTIN:***********F1Z5]

Aadhaar is gated on the Verhoeff checksum to avoid redacting unrelated
12-digit numbers (turnover figures, transaction IDs, phone+IMEI strings).
"""

from __future__ import annotations

import logging
import re
from typing import Any, Mapping, MutableMapping

# ---------------------------------------------------------------------------
# Verhoeff checksum (UIDAI's published Aadhaar validation algorithm).
# Without this, the 12-digit regex would over-match.
# ---------------------------------------------------------------------------
_VERHOEFF_D = (
    (0, 1, 2, 3, 4, 5, 6, 7, 8, 9),
    (1, 2, 3, 4, 0, 6, 7, 8, 9, 5),
    (2, 3, 4, 0, 1, 7, 8, 9, 5, 6),
    (3, 4, 0, 1, 2, 8, 9, 5, 6, 7),
    (4, 0, 1, 2, 3, 9, 5, 6, 7, 8),
    (5, 9, 8, 7, 6, 0, 4, 3, 2, 1),
    (6, 5, 9, 8, 7, 1, 0, 4, 3, 2),
    (7, 6, 5, 9, 8, 2, 1, 0, 4, 3),
    (8, 7, 6, 5, 9, 3, 2, 1, 0, 4),
    (9, 8, 7, 6, 5, 4, 3, 2, 1, 0),
)

_VERHOEFF_P = (
    (0, 1, 2, 3, 4, 5, 6, 7, 8, 9),
    (1, 5, 7, 6, 2, 8, 3, 0, 9, 4),
    (5, 8, 0, 3, 7, 9, 6, 1, 4, 2),
    (8, 9, 1, 6, 0, 4, 3, 5, 2, 7),
    (9, 4, 5, 3, 1, 2, 6, 8, 7, 0),
    (4, 2, 8, 6, 5, 7, 3, 9, 0, 1),
    (2, 7, 9, 3, 8, 0, 6, 4, 1, 5),
    (7, 0, 4, 6, 9, 1, 3, 2, 5, 8),
)


def _verhoeff_valid(digits: str) -> bool:
    c = 0
    for i, ch in enumerate(reversed(digits)):
        c = _VERHOEFF_D[c][_VERHOEFF_P[i % 8][int(ch)]]
    return c == 0


# ---------------------------------------------------------------------------
# Regexes — anchored on word boundaries so we don't slice into longer tokens.
# ---------------------------------------------------------------------------
# PAN: 5 letters + 4 digits + 1 letter (10 chars).
_PAN_RE = re.compile(r"\b[A-Z]{5}[0-9]{4}[A-Z]\b")

# GSTIN: 2-digit state + 10-char PAN + entity digit/letter + literal Z + checksum.
_GSTIN_RE = re.compile(r"\b\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]\b")

# Aadhaar candidate: 12 digits, optionally grouped 4-4-4 with spaces or hyphens.
_AADHAAR_RE = re.compile(r"(?<!\d)(\d{4})[\s-]?(\d{4})[\s-]?(\d{4})(?!\d)")


def _mask(value: str, tag: str, keep: int = 4) -> str:
    visible = value[-keep:] if len(value) > keep else value
    stars = "*" * max(0, len(value) - keep)
    return f"[{tag}:{stars}{visible}]"


def _redact_pan(text: str) -> str:
    return _PAN_RE.sub(lambda m: _mask(m.group(0), "PAN"), text)


def _redact_gstin(text: str) -> str:
    return _GSTIN_RE.sub(lambda m: _mask(m.group(0), "GSTIN"), text)


def _redact_aadhaar(text: str) -> str:
    def sub(m: "re.Match[str]") -> str:
        compact = m.group(1) + m.group(2) + m.group(3)
        if not _verhoeff_valid(compact):
            return m.group(0)
        return _mask(compact, "AADHAAR")

    return _AADHAAR_RE.sub(sub, text)


def redact(value: Any) -> Any:
    """Mask PII in arbitrary values. Strings are scanned; mappings and
    sequences are walked recursively. Non-string scalars pass through."""
    if isinstance(value, str):
        s = _redact_gstin(value)  # GSTIN before PAN — its tail contains a PAN
        s = _redact_pan(s)
        s = _redact_aadhaar(s)
        return s
    if isinstance(value, Mapping):
        return {k: redact(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        out = [redact(v) for v in value]
        return tuple(out) if isinstance(value, tuple) else out
    return value


def redact_string(text: str) -> str:
    """Convenience wrapper that always returns a string."""
    return redact(text) if isinstance(text, str) else str(text)


# ---------------------------------------------------------------------------
# Logging integration — filter applied to the root handler so every log
# emission (including third-party libraries) gets sanitised before stdout.
# ---------------------------------------------------------------------------
class RedactingFilter(logging.Filter):
    def filter(self, record: logging.LogRecord) -> bool:
        try:
            record.msg = redact(record.msg)
            if record.args:
                if isinstance(record.args, Mapping):
                    record.args = {k: redact(v) for k, v in record.args.items()}
                elif isinstance(record.args, tuple):
                    record.args = tuple(redact(a) for a in record.args)
        except Exception:
            # Filtering must never break logging.
            pass
        return True


def install_redaction(logger: logging.Logger | None = None) -> None:
    """Attach the redaction filter to a logger and all its current handlers.
    Safe to call multiple times — the filter dedupes by class identity."""
    target = logger or logging.getLogger()
    if not any(isinstance(f, RedactingFilter) for f in target.filters):
        target.addFilter(RedactingFilter())
    for h in target.handlers:
        if not any(isinstance(f, RedactingFilter) for f in h.filters):
            h.addFilter(RedactingFilter())


__all__ = [
    "RedactingFilter",
    "install_redaction",
    "redact",
    "redact_string",
]
