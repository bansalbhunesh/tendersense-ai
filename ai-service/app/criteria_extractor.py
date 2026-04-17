"""Extract structured criteria from tender text — Claude API or deterministic fallback."""

from __future__ import annotations

import json
import os
import re
import uuid
from typing import Any


def _fallback_criteria(text: str) -> list[dict[str, Any]]:
    """Heuristic extraction for demos without API keys."""
    out: list[dict[str, Any]] = []
    t = text.lower()

    m = re.search(r"turnover[^\d₹]*(?:₹|rs\.?|inr)?\s*([\d,\.]+)\s*(crore|lakh|lac)?", t, re.I)
    if m:
        raw = m.group(1).replace(",", "")
        mult = 1.0
        if m.group(2) and "crore" in m.group(2).lower():
            mult = 1e7
        elif m.group(2):
            mult = 1e5
        try:
            val = float(raw) * mult
        except ValueError:
            val = 5e7
        out.append(
            {
                "id": f"crit_{uuid.uuid4().hex[:8]}",
                "text_raw": m.group(0),
                "field": "annual_turnover",
                "operator": ">=",
                "value": val,
                "unit": "INR",
                "mandatory": True,
                "source_priority": ["ca_certificate", "audited_balance_sheet", "itr"],
                "depends_on": None,
                "semantic_ambiguity_score": 0.12,
                "extraction_confidence": 0.75,
                "temporal": {"type": "any_of_last_n_years", "n": 3, "anchor": "tender_date"},
            }
        )

    if "gst" in t or "goods and services tax" in t:
        out.append(
            {
                "id": f"crit_{uuid.uuid4().hex[:8]}",
                "text_raw": "Valid GST registration",
                "field": "gst_registration",
                "operator": "==",
                "value": 1,
                "unit": "bool",
                "mandatory": True,
                "source_priority": ["gst_certificate", "itr"],
                "depends_on": None,
                "semantic_ambiguity_score": 0.05,
                "extraction_confidence": 0.9,
            }
        )

    if "iso 9001" in t or "iso9001" in t:
        out.append(
            {
                "id": f"crit_{uuid.uuid4().hex[:8]}",
                "text_raw": "ISO 9001 certification",
                "field": "iso_9001",
                "operator": "==",
                "value": 1,
                "unit": "bool",
                "mandatory": False,
                "source_priority": ["iso_certificate"],
                "depends_on": None,
                "semantic_ambiguity_score": 0.08,
                "extraction_confidence": 0.88,
            }
        )

    pm = re.search(r"(\d+)\s*(similar )?projects?", t)
    if pm:
        n = int(pm.group(1))
        out.append(
            {
                "id": f"crit_{uuid.uuid4().hex[:8]}",
                "text_raw": pm.group(0),
                "field": "similar_projects_count",
                "operator": ">=",
                "value": float(n),
                "unit": "count",
                "mandatory": True,
                "source_priority": ["experience_letters", "work_order"],
                "depends_on": None,
                "semantic_ambiguity_score": 0.25,
                "extraction_confidence": 0.7,
                "temporal": {"type": "last_n_years", "n": 5},
            }
        )

    if not out:
        out.append(
            {
                "id": f"crit_{uuid.uuid4().hex[:8]}",
                "text_raw": "Minimum eligibility (placeholder)",
                "field": "generic_compliance",
                "operator": "==",
                "value": 1,
                "unit": "bool",
                "mandatory": True,
                "source_priority": ["supporting"],
                "depends_on": None,
                "semantic_ambiguity_score": 0.5,
                "extraction_confidence": 0.4,
            }
        )
    return out


def extract_criteria_llm(text: str) -> list[dict[str, Any]]:
    key = os.getenv("ANTHROPIC_API_KEY")
    if not key:
        return _fallback_criteria(text)

    import anthropic

    client = anthropic.Anthropic(api_key=key)
    prompt = f"""You are extracting procurement eligibility criteria from tender text.
Return a JSON object with key "criteria" whose value is an array of objects with fields:
id (string), text_raw, field (snake_case identifier), operator (one of >=, <=, ==, !=),
value (number), unit (INR|bool|count|years|percent), mandatory (boolean),
source_priority (array of doc type strings), depends_on (null or string),
semantic_ambiguity_score (0-1), extraction_confidence (0-1), temporal (object or null).

Tender text:
---
{text[:120000]}
---
"""
    msg = client.messages.create(
        model=os.getenv("ANTHROPIC_MODEL", "claude-sonnet-4-20250514"),
        max_tokens=4096,
        messages=[{"role": "user", "content": prompt}],
    )
    block = msg.content[0]
    raw = block.text if hasattr(block, "text") else str(block)
    start = raw.find("{")
    end = raw.rfind("}")
    if start < 0 or end < 0:
        return _fallback_criteria(text)
    try:
        data = json.loads(raw[start : end + 1])
        return data.get("criteria") or _fallback_criteria(text)
    except json.JSONDecodeError:
        return _fallback_criteria(text)


def generate_reasoning(criterion: dict[str, Any], verdict: str, evidence_summary: str) -> str:
    return (
        f"Criterion {criterion.get('field')} ({criterion.get('text_raw','')[:120]}). "
        f"Verdict: {verdict}. {evidence_summary}"
    )
