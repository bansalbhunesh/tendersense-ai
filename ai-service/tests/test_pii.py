"""Tests for the PII redactor (PAN / Aadhaar / GSTIN).

The redactor sits in the log + audit path; if it stops working, real
identifiers will land in stdout / persistence. These tests therefore
cover positive matches, near-misses (must NOT redact), boundary
overlaps (PAN inside GSTIN), and the logging-filter integration.
"""

from __future__ import annotations

import io
import json
import logging

import pytest

from app.pii import RedactingFilter, install_redaction, redact, redact_string


# ---------------------------------------------------------------------------
# A real Aadhaar requires a Verhoeff-valid 12-digit number. UIDAI publishes
# 999999990019 as a documented test number. We also include another
# externally-known test value (uses the same checksum machinery).
# ---------------------------------------------------------------------------
VALID_AADHAAR = "999999990019"
INVALID_AADHAAR = "123456789012"  # checksum invalid — must not be redacted

VALID_PAN = "ABCDE1234F"
VALID_GSTIN = "22ABCDE1234F1Z5"


class TestPAN:
    def test_redacts_bare_pan(self) -> None:
        out = redact(f"PAN on file: {VALID_PAN}.")
        assert VALID_PAN not in out
        assert "[PAN:******234F]" in out

    def test_does_not_redact_random_alphanumeric(self) -> None:
        # Wrong shape — 4 letters + 5 digits + 1 letter.
        assert redact("ABCD12345F") == "ABCD12345F"

    def test_does_not_redact_lowercase_lookalike(self) -> None:
        # Spec is uppercase only; lowercase is not a regulatory PAN.
        assert redact("abcde1234f") == "abcde1234f"

    def test_word_boundary(self) -> None:
        # Embedded inside a longer alphanumeric token must not match.
        assert redact("XABCDE1234FY") == "XABCDE1234FY"


class TestAadhaar:
    def test_redacts_grouped(self) -> None:
        # 4-4-4 with spaces.
        text = "Aadhaar: 9999 9999 0019."
        out = redact(text)
        assert "9999 9999 0019" not in out
        assert "[AADHAAR:********0019]" in out

    def test_redacts_hyphenated(self) -> None:
        out = redact("ID 9999-9999-0019 verified.")
        assert "[AADHAAR:********0019]" in out

    def test_redacts_compact(self) -> None:
        out = redact(f"raw: {VALID_AADHAAR}")
        assert "[AADHAAR:********0019]" in out

    def test_does_not_redact_invalid_checksum(self) -> None:
        # 12 digits but Verhoeff-invalid (e.g. transaction ID).
        assert redact(f"txn={INVALID_AADHAAR}") == f"txn={INVALID_AADHAAR}"

    def test_does_not_redact_long_numbers(self) -> None:
        # 13 digits — must not slice off a 12-digit subsequence.
        assert redact("amount=1234567890123") == "amount=1234567890123"

    def test_does_not_redact_turnover(self) -> None:
        # Realistic numeric tender data, must pass through unchanged.
        text = "Turnover INR 5,23,00,00,000 for FY24"
        assert redact(text) == text


class TestGSTIN:
    def test_redacts_gstin(self) -> None:
        out = redact(f"GSTIN: {VALID_GSTIN}.")
        assert VALID_GSTIN not in out
        assert "[GSTIN:***********F1Z5]" in out

    def test_gstin_takes_precedence_over_pan(self) -> None:
        # GSTIN's chars 3-12 form a valid PAN. The redactor must mask the
        # whole GSTIN as one token, not produce a half-redacted hybrid.
        out = redact(f"see {VALID_GSTIN}")
        assert "[PAN:" not in out
        assert "[GSTIN:" in out


class TestRecursive:
    def test_redacts_dict(self) -> None:
        out = redact({"justification": f"PAN {VALID_PAN}", "ok": True, "amount": 1000})
        assert "[PAN:" in out["justification"]
        assert out["ok"] is True
        assert out["amount"] == 1000

    def test_redacts_nested_list(self) -> None:
        out = redact({"notes": [f"GSTIN {VALID_GSTIN}", "fine"]})
        assert "[GSTIN:" in out["notes"][0]
        assert out["notes"][1] == "fine"

    def test_passes_non_strings(self) -> None:
        assert redact(42) == 42
        assert redact(None) is None
        assert redact(True) is True


class TestLoggingFilter:
    def test_filter_redacts_record_msg(self) -> None:
        buf = io.StringIO()
        handler = logging.StreamHandler(buf)
        handler.setFormatter(logging.Formatter("%(message)s"))
        log = logging.getLogger("test_pii_msg")
        log.handlers.clear()
        log.addHandler(handler)
        log.setLevel(logging.INFO)
        install_redaction(log)

        log.info("officer override pan=%s aadhaar=%s", VALID_PAN, VALID_AADHAAR)
        handler.flush()
        out = buf.getvalue()
        assert VALID_PAN not in out
        assert VALID_AADHAAR not in out
        assert "[PAN:" in out
        assert "[AADHAAR:" in out

    def test_filter_redacts_dict_payload(self) -> None:
        # Mirrors the _log_event pattern in main.py: a JSON-serialised dict
        # passed as the message body.
        buf = io.StringIO()
        handler = logging.StreamHandler(buf)
        handler.setFormatter(logging.Formatter("%(message)s"))
        log = logging.getLogger("test_pii_event")
        log.handlers.clear()
        log.addHandler(handler)
        log.setLevel(logging.INFO)
        install_redaction(log)

        payload = json.dumps({"event": "override", "pan": VALID_PAN})
        log.info("%s", payload)
        handler.flush()
        out = buf.getvalue()
        assert VALID_PAN not in out
        assert "[PAN:" in out

    def test_install_is_idempotent(self) -> None:
        log = logging.getLogger("test_pii_idempotent")
        install_redaction(log)
        install_redaction(log)
        # Filter set must contain exactly one RedactingFilter.
        count = sum(isinstance(f, RedactingFilter) for f in log.filters)
        assert count == 1


class TestStringHelper:
    def test_redact_string(self) -> None:
        assert "[PAN:" in redact_string(f"x {VALID_PAN} y")

    def test_redact_string_preserves_non_pii(self) -> None:
        assert redact_string("nothing to mask") == "nothing to mask"


@pytest.mark.parametrize("identifier", [VALID_PAN, VALID_AADHAAR, VALID_GSTIN])
def test_no_raw_identifier_survives(identifier: str) -> None:
    out = redact(f"prefix {identifier} suffix")
    assert identifier not in out
