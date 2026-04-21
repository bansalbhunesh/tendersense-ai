"""Extract structured criteria from tender text — Claude API or deterministic fallback."""

from __future__ import annotations

import json
import logging
import os
import re
import uuid
from typing import Any

logger = logging.getLogger("tendersense-ai")


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

    if re.search(r"net\s*worth|positive\s*net\s*worth", t, re.I):
        out.append(
            {
                "id": f"crit_{uuid.uuid4().hex[:8]}",
                "text_raw": "Net worth / positive net worth requirement",
                "field": "net_worth",
                "operator": ">=",
                "value": 1e7,
                "unit": "INR",
                "mandatory": True,
                "source_priority": ["audited_balance_sheet", "ca_certificate"],
                "depends_on": None,
                "semantic_ambiguity_score": 0.2,
                "extraction_confidence": 0.55,
            }
        )

    if re.search(r"\bemd\b|earnest\s*money|bid\s*security\s*deposit", t, re.I):
        out.append(
            {
                "id": f"crit_{uuid.uuid4().hex[:8]}",
                "text_raw": "EMD / bid security",
                "field": "emd_amount",
                "operator": ">=",
                "value": 0.0,
                "unit": "INR",
                "mandatory": True,
                "source_priority": ["bank_statement", "supporting"],
                "depends_on": None,
                "semantic_ambiguity_score": 0.35,
                "extraction_confidence": 0.5,
            }
        )

    if re.search(r"experience|similar\s*work|past\s*performance", t, re.I):
        out.append(
            {
                "id": f"crit_{uuid.uuid4().hex[:8]}",
                "text_raw": "Relevant experience / similar contracts",
                "field": "experience_years",
                "operator": ">=",
                "value": 3.0,
                "unit": "count",
                "mandatory": True,
                "source_priority": ["experience_letters", "work_order", "supporting"],
                "depends_on": None,
                "semantic_ambiguity_score": 0.3,
                "extraction_confidence": 0.55,
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
        logger.warning("No Anthropic API key found, using fallback heuristics.")
        return _fallback_criteria(text)

    try:
        import anthropic
    except ImportError:
        logger.warning("anthropic package not installed, using fallback heuristics.")
        return _fallback_criteria(text)

    client = anthropic.Anthropic(api_key=key)
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
      "semantic_ambiguity_score": 0.0-1.0
    }}
  ]
}}

TENDER TEXT:
{content}
"""
    try:
        msg = client.messages.create(
            model=os.getenv("ANTHROPIC_MODEL", "claude-3-5-sonnet-20240620"),
            max_tokens=4096,
            temperature=0,
            messages=[{"role": "user", "content": prompt}],
        )
        raw = msg.content[0].text
        
        # Robust JSON search
        match = re.search(r"\{.*\}", raw, re.DOTALL)
        if not match:
            logger.error("No JSON structure found in LLM response.")
            return _fallback_criteria(text)
        
        data = json.loads(match.group(0))
        criteria = data.get("criteria", [])
        if not criteria:
            return _fallback_criteria(text)
        return criteria
        
    except Exception as e:
        logger.exception(f"LLM criteria extraction failed: {str(e)}")
        return _fallback_criteria(text)


def generate_reasoning(criterion: dict[str, Any], verdict: str, evidence_summary: str) -> str:
    return (
        f"Criterion {criterion.get('field')} ({criterion.get('text_raw','')[:120]}). "
        f"Verdict: {verdict}. {evidence_summary}"
    )
