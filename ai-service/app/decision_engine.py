"""
Confidence-weighted criterion evaluation, conflict detection, cross-document checks,
and reasoning graph construction.
"""

from __future__ import annotations

import hashlib
import json
import re
import uuid
from dataclasses import dataclass, field
from typing import Any


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


def extract_bool_signals(text: str, field: str) -> tuple[float, float]:
    t = text.lower()
    if field == "gst_registration":
        if re.search(r"\b\d{2}[a-z]{5}\d{4}[a-z][a-z0-9]\b", t, re.I):
            return 1.0, 0.92
        if "gst" in t and "registration" in t:
            return 1.0, 0.8
        return 0.0, 0.5
    if field == "iso_9001":
        if "iso" in t and "9001" in t:
            return 1.0, 0.85
        return 0.0, 0.6
    if field == "generic_compliance":
        if len(t) > 80 and ("certif" in t or "undertaking" in t or "compliance" in t):
            return 1.0, 0.55
        return 0.0, 0.45
    return 0.0, 0.4


def extract_count(text: str, field: str) -> tuple[float, float]:
    if field != "similar_projects_count":
        return 0.0, 0.3
    nums = [int(x) for x in re.findall(r"(\d+)\s*(?:similar|projects?|works?)", text, re.I)]
    if nums:
        return float(max(nums)), 0.72
    nums2 = [int(x) for x in re.findall(r"\b(\d+)\s+projects?\b", text, re.I)]
    if nums2:
        return float(max(nums2)), 0.65
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
        text = ocr.get("text") or ""
        ocr_c = float(ocr.get("quality_score") or ocr.get("mean_confidence") or 0.75)
        doc_id = str(doc.get("id", ""))
        fname = str(doc.get("filename", ""))
        dtype = str(doc.get("doc_type", "supporting"))

        if field_name == "annual_turnover":
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
        elif field_name in ("gst_registration", "iso_9001", "generic_compliance"):
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
        elif field_name == "similar_projects_count":
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


def evaluate_criterion(criterion: dict[str, Any], bidder_id: str, documents: list[dict[str, Any]]) -> dict[str, Any]:
    evs = gather_evidence(criterion, bidder_id, documents)
    cross_doc_validate(evs)

    crit_id = str(criterion.get("id", ""))
    priority = list(criterion.get("source_priority") or ["supporting"])
    sem_amb = float(criterion.get("semantic_ambiguity_score") or 0)

    if not evs:
        return {
            "criterion_id": crit_id,
            "bidder_id": bidder_id,
            "verdict": "NEEDS_REVIEW",
            "reason": "NO_EVIDENCE",
            "confidence": 0.0,
            "evidence_used": [],
            "evidence_conflicting": [],
            "reviewer_required": True,
            "reasoning": "No evidence extracted for this criterion.",
            "ambiguity": {"extraction": 1.0, "semantic": sem_amb, "conflict": 0.0},
        }

    if any(e.conflicts_with for e in evs):
        ids = [e.id for e in evs]
        return {
            "criterion_id": crit_id,
            "bidder_id": bidder_id,
            "verdict": "NEEDS_REVIEW",
            "reason": "CONFLICT_DETECTED",
            "confidence": 0.51,
            "evidence_used": ids[:1],
            "evidence_conflicting": ids,
            "reviewer_required": True,
            "reasoning": "Conflicting values detected across documents for the same field.",
            "ambiguity": {"extraction": 0.0, "semantic": sem_amb, "conflict": 1.0},
        }

    best = select_best_evidence(evs, priority)
    assert best is not None

    if best.ocr_confidence < 0.85:
        return {
            "criterion_id": crit_id,
            "bidder_id": bidder_id,
            "verdict": "NEEDS_REVIEW",
            "reason": "LOW_OCR_CONFIDENCE",
            "confidence": best.ocr_confidence,
            "evidence_used": [best.id],
            "evidence_conflicting": [],
            "reviewer_required": True,
            "reasoning": "OCR confidence below threshold for critical evidence.",
            "ambiguity": {"extraction": 1.0 - best.ocr_confidence, "semantic": sem_amb, "conflict": 0.0},
        }

    spi = source_priority_index(best.doc_type, priority)
    cp = 1.0 if best.conflicts_with else 0.0
    conf = overall_confidence(best.ocr_confidence, best.extraction_confidence, spi, cp)

    op = str(criterion.get("operator", "=="))
    target = float(criterion.get("value") or 0)
    passes = eval_operator(best.normalized_value, op, target)

    if conf < 0.75 or sem_amb > 0.4:
        return {
            "criterion_id": crit_id,
            "bidder_id": bidder_id,
            "verdict": "NEEDS_REVIEW",
            "reason": "LOW_CONFIDENCE",
            "confidence": conf,
            "evidence_used": [best.id],
            "evidence_conflicting": [],
            "reviewer_required": True,
            "reasoning": f"Operator {op} against {target}; extracted {best.normalized_value} but confidence or ambiguity requires review.",
            "ambiguity": {
                "extraction": max(0, 0.9 - best.extraction_confidence),
                "semantic": sem_amb,
                "conflict": 0.0,
            },
        }

    verdict = "ELIGIBLE" if passes else "NOT_ELIGIBLE"
    return {
        "criterion_id": crit_id,
        "bidder_id": bidder_id,
        "verdict": verdict,
        "reason": "",
        "confidence": conf,
        "evidence_used": [best.id],
        "evidence_conflicting": [],
        "reviewer_required": False,
        "reasoning": f"Criterion {criterion.get('field')} requires {op} {target}. Extracted {best.normalized_value} from {best.filename}.",
        "ambiguity": {"extraction": 0.05, "semantic": sem_amb, "conflict": 0.0},
        "evidence_snapshot": {
            "document": best.filename,
            "page": best.page,
            "bounding_box": best.bounding_box,
            "extracted_value": best.raw_text[:200],
            "normalized_value": best.normalized_value,
            "ocr_confidence": best.ocr_confidence,
        },
    }


def build_graph(
    tender_id: str, criteria: list[dict[str, Any]], decisions: list[dict[str, Any]]
) -> dict[str, Any]:
    nodes: list[dict[str, Any]] = []
    edges: list[dict[str, Any]] = []
    for c in criteria:
        cid = str(c.get("id"))
        nodes.append({"id": f"c-{cid}", "type": "criterion", "label": c.get("text_raw", cid)[:80]})
    for d in decisions:
        bid = str(d.get("bidder_id"))
        cid = str(d.get("criterion_id"))
        nid = f"v-{bid}-{cid}"
        nodes.append(
            {
                "id": nid,
                "type": "verdict",
                "label": str(d.get("verdict")),
                "bidder_id": bid,
                "confidence": d.get("confidence"),
            }
        )
        edges.append({"from": f"c-{cid}", "to": nid, "label": "evaluates"})
    return {"tender_id": tender_id, "nodes": nodes, "edges": edges}


def decision_checksum(payload: dict[str, Any]) -> str:
    body = json.dumps(payload, sort_keys=True).encode()
    return "sha256:" + hashlib.sha256(body).hexdigest()


def flatten_decision_record(
    tender_id: str, d: dict[str, Any], evidence: dict[str, Any] | None
) -> dict[str, Any]:
    rid = f"dec_{tender_id}_{d.get('bidder_id')}_{d.get('criterion_id')}"
    chain = []
    if evidence:
        chain.append(evidence)
    rec = {
        "decision_id": rid,
        "tender_id": tender_id,
        "bidder_id": d.get("bidder_id"),
        "criterion_id": d.get("criterion_id"),
        "verdict": d.get("verdict"),
        "confidence": d.get("confidence"),
        "evidence_chain": chain,
        "reasoning": d.get("reasoning"),
        "reviewer_override": None,
    }
    rec["checksum"] = decision_checksum({k: v for k, v in rec.items() if k != "checksum"})
    return rec


def run_evaluation(payload: dict[str, Any]) -> dict[str, Any]:
    tender_id = str(payload.get("tender_id", ""))
    criteria: list[dict[str, Any]] = list(payload.get("criteria") or [])
    bidders: list[dict[str, Any]] = list(payload.get("bidders") or [])

    decisions: list[dict[str, Any]] = []
    review_items: list[dict[str, Any]] = []

    for b in bidders:
        bid = str(b.get("bidder_id"))
        docs = list(b.get("documents") or [])
        for crit in criteria:
            d = evaluate_criterion(crit, bid, docs)
            d["tender_id"] = tender_id
            if d.get("verdict") == "NEEDS_REVIEW":
                review_items.append(
                    {
                        "tender_id": tender_id,
                        "bidder_id": bid,
                        "criterion_id": d.get("criterion_id"),
                        "reason": d.get("reason"),
                        "confidence": d.get("confidence"),
                    }
                )
            decisions.append(d)

    graph = build_graph(tender_id, criteria, decisions)
    return {"graph": graph, "decisions": decisions, "review_items": review_items}
