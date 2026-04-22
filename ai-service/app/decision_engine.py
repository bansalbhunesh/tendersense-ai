"""
Confidence-weighted criterion evaluation, conflict detection, cross-document checks,
and reasoning graph construction.
"""

from __future__ import annotations

import json
import os
import re
import uuid
from dataclasses import dataclass, field
from typing import Any


def _ocr_full_text(ocr: Any) -> str:
    """Aggregate OCR text from top-level `text` or per-page `pages[].text`."""
    if isinstance(ocr, str):
        try:
            ocr = json.loads(ocr)
        except Exception:
            return ocr.strip() if ocr else ""
    if not isinstance(ocr, dict):
        return ""
    t = str(ocr.get("text") or "").strip()
    if t:
        return t
    pages = ocr.get("pages") or []
    if not isinstance(pages, list):
        return ""
    parts: list[str] = []
    for p in pages:
        if isinstance(p, dict) and p.get("text"):
            parts.append(str(p["text"]))
    return "\n".join(parts).strip()


def _graph_criterion_label(c: dict[str, Any], cid: str) -> str:
    raw = str(c.get("text_raw") or "").strip()
    field = str(c.get("field") or "").strip()
    if len(raw) >= 400:
        base = raw[:397] + "…"
    else:
        base = raw or field or cid
    if field and field not in base[:40]:
        return f"{field}: {base}"[:420]
    return base[:420]


def overall_confidence(
    ocr_c: float,
    extraction_c: float,
    source_priority_score: float,
    conflict_penalty: float,
) -> float:
    return (
        ocr_c * 0.35
        + extraction_c * 0.30
        + source_priority_score * 0.20
        + (1.0 - conflict_penalty) * 0.15
    )


def source_priority_index(doc_type: str, priority: list[str]) -> float:
    try:
        return 1.0 - (priority.index(doc_type) / max(len(priority), 1)) * 0.2
    except ValueError:
        return 0.5


def normalize_inr_from_text(text: str) -> list[tuple[float, float, str]]:
    """Return list of (value_inr, local_confidence, snippet)."""
    out: list[tuple[float, float, str]] = []
    for m in re.finditer(
        r"(?:₹|Rs\.?|INR)\s*([\d,]+(?:\.\d+)?)\s*(crore|lakh|lac|million)?",
        text,
        re.I,
    ):
        num = m.group(1).replace(",", "")
        try:
            v = float(num)
        except ValueError:
            continue
        unit = (m.group(2) or "").lower()
        if "crore" in unit:
            v *= 1e7
        elif "lakh" in unit or "lac" in unit:
            v *= 1e5
        elif "million" in unit:
            v *= 1e7
        out.append((v, 0.9, m.group(0)))
    for m in re.finditer(r"turnover[^\d]{0,40}([\d,]{4,})", text, re.I):
        raw = m.group(1).replace(",", "")
        if raw.isdigit():
            v = float(raw)
            if v < 1e6:
                v *= 1e7
            out.append((v, 0.75, m.group(0)))
    return out


def extract_bool_signals(text: str, field_name: str) -> tuple[float, float]:
    t = text.lower()
    if field_name == "gst_registration":
        if re.search(r"\b\d{2}[a-z]{5}\d{4}[a-z][a-z0-9]\b", t, re.I):
            return 1.0, 0.92
        if "gst" in t and "registration" in t:
            return 1.0, 0.8
        return 0.0, 0.5
    if field_name == "iso_9001":
        if "iso" in t and "9001" in t:
            return 1.0, 0.85
        return 0.0, 0.6
    if field_name == "generic_compliance":
        if len(t) > 80 and ("certif" in t or "undertaking" in t or "compliance" in t):
            return 1.0, 0.55
        return 0.0, 0.45
    if field_name == "blacklisting_declaration":
        if "not blacklisted" in t or "no blacklisting" in t:
            return 1.0, 0.82
        if "blacklisted" in t:
            return 0.0, 0.85
        return 0.0, 0.45
    if field_name == "registered_firm":
        if "registered" in t and ("firm" in t or "company" in t):
            return 1.0, 0.75
        return 0.0, 0.45
    if field_name == "msme_preference":
        if "msme" in t or "udyam" in t:
            return 1.0, 0.78
        return 0.0, 0.45
    if field_name == "pan_registration":
        if re.search(r"\b[a-z]{5}\d{4}[a-z]\b", t, re.I):
            return 1.0, 0.88
        if "pan" in t:
            return 1.0, 0.7
        return 0.0, 0.45
    return 0.0, 0.4


def extract_count(text: str, field_name: str) -> tuple[float, float]:
    if field_name in ("similar_projects_count", "experience_years", "years_of_experience"):
        nums = [int(x) for x in re.findall(r"(\d+)\s*(?:similar|projects?|works?)", text, re.I)]
        if nums:
            return float(max(nums)), 0.72
        years = [int(x) for x in re.findall(r"(\d+)\s*(?:years?|yrs?)", text, re.I)]
        if years:
            return float(max(years)), 0.7
        nums2 = [int(x) for x in re.findall(r"\b(\d+)\s+projects?\b", text, re.I)]
        if nums2:
            return float(max(nums2)), 0.65
    if field_name == "technical_staff_count":
        nums = [int(x) for x in re.findall(r"(\d+)\s*(?:technical staff|engineers?|staff)", text, re.I)]
        if nums:
            return float(max(nums)), 0.76
    return 0.0, 0.4


@dataclass
class Evidence:
    id: str
    criterion_id: str
    bidder_id: str
    document_id: str
    filename: str
    page: int
    raw_text: str
    normalized_value: float
    ocr_confidence: float
    extraction_confidence: float
    doc_type: str
    bounding_box: dict[str, float] | None = None
    conflicts_with: list[str] = field(default_factory=list)


def gather_evidence(
    criterion: dict[str, Any], bidder_id: str, documents: list[dict[str, Any]]
) -> list[Evidence]:
    field_name = str(criterion.get("field", ""))
    crit_id = str(criterion.get("id", ""))
    evs: list[Evidence] = []
    for doc in documents:
        ocr = doc.get("ocr") or {}
        if isinstance(ocr, str):
            try:
                ocr = json.loads(ocr)
            except Exception:
                ocr = {}
        text = _ocr_full_text(ocr)
        ocr_c = float(ocr.get("quality_score") or ocr.get("mean_confidence") or 0.75)
        doc_id = str(doc.get("id", ""))
        fname = str(doc.get("filename", ""))
        dtype = str(doc.get("doc_type", "supporting"))

        if field_name in (
            "annual_turnover",
            "net_worth",
            "net_profit",
            "turnover",
            "emd_amount",
            "bid_security",
            "earnest_money",
        ):
            for val, ext_c, snip in normalize_inr_from_text(text):
                evs.append(
                    Evidence(
                        id=f"ev_{uuid.uuid4().hex[:10]}",
                        criterion_id=crit_id,
                        bidder_id=bidder_id,
                        document_id=doc_id,
                        filename=fname,
                        page=1,
                        raw_text=snip[:500],
                        normalized_value=val,
                        ocr_confidence=ocr_c,
                        extraction_confidence=ext_c,
                        doc_type=dtype,
                    )
                )
        elif field_name in (
            "gst_registration",
            "iso_9001",
            "generic_compliance",
            "blacklisting_declaration",
            "registered_firm",
            "msme_preference",
            "pan_registration",
        ):
            nv, ec = extract_bool_signals(text, field_name)
            if nv > 0 or field_name == "generic_compliance":
                evs.append(
                    Evidence(
                        id=f"ev_{uuid.uuid4().hex[:10]}",
                        criterion_id=crit_id,
                        bidder_id=bidder_id,
                        document_id=doc_id,
                        filename=fname,
                        page=1,
                        raw_text=text[:400],
                        normalized_value=nv,
                        ocr_confidence=ocr_c,
                        extraction_confidence=ec,
                        doc_type=dtype,
                    )
                )
        elif field_name in ("similar_projects_count", "experience_years", "years_of_experience", "technical_staff_count"):
            nv, ec = extract_count(text, field_name)
            if nv > 0:
                evs.append(
                    Evidence(
                        id=f"ev_{uuid.uuid4().hex[:10]}",
                        criterion_id=crit_id,
                        bidder_id=bidder_id,
                        document_id=doc_id,
                        filename=fname,
                        page=1,
                        raw_text=text[:400],
                        normalized_value=nv,
                        ocr_confidence=ocr_c,
                        extraction_confidence=ec,
                        doc_type=dtype,
                    )
                )
    return evs


def has_conflict(values: list[float], threshold_ratio: float = 0.05) -> bool:
    if len(values) < 2:
        return False
    mx = max(values)
    mn = min(values)
    if mx <= 0:
        return abs(mx - mn) > 1
    return (mx - mn) / mx > threshold_ratio


def cross_doc_validate(evs: list[Evidence]) -> None:
    by_field_vals: dict[str, list[float]] = {}
    for e in evs:
        key = e.criterion_id
        by_field_vals.setdefault(key, []).append(e.normalized_value)
    for e in evs:
        vals = by_field_vals.get(e.criterion_id, [])
        if has_conflict(vals):
            others = [x.id for x in evs if x.criterion_id == e.criterion_id and x.id != e.id]
            e.conflicts_with.extend(others)


def eval_operator(norm: float, op: str, target: float) -> bool:
    if op == ">=":
        return norm >= target
    if op == "<=":
        return norm <= target
    if op == "==":
        return abs(norm - target) < 1e-6
    if op == "!=":
        return abs(norm - target) >= 1e-6
    return False


def select_best_evidence(evs: list[Evidence], priority: list[str]) -> Evidence | None:
    if not evs:
        return None
    scored: list[tuple[float, Evidence]] = []
    for e in evs:
        spi = source_priority_index(e.doc_type, priority)
        cp = 1.0 if e.conflicts_with else 0.0
        conf = overall_confidence(e.ocr_confidence, e.extraction_confidence, spi, cp)
        scored.append((conf, e))
    scored.sort(key=lambda x: x[0], reverse=True)
    return scored[0][1]


def _get_anthropic_client():
    """Lazy-load the anthropic client. Returns None if not available."""
    key = os.getenv("ANTHROPIC_API_KEY")
    if not key:
        return None
    try:
        import anthropic
        return anthropic.Anthropic(api_key=key)
    except ImportError:
        return None


def call_llm_eval(criterion: dict[str, Any], bidder_id: str, documents: list[dict[str, Any]]) -> dict[str, Any]:
    """Use Claude to evaluate a criterion when deterministic logic is insufficient."""
    client = _get_anthropic_client()
    if client is None:
        return {
            "verdict": "NEEDS_REVIEW",
            "reason": "NO_API_KEY",
            "confidence": 0.0,
            "reasoning": "Anthropic API key missing or anthropic package not installed.",
        }

    max_docs = int(os.getenv("LLM_MAX_DOCS", "8"))
    max_chars = int(os.getenv("LLM_MAX_CONTEXT_CHARS", "180000"))
    context_text = ""
    for d in documents[:max_docs]:
        ocr = d.get("ocr") or {}
        if isinstance(ocr, str):
            try:
                ocr = json.loads(ocr)
            except Exception:
                ocr = {}
        text = _ocr_full_text(ocr)
        if text:
            snippet = f"\n--- Document: {d.get('filename')} ---\n{text[:40000]}\n"
            room = max_chars - len(context_text)
            if room <= 0:
                break
            if len(snippet) > room:
                context_text += snippet[:room]
                break
            context_text += snippet

    prompt = f"""You are a senior procurement auditor evaluating bid eligibility.
Criterion to verify:
- Field: {criterion.get('field')}
- Label: {criterion.get('text_raw')}
- Requirement: {criterion.get('operator')} {criterion.get('value')} {criterion.get('unit', '')}

Evaluation Protocol:
1. Search across all provided documents for the specific information requested.
2. If multiple values conflict, prefer the one from more authoritative documents (e.g., Audited Balance Sheets over simple Undertakings).
3. Determine if the requirement is met mathematically or semantically.

Evidence Documents:
{context_text}

Return ONLY a JSON object:
{{
  "verdict": "ELIGIBLE" | "NOT_ELIGIBLE" | "NEEDS_REVIEW",
  "reason": "DEPOSIT_MISSING" | "TURNOVER_LOW" | "EXP_SHORT" | "MATCH" | etc,
  "confidence": float (0-1),
  "reasoning": "Three-step explanation of your discovery and logic.",
  "evidence_snapshot": {{ 
      "document": "filename", 
      "evidence_quote": "Exact text snippet from the document",
      "extracted_value": "The specific value or fact extracted"
  }}
}}
"""
    try:
        msg = client.messages.create(
            model=os.getenv("ANTHROPIC_MODEL", "claude-sonnet-4-20250514"),
            max_tokens=int(os.getenv("LLM_MAX_OUTPUT_TOKENS", "2200")),
            temperature=0,
            messages=[{"role": "user", "content": prompt}],
        )
        raw = msg.content[0].text
        match = re.search(r"\{.*\}", raw, re.DOTALL)
        if match:
            return json.loads(match.group(0))
        return {"verdict": "NEEDS_REVIEW", "reason": "PARSE_ERROR", "confidence": 0.0,
                "reasoning": "Could not parse LLM response."}
    except Exception as e:
        return {"verdict": "NEEDS_REVIEW", "reason": "LLM_FAILURE", "confidence": 0.0,
                "reasoning": f"LLM evaluation failed: {e!s}"}


def evaluate_criterion(criterion: dict[str, Any], bidder_id: str, documents: list[dict[str, Any]]) -> dict[str, Any]:
    """Evaluate a single criterion for a single bidder. Uses deterministic regex for known fields,
    falls back to LLM for unknown fields."""
    field_name = str(criterion.get("field", ""))
    crit_id = str(criterion.get("id", ""))
    priority = list(criterion.get("source_priority") or ["supporting"])
    sem_amb = float(criterion.get("semantic_ambiguity_score") or 0)

    KNOWN_FIELDS = (
        "annual_turnover",
        "net_worth",
        "net_profit",
        "turnover",
        "emd_amount",
        "bid_security",
        "earnest_money",
        "gst_registration",
        "iso_9001",
        "generic_compliance",
        "similar_projects_count",
        "experience_years",
        "years_of_experience",
        "technical_staff_count",
        "blacklisting_declaration",
        "registered_firm",
        "msme_preference",
        "pan_registration",
    )

    if field_name in KNOWN_FIELDS:
        evs = gather_evidence(criterion, bidder_id, documents)
        cross_doc_validate(evs)

        if not evs:
            return {
                "criterion_id": crit_id, "bidder_id": bidder_id,
                "verdict": "NEEDS_REVIEW", "reason": "NO_EVIDENCE",
                "confidence": 0.0, "evidence_used": [], "evidence_conflicting": [],
                "reviewer_required": True,
                "reasoning": "No evidence extracted for this criterion.",
                "ambiguity": {"extraction": 1.0, "semantic": sem_amb, "conflict": 0.0},
            }

        if any(e.conflicts_with for e in evs):
            ids = [e.id for e in evs]
            return {
                "criterion_id": crit_id, "bidder_id": bidder_id,
                "verdict": "NEEDS_REVIEW", "reason": "CONFLICT_DETECTED",
                "confidence": 0.51, "evidence_used": ids[:1], "evidence_conflicting": ids,
                "reviewer_required": True,
                "reasoning": "Conflicting values detected across documents.",
                "ambiguity": {"extraction": 0.0, "semantic": sem_amb, "conflict": 1.0},
            }

        best = select_best_evidence(evs, priority)
        if best is None:
            return {"criterion_id": crit_id, "bidder_id": bidder_id,
                    "verdict": "NEEDS_REVIEW", "reason": "NO_BEST_EVIDENCE", "confidence": 0.0}

        spi = source_priority_index(best.doc_type, priority)
        cp = 1.0 if best.conflicts_with else 0.0
        conf = overall_confidence(best.ocr_confidence, best.extraction_confidence, spi, cp)

        if best.ocr_confidence < 0.8:
            return {
                "criterion_id": crit_id, "bidder_id": bidder_id,
                "verdict": "NEEDS_REVIEW", "reason": "LOW_OCR_CONFIDENCE",
                "confidence": best.ocr_confidence, "evidence_used": [best.id],
                "reviewer_required": True,
                "reasoning": "OCR confidence below threshold.",
                "ambiguity": {"extraction": 1.0 - best.ocr_confidence, "semantic": sem_amb, "conflict": 0.0},
            }

        op = str(criterion.get("operator", "=="))
        target = float(criterion.get("value") or 0)
        passes = eval_operator(best.normalized_value, op, target)

        if conf < 0.75 or sem_amb > 0.4:
            return {
                "criterion_id": crit_id, "bidder_id": bidder_id,
                "verdict": "NEEDS_REVIEW", "reason": "LOW_CONFIDENCE",
                "confidence": conf, "evidence_used": [best.id],
                "reviewer_required": True,
                "reasoning": f"{op} {target}; extracted {best.normalized_value} but confidence/ambiguity requires review.",
                "ambiguity": {"extraction": max(0, 0.9 - best.extraction_confidence), "semantic": sem_amb, "conflict": 0.0},
            }

        verdict = "ELIGIBLE" if passes else "NOT_ELIGIBLE"
        return {
            "criterion_id": crit_id, "bidder_id": bidder_id,
            "verdict": verdict, "reason": "", "confidence": conf,
            "evidence_used": [best.id], "evidence_conflicting": [],
            "reviewer_required": False,
            "reasoning": f"{criterion.get('field')} requires {op} {target}. Extracted {best.normalized_value} from {best.filename}.",
            "ambiguity": {"extraction": 0.05, "semantic": sem_amb, "conflict": 0.0},
            "evidence_snapshot": {
                "document": best.filename, "page": best.page,
                "bounding_box": best.bounding_box,
                "extracted_value": best.raw_text[:200],
                "normalized_value": best.normalized_value,
                "ocr_confidence": best.ocr_confidence,
            },
        }

    # Unknown fields: fall back to LLM
    res = call_llm_eval(criterion, bidder_id, documents)
    res["criterion_id"] = crit_id
    res["bidder_id"] = bidder_id
    return res


def build_graph(
    tender_id: str, criteria: list[dict[str, Any]], decisions: list[dict[str, Any]]
) -> dict[str, Any]:
    """Build a provenance graph linking criteria nodes to verdict nodes."""
    nodes: list[dict[str, Any]] = []
    edges: list[dict[str, Any]] = []
    for c in criteria:
        cid = str(c.get("id", ""))
        nodes.append({"id": f"c-{cid}", "type": "criterion", "label": _graph_criterion_label(c, cid)})
    for d in decisions:
        bid = str(d.get("bidder_id", ""))
        cid = str(d.get("criterion_id", ""))
        nid = f"v-{bid}-{cid}"
        nodes.append(
            {
                "id": nid,
                "type": "verdict",
                "label": str(d.get("verdict", "UNKNOWN")),
                "bidder_id": bid,
                "confidence": d.get("confidence"),
            }
        )
        edges.append({"from": f"c-{cid}", "to": nid, "label": "evaluates"})
    return {"tender_id": tender_id, "nodes": nodes, "edges": edges}


def run_evaluation(payload: dict[str, Any]) -> dict[str, Any]:
    tender_id = str(payload.get("tender_id", ""))
    criteria = list(payload.get("criteria") or [])
    bidders = list(payload.get("bidders") or [])

    decisions: list[dict[str, Any]] = []
    review_items: list[dict[str, Any]] = []

    for b in bidders:
        bid = str(b.get("bidder_id"))
        docs = list(b.get("documents") or [])
        for crit in criteria:
            d = evaluate_criterion(crit, bid, docs)
            d["tender_id"] = tender_id
            if d.get("verdict") == "NEEDS_REVIEW":
                review_items.append({
                    "tender_id": tender_id, "bidder_id": bid,
                    "criterion_id": d.get("criterion_id"),
                    "reason": d.get("reason"), "confidence": d.get("confidence"),
                })
            decisions.append(d)

    graph = build_graph(tender_id, criteria, decisions)
    return {"graph": graph, "decisions": decisions, "review_items": review_items}
