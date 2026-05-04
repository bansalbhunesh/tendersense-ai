"""Extract structured criteria from tender text — Claude API or deterministic fallback."""

from __future__ import annotations

import json
import logging
import os
import re
import uuid
from typing import Any

import httpx

from app.translation import detect_language, get_translator, translate_in_chunks

logger = logging.getLogger("tendersense-ai")


def _llm_backend() -> str:
    return (os.getenv("LLM_BACKEND") or "anthropic").strip().lower()


def _new_id() -> str:
    return f"crit_{uuid.uuid4().hex[:8]}"


def _criterion(
    *,
    text_raw: str,
    field: str,
    operator: str,
    value: float,
    unit: str,
    mandatory: bool,
    source_priority: list[str],
    extraction_confidence: float,
    semantic_ambiguity_score: float = 0.15,
    temporal: dict[str, Any] | None = None,
    source_clause: str | None = None,
) -> dict[str, Any]:
    """Build a criterion dict with the canonical shape used by the rest of the system."""
    out: dict[str, Any] = {
        "id": _new_id(),
        "text_raw": text_raw,
        "field": field,
        "operator": operator,
        "value": value,
        "unit": unit,
        "mandatory": mandatory,
        "source_priority": source_priority,
        "depends_on": None,
        "semantic_ambiguity_score": semantic_ambiguity_score,
        "extraction_confidence": extraction_confidence,
    }
    # Additive helpful fields — clients ignore unknown keys.
    if temporal is not None:
        out["temporal"] = temporal
    if source_clause:
        out["source_clause"] = source_clause[:400]
    # Stable category tag for downstream UIs.
    out["category"] = _category_for_field(field)
    return out


_CATEGORY_MAP = {
    "annual_turnover": "financial",
    "net_worth": "financial",
    "net_profit": "financial",
    "emd_amount": "financial",
    "bank_guarantee": "financial",
    "bid_validity_days": "compliance",
    "gst_registration": "tax",
    "pan_registration": "tax",
    "tds_registration": "tax",
    "iso_9001": "certification",
    "iso_14001": "certification",
    "iso_27001": "certification",
    "nabl_accreditation": "certification",
    "experience_years": "experience",
    "years_of_experience": "experience",
    "similar_projects_count": "experience",
    "manpower_count": "capacity",
    "technical_staff_count": "capacity",
    "msme_registration": "preference",
    "msme_preference": "preference",
    "blacklisting_declaration": "compliance",
    "registered_firm": "compliance",
    "generic_compliance": "compliance",
}


def _category_for_field(field: str) -> str:
    return _CATEGORY_MAP.get(field, "general")


def _parse_amount_inr(num_str: str, unit_str: str | None) -> float | None:
    """Convert a captured amount + optional unit (crore/lakh/lac/million) into rupees."""
    raw = (num_str or "").replace(",", "").strip()
    try:
        val = float(raw)
    except ValueError:
        return None
    u = (unit_str or "").lower()
    if "crore" in u or "cr" == u.strip():
        val *= 1e7
    elif "lakh" in u or "lac" in u:
        val *= 1e5
    elif "million" in u:
        val *= 1e6
    return val


def _find_clause(text: str, match: re.Match) -> str:
    """Return ~ a sentence around the match, useful for source_clause."""
    start = max(0, match.start() - 80)
    end = min(len(text), match.end() + 80)
    snippet = text[start:end].replace("\n", " ")
    return re.sub(r"\s+", " ", snippet).strip()


# ---------------------------------------------------------------------------
# Deterministic fallback
# ---------------------------------------------------------------------------

_AMOUNT_RE = (
    r"(?:₹|rs\.?|inr)?\s*([\d][\d,]*(?:\.\d+)?)\s*"
    r"(crore|crores|cr|lakh|lakhs|lac|lacs|million)?"
)


def _emit_turnover(text: str, t: str, out: list[dict[str, Any]]) -> None:
    m = re.search(r"turnover[^\n\d]{0,40}" + _AMOUNT_RE, t, re.I)
    if not m:
        return
    val = _parse_amount_inr(m.group(1), m.group(2))
    if val is None:
        return
    if val <= 0:
        val = 5e7
    out.append(
        _criterion(
            text_raw=m.group(0).strip(),
            field="annual_turnover",
            operator=">=",
            value=val,
            unit="INR",
            mandatory=True,
            source_priority=["ca_certificate", "audited_balance_sheet", "itr"],
            extraction_confidence=0.78,
            semantic_ambiguity_score=0.12,
            temporal={"type": "any_of_last_n_years", "n": 3, "anchor": "tender_date"},
            source_clause=_find_clause(text, m),
        )
    )


def _emit_net_worth(text: str, t: str, out: list[dict[str, Any]]) -> None:
    m = re.search(r"net\s*worth[^\n\d]{0,40}" + _AMOUNT_RE, t, re.I)
    val = 1e7
    raw = "Net worth requirement"
    clause = None
    if m:
        v = _parse_amount_inr(m.group(1), m.group(2))
        if v is not None and v > 0:
            val = v
        raw = m.group(0).strip()
        clause = _find_clause(text, m)
    elif re.search(r"positive\s*net\s*worth", t, re.I):
        m2 = re.search(r"positive\s*net\s*worth", t, re.I)
        clause = _find_clause(text, m2) if m2 else None
        raw = "Positive net worth requirement"
    else:
        return
    out.append(
        _criterion(
            text_raw=raw,
            field="net_worth",
            operator=">=",
            value=val,
            unit="INR",
            mandatory=True,
            source_priority=["audited_balance_sheet", "ca_certificate"],
            extraction_confidence=0.6 if clause else 0.55,
            semantic_ambiguity_score=0.2,
            source_clause=clause,
        )
    )


def _emit_emd(text: str, t: str, out: list[dict[str, Any]]) -> None:
    m = re.search(
        r"(?:earnest\s*money(?:\s*deposit)?|\bemd\b|bid\s*security)[^\n\d]{0,40}" + _AMOUNT_RE,
        t,
        re.I,
    )
    if not m:
        # presence-only fallback
        if re.search(r"\bemd\b|earnest\s*money|bid\s*security", t, re.I):
            mp = re.search(r"\bemd\b|earnest\s*money|bid\s*security", t, re.I)
            out.append(
                _criterion(
                    text_raw="EMD / bid security",
                    field="emd_amount",
                    operator=">=",
                    value=0.0,
                    unit="INR",
                    mandatory=True,
                    source_priority=["bank_statement", "supporting"],
                    extraction_confidence=0.5,
                    semantic_ambiguity_score=0.35,
                    source_clause=_find_clause(text, mp) if mp else None,
                )
            )
        return
    val = _parse_amount_inr(m.group(1), m.group(2))
    if val is None:
        return
    out.append(
        _criterion(
            text_raw=m.group(0).strip(),
            field="emd_amount",
            operator=">=",
            value=val,
            unit="INR",
            mandatory=True,
            source_priority=["bank_statement", "supporting"],
            extraction_confidence=0.7,
            semantic_ambiguity_score=0.2,
            source_clause=_find_clause(text, m),
        )
    )


def _emit_bank_guarantee(text: str, t: str, out: list[dict[str, Any]]) -> None:
    m = re.search(r"bank\s*guarantee[^\n\d]{0,40}" + _AMOUNT_RE, t, re.I)
    if not m:
        if re.search(r"\bbank\s*guarantee\b|\bperformance\s*(?:bank\s*)?guarantee\b|\bpbg\b", t, re.I):
            mp = re.search(r"\bbank\s*guarantee\b|\bperformance\s*(?:bank\s*)?guarantee\b|\bpbg\b", t, re.I)
            out.append(
                _criterion(
                    text_raw="Bank guarantee required",
                    field="bank_guarantee",
                    operator=">=",
                    value=0.0,
                    unit="INR",
                    mandatory=True,
                    source_priority=["bank_guarantee", "supporting"],
                    extraction_confidence=0.55,
                    semantic_ambiguity_score=0.3,
                    source_clause=_find_clause(text, mp) if mp else None,
                )
            )
        return
    val = _parse_amount_inr(m.group(1), m.group(2))
    if val is None:
        return
    out.append(
        _criterion(
            text_raw=m.group(0).strip(),
            field="bank_guarantee",
            operator=">=",
            value=val,
            unit="INR",
            mandatory=True,
            source_priority=["bank_guarantee", "supporting"],
            extraction_confidence=0.72,
            semantic_ambiguity_score=0.18,
            source_clause=_find_clause(text, m),
        )
    )


def _emit_experience(text: str, t: str, out: list[dict[str, Any]]) -> None:
    m = re.search(
        r"(\d+)\s*(?:\+|or\s*more)?\s*(?:years?|yrs?)\s*(?:of)?\s*"
        r"(?:experience|relevant\s*experience|professional\s*experience)",
        t,
        re.I,
    )
    if m:
        try:
            n = float(m.group(1))
        except ValueError:
            n = 3.0
        out.append(
            _criterion(
                text_raw=m.group(0).strip(),
                field="experience_years",
                operator=">=",
                value=n,
                unit="years",
                mandatory=True,
                source_priority=["experience_letters", "work_order", "supporting"],
                extraction_confidence=0.78,
                semantic_ambiguity_score=0.15,
                source_clause=_find_clause(text, m),
            )
        )
        return
    if re.search(r"\b(?:relevant\s+)?experience\b|past\s*performance|similar\s*work", t, re.I):
        mp = re.search(r"\b(?:relevant\s+)?experience\b|past\s*performance|similar\s*work", t, re.I)
        out.append(
            _criterion(
                text_raw="Relevant experience / similar contracts",
                field="experience_years",
                operator=">=",
                value=3.0,
                unit="years",
                mandatory=True,
                source_priority=["experience_letters", "work_order", "supporting"],
                extraction_confidence=0.55,
                semantic_ambiguity_score=0.3,
                source_clause=_find_clause(text, mp) if mp else None,
            )
        )


def _emit_similar_projects(text: str, t: str, out: list[dict[str, Any]]) -> None:
    m = re.search(r"(\d+)\s*(?:similar|completed)?\s*projects?\s*(?:of\s*similar\s*nature)?", t, re.I)
    if not m:
        return
    try:
        n = float(m.group(1))
    except ValueError:
        return
    if n <= 0 or n > 50:
        return
    out.append(
        _criterion(
            text_raw=m.group(0).strip(),
            field="similar_projects_count",
            operator=">=",
            value=n,
            unit="count",
            mandatory=True,
            source_priority=["experience_letters", "work_order"],
            extraction_confidence=0.7,
            semantic_ambiguity_score=0.22,
            temporal={"type": "last_n_years", "n": 5},
            source_clause=_find_clause(text, m),
        )
    )


def _emit_manpower(text: str, t: str, out: list[dict[str, Any]]) -> None:
    m = re.search(
        r"(\d+)\s*(?:\+|or\s*more)?\s*(?:full[-\s]*time\s*)?"
        r"(?:employees?|engineers?|technical\s*staff|manpower|professionals?|personnel)",
        t,
        re.I,
    )
    if not m:
        return
    try:
        n = float(m.group(1))
    except ValueError:
        return
    if n <= 0 or n > 100000:
        return
    field_name = "manpower_count"
    if "engineer" in m.group(0).lower() or "technical" in m.group(0).lower():
        field_name = "technical_staff_count"
    out.append(
        _criterion(
            text_raw=m.group(0).strip(),
            field=field_name,
            operator=">=",
            value=n,
            unit="count",
            mandatory=True,
            source_priority=["pf_records", "epf_statement", "hr_certificate", "supporting"],
            extraction_confidence=0.7,
            semantic_ambiguity_score=0.2,
            source_clause=_find_clause(text, m),
        )
    )


def _emit_iso_certs(text: str, t: str, out: list[dict[str, Any]]) -> None:
    iso_specs = [
        ("iso_9001", r"iso[\s\-]*9001", "ISO 9001 certification (quality management)"),
        ("iso_14001", r"iso[\s\-]*14001", "ISO 14001 certification (environment)"),
        ("iso_27001", r"iso[\s\-]*27001", "ISO 27001 certification (information security)"),
    ]
    for field, pat, label in iso_specs:
        m = re.search(pat, t, re.I)
        if not m:
            continue
        out.append(
            _criterion(
                text_raw=label,
                field=field,
                operator="==",
                value=1,
                unit="bool",
                mandatory=False,
                source_priority=["iso_certificate"],
                extraction_confidence=0.88,
                semantic_ambiguity_score=0.08,
                source_clause=_find_clause(text, m),
            )
        )
    if re.search(r"\bnabl\b|nabl\s*accredit", t, re.I):
        m = re.search(r"\bnabl\b", t, re.I)
        out.append(
            _criterion(
                text_raw="NABL accreditation",
                field="nabl_accreditation",
                operator="==",
                value=1,
                unit="bool",
                mandatory=False,
                source_priority=["nabl_certificate"],
                extraction_confidence=0.85,
                semantic_ambiguity_score=0.1,
                source_clause=_find_clause(text, m) if m else None,
            )
        )


def _emit_tax_compliance(text: str, t: str, out: list[dict[str, Any]]) -> None:
    if "gst" in t or "goods and services tax" in t:
        m = re.search(r"\bgst\b|goods and services tax", t, re.I)
        out.append(
            _criterion(
                text_raw="Valid GST registration",
                field="gst_registration",
                operator="==",
                value=1,
                unit="bool",
                mandatory=True,
                source_priority=["gst_certificate", "itr"],
                extraction_confidence=0.9,
                semantic_ambiguity_score=0.05,
                source_clause=_find_clause(text, m) if m else None,
            )
        )
    if re.search(r"\bpan\b|permanent account number", t, re.I):
        m = re.search(r"\bpan\b|permanent account number", t, re.I)
        out.append(
            _criterion(
                text_raw="PAN registration",
                field="pan_registration",
                operator="==",
                value=1,
                unit="bool",
                mandatory=True,
                source_priority=["pan_certificate", "itr"],
                extraction_confidence=0.88,
                semantic_ambiguity_score=0.05,
                source_clause=_find_clause(text, m) if m else None,
            )
        )
    if re.search(r"\btds\b|tax deducted at source|tan\s*number", t, re.I):
        m = re.search(r"\btds\b|tax deducted at source|tan\s*number", t, re.I)
        out.append(
            _criterion(
                text_raw="TDS / TAN compliance",
                field="tds_registration",
                operator="==",
                value=1,
                unit="bool",
                mandatory=False,
                source_priority=["tds_certificate", "itr"],
                extraction_confidence=0.78,
                semantic_ambiguity_score=0.12,
                source_clause=_find_clause(text, m) if m else None,
            )
        )


def _emit_msme(text: str, t: str, out: list[dict[str, Any]]) -> None:
    if re.search(r"\bmsme\b|udyam|udyog\s*aadhar|micro,?\s*small\s*and\s*medium", t, re.I):
        m = re.search(r"\bmsme\b|udyam|udyog\s*aadhar|micro,?\s*small\s*and\s*medium", t, re.I)
        out.append(
            _criterion(
                text_raw="MSME / Udyam registration",
                field="msme_registration",
                operator="==",
                value=1,
                unit="bool",
                mandatory=False,
                source_priority=["msme_certificate", "udyam_certificate"],
                extraction_confidence=0.82,
                semantic_ambiguity_score=0.1,
                source_clause=_find_clause(text, m) if m else None,
            )
        )


def _emit_bid_validity(text: str, t: str, out: list[dict[str, Any]]) -> None:
    m = re.search(r"bid\s*validity[^\n\d]{0,30}(\d{2,4})\s*(?:days?|d)?", t, re.I)
    if m:
        try:
            n = float(m.group(1))
        except ValueError:
            return
        out.append(
            _criterion(
                text_raw=m.group(0).strip(),
                field="bid_validity_days",
                operator=">=",
                value=n,
                unit="days",
                mandatory=True,
                source_priority=["bid_form", "supporting"],
                extraction_confidence=0.78,
                semantic_ambiguity_score=0.1,
                source_clause=_find_clause(text, m),
            )
        )
        return
    m2 = re.search(r"validity\s*of\s*bid[^\n\d]{0,30}(\d{2,4})\s*(?:days?|d)?", t, re.I)
    if m2:
        try:
            n = float(m2.group(1))
        except ValueError:
            return
        out.append(
            _criterion(
                text_raw=m2.group(0).strip(),
                field="bid_validity_days",
                operator=">=",
                value=n,
                unit="days",
                mandatory=True,
                source_priority=["bid_form", "supporting"],
                extraction_confidence=0.75,
                semantic_ambiguity_score=0.12,
                source_clause=_find_clause(text, m2),
            )
        )


def _emit_blacklisting(text: str, t: str, out: list[dict[str, Any]]) -> None:
    if re.search(r"black[\s\-]*list|debar(?:red|ment)|not\s*black[\s\-]*listed", t, re.I):
        m = re.search(r"black[\s\-]*list|debar(?:red|ment)|not\s*black[\s\-]*listed", t, re.I)
        out.append(
            _criterion(
                text_raw="Non-blacklisting / non-debarment declaration",
                field="blacklisting_declaration",
                operator="==",
                value=1,
                unit="bool",
                mandatory=True,
                source_priority=["affidavit", "undertaking", "supporting"],
                extraction_confidence=0.75,
                semantic_ambiguity_score=0.15,
                source_clause=_find_clause(text, m) if m else None,
            )
        )


def _fallback_criteria(text: str) -> list[dict[str, Any]]:
    """Heuristic extraction for demos without API keys.

    Each criterion is shaped as:
        {id, category, text_raw, field, operator, value, unit, mandatory,
         source_priority, depends_on, semantic_ambiguity_score,
         extraction_confidence, [temporal], [source_clause]}
    """
    if not text:
        return _placeholder()

    out: list[dict[str, Any]] = []
    t = text.lower()

    _emit_turnover(text, t, out)
    _emit_net_worth(text, t, out)
    _emit_emd(text, t, out)
    _emit_bank_guarantee(text, t, out)
    _emit_experience(text, t, out)
    _emit_similar_projects(text, t, out)
    _emit_manpower(text, t, out)
    _emit_iso_certs(text, t, out)
    _emit_tax_compliance(text, t, out)
    _emit_msme(text, t, out)
    _emit_bid_validity(text, t, out)
    _emit_blacklisting(text, t, out)

    # Deduplicate by field — keep the first (most-specific) occurrence.
    seen: set[str] = set()
    deduped: list[dict[str, Any]] = []
    for c in out:
        f = str(c.get("field"))
        if f in seen:
            continue
        seen.add(f)
        deduped.append(c)

    if not deduped:
        return _placeholder()
    return deduped


def _placeholder() -> list[dict[str, Any]]:
    return [
        _criterion(
            text_raw="Minimum eligibility (placeholder)",
            field="generic_compliance",
            operator="==",
            value=1,
            unit="bool",
            mandatory=True,
            source_priority=["supporting"],
            extraction_confidence=0.4,
            semantic_ambiguity_score=0.5,
        )
    ]


def extract_criteria_llm(text: str) -> list[dict[str, Any]]:
    backend = _llm_backend()
    if backend in ("disabled", "bhashini"):
        if backend == "bhashini":
            logger.warning(
                "LLM_BACKEND=bhashini: Bhashini-LLM cross-check is not implemented; "
                "using deterministic extractor only."
            )
        return _fallback_criteria(text)

    client: Any = None
    if backend == "anthropic":
        key = os.getenv("ANTHROPIC_API_KEY")
        if not key:
            logger.warning("No Anthropic API key found, using fallback heuristics.")
            return _fallback_criteria(text)
        try:
            import anthropic
            client = anthropic.Anthropic(api_key=key)
        except ImportError:
            logger.warning("anthropic package not installed, using fallback heuristics.")
            return _fallback_criteria(text)
    elif backend == "groq":
        if not os.getenv("GROQ_API_KEY"):
            logger.warning("No Groq API key found, using fallback heuristics.")
            return _fallback_criteria(text)
    else:
        logger.warning("Unknown LLM_BACKEND=%s, using fallback heuristics.", backend)
        return _fallback_criteria(text)
    # limit input to avoid token overflow
    content = text[:150000]

    prompt = f"""You are a specialist in public procurement. Extract all eligibility criteria (technical, financial, legal) from the tender document below.
Return ONLY a JSON object with this structure:
{{
  "criteria": [
    {{
      "id": "unique_id",
      "text_raw": "exact snippet from text",
      "field": "snake_case_identifier",
      "operator": ">=|<=|==|!=",
      "value": number (use 1 for bool),
      "unit": "INR|bool|count|percent",
      "mandatory": true,
      "source_priority": ["doc_type1", "doc_type2"],
      "semantic_ambiguity_score": 0.0-1.0,
      "depends_on": "criterion_id_or_null",
      "temporal": {{"type":"any_of_last_n_years|last_n_years|null", "n":3}}
    }}
  ]
}}

TENDER TEXT:
{content}
"""
    try:
        if backend == "anthropic":
            msg = client.messages.create(
                model=os.getenv("ANTHROPIC_MODEL", "claude-sonnet-4-20250514"),
                max_tokens=int(os.getenv("CRITERIA_MAX_OUTPUT_TOKENS", "4096")),
                temperature=0,
                messages=[{"role": "user", "content": prompt}],
            )
            raw = msg.content[0].text
        else:
            resp = httpx.post(
                "https://api.groq.com/openai/v1/chat/completions",
                headers={
                    "Authorization": f"Bearer {os.getenv('GROQ_API_KEY', '')}",
                    "Content-Type": "application/json",
                },
                json={
                    "model": os.getenv("GROQ_MODEL", "llama-3.3-70b-versatile"),
                    "messages": [{"role": "user", "content": prompt}],
                    "temperature": 0,
                    "response_format": {"type": "json_object"},
                },
                timeout=90.0,
            )
            resp.raise_for_status()
            payload = resp.json()
            raw = (
                payload.get("choices", [{}])[0]
                .get("message", {})
                .get("content", "")
            )

        # Robust JSON search
        match = re.search(r"\{.*\}", raw, re.DOTALL)
        if not match:
            logger.error("No JSON structure found in LLM response.")
            return _fallback_criteria(text)

        data = json.loads(match.group(0))
        criteria = data.get("criteria", [])
        if not criteria:
            return _fallback_criteria(text)
        # Backfill optional fields that are often omitted by LLM output.
        for c in criteria:
            if not isinstance(c, dict):
                continue
            c.setdefault("depends_on", None)
            c.setdefault("temporal", None)
            c.setdefault("category", _category_for_field(str(c.get("field", ""))))
        return criteria

    except Exception as e:
        logger.exception(f"LLM criteria extraction failed: {str(e)}")
        return _fallback_criteria(text)


def extract_criteria(text: str) -> dict[str, Any]:
    """Bharat-first entry: detect language, optionally translate to English via the
    configured translator, run extraction, and tag each criterion with the source
    language and translated clause.

    Returns a dict with keys: ``criteria`` (list), ``source_text_lang`` (str),
    and optionally ``extraction_warning`` (str) when translation was needed but
    not available.
    """
    lang = detect_language(text or "")
    out: dict[str, Any] = {"criteria": [], "source_text_lang": lang}

    if lang == "en" or not text:
        out["criteria"] = extract_criteria_llm(text or "")
        return out

    # Indic content detected; try to translate before extraction.
    translator = get_translator()
    backend_name = getattr(translator, "name", "disabled")
    translated: str | None = None
    warning: str | None = None

    if backend_name == "disabled":
        warning = "untranslated_indic_text"
    else:
        try:
            translated = translate_in_chunks(translator, text, src=lang if lang == "hi" else "hi", tgt="en")
        except Exception as e:
            logger.warning("Translator failed, falling back to raw text: %s", e)
            warning = "untranslated_indic_text"

    extractor_input = translated if translated else text
    criteria = extract_criteria_llm(extractor_input)

    # Stamp source-language metadata onto each criterion (additive only).
    for c in criteria:
        if not isinstance(c, dict):
            continue
        c.setdefault("source_text_lang", lang)
        if translated:
            # Echo a slice of the translated text so UIs can show the English
            # version next to the original Hindi clause.
            existing_clause = str(c.get("source_clause") or "")[:400]
            c.setdefault("source_clause_translated", existing_clause)

    if warning:
        out["extraction_warning"] = warning
    out["criteria"] = criteria
    return out
