"""TenderSense AI Service — FastAPI entry point."""

import json
import logging
import os

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from app.cache import cache_get_json, cache_set_json, stable_hash_key
from app.criteria_extractor import extract_criteria_llm
from app.decision_engine import run_evaluation
from app.ocr_pipeline import OCRResult, process_path

# ---------------------------------------------------------------------------
# Logging
# ---------------------------------------------------------------------------
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger("tendersense-ai")


def _split_origins(raw: str) -> list[str]:
    parts = [x.strip() for x in raw.split(",") if x.strip()]
    return parts if parts else ["*"]


_MAX_PROCESS_CHARS = int(os.getenv("MAX_PROCESS_TEXT_CHARS", "500000"))
_MAX_CRITERIA_CHARS = int(os.getenv("MAX_CRITERIA_TEXT_CHARS", "400000"))
_MAX_EVAL_CRITERIA = int(os.getenv("MAX_EVAL_CRITERIA", "200"))
_MAX_EVAL_BIDDERS = int(os.getenv("MAX_EVAL_BIDDERS", "100"))

DATA_DIR = os.path.abspath(os.getenv("DATA_DIR", "/app/data/uploads"))


def _log_event(event: str, **fields: object) -> None:
    try:
        payload = json.dumps({"event": event, **fields}, default=str)
    except (TypeError, ValueError):
        payload = json.dumps({"event": event, "msg": "log_serialize_failed"})
    logger.info("%s", payload)


def validate_path(path: str) -> str:
    """Resolve path under DATA_DIR. Supports absolute paths and backend-relative paths (e.g. data/uploads/...)."""
    data_root = os.path.realpath(DATA_DIR)
    raw = (path or "").strip()
    if not raw:
        raise HTTPException(status_code=403, detail="Access denied: empty path")

    candidates: list[str] = []
    if os.path.isabs(raw):
        candidates.append(raw)
    else:
        norm = os.path.normpath(raw)
        candidates.append(os.path.join(data_root, norm))
        candidates.append(os.path.join(data_root, os.path.basename(norm)))
        candidates.append(os.path.realpath(raw))

    seen: set[str] = set()
    for cand in candidates:
        if cand in seen:
            continue
        seen.add(cand)
        try:
            resolved = os.path.realpath(cand)
        except OSError:
            continue
        try:
            common = os.path.commonpath((data_root, resolved))
        except ValueError:
            continue
        if common == data_root:
            return resolved

    raise HTTPException(
        status_code=403,
        detail=f"Access denied: path must resolve under {data_root}",
    )


# ---------------------------------------------------------------------------
# App (must be after helpers used in middleware)
# ---------------------------------------------------------------------------
app = FastAPI(title="TenderSense AI", version="0.2.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=_split_origins(os.getenv("ALLOWED_ORIGINS", "*")),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ---------------------------------------------------------------------------
# Models
# ---------------------------------------------------------------------------
class ProcessDocReq(BaseModel):
    path: str = Field(..., max_length=4096)
    document_id: str = Field(default="", max_length=128)


class ExtractCriteriaReq(BaseModel):
    text: str = Field(default="", max_length=_MAX_CRITERIA_CHARS)
    tender_id: str = Field(default="", max_length=128)


class EvaluateReq(BaseModel):
    tender_id: str = Field(..., max_length=128)
    criteria: list[dict] = Field(default_factory=list, max_length=_MAX_EVAL_CRITERIA)
    bidders: list[dict] = Field(default_factory=list, max_length=_MAX_EVAL_BIDDERS)


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------
@app.get("/health")
def health():
    return {"status": "ok", "service": "tendersense-ai"}


@app.post("/v1/process-document")
def process_document(req: ProcessDocReq) -> dict:
    _log_event(
        "process_document_start",
        document_id=req.document_id,
        path_len=len(req.path or ""),
    )

    try:
        safe_path = validate_path(req.path)
    except HTTPException:
        logger.warning("Path validation failed: %s", req.path)
        return {"error": "invalid path", "text": "", "quality_score": 0.0}

    cache_key = stable_hash_key("ocr:v1", req.path, req.document_id or "")
    if cached := cache_get_json(cache_key):
        _log_event("process_document_cache_hit", document_id=req.document_id)
        return cached

    if not os.path.isfile(safe_path):
        logger.warning("File not found: %s", safe_path)
        return {
            "text": "",
            "quality_score": 0.0,
            "engine": "missing_file",
            "pages": [],
            "error": "file not found",
        }

    try:
        r: OCRResult = process_path(safe_path, req.document_id)
        pages_out = [
            {
                "page": p.page_no,
                "text": p.text,
                "mean_confidence": p.mean_confidence,
                "boxes": p.boxes,
            }
            for p in r.pages
        ]
        out = {
            "text": r.text,
            "quality_score": r.quality_score,
            "engine": r.engine,
            "pages": pages_out,
            "document_id": req.document_id,
        }
        cache_set_json(cache_key, out, ttl_seconds=int(os.getenv("OCR_CACHE_TTL_SECONDS", "86400")))
        _log_event(
            "process_document_ok",
            document_id=req.document_id,
            pages=len(pages_out),
            quality=r.quality_score,
        )
        return out
    except Exception:
        logger.exception("OCR processing failed for %s", req.document_id)
        return {"error": "ocr_failed", "text": "", "quality_score": 0.0}


@app.post("/v1/extract-criteria")
def extract_criteria(req: ExtractCriteriaReq) -> dict:
    text = req.text or ""
    _log_event(
        "extract_criteria_start",
        tender_id=req.tender_id,
        char_count=len(text),
    )

    cache_key = stable_hash_key("criteria:v1", req.tender_id, text[:20000])
    if cached := cache_get_json(cache_key):
        _log_event("extract_criteria_cache_hit", tender_id=req.tender_id)
        return cached

    try:
        criteria = extract_criteria_llm(text)
        out = {"criteria": criteria, "tender_id": req.tender_id}
        cache_set_json(
            cache_key,
            out,
            ttl_seconds=int(os.getenv("CRITERIA_CACHE_TTL_SECONDS", "7200")),
        )
        _log_event("extract_criteria_ok", tender_id=req.tender_id, count=len(criteria))
        return out
    except Exception:
        logger.exception("Criteria extraction failed")
        return {"criteria": [], "tender_id": req.tender_id, "error": "extraction_failed"}


@app.post("/v1/evaluate")
def evaluate(req: EvaluateReq) -> dict:
    _log_event(
        "evaluate_start",
        tender_id=req.tender_id,
        criteria=len(req.criteria),
        bidders=len(req.bidders),
    )
    try:
        result = run_evaluation(req.model_dump())
        decisions = result.get("decisions") if isinstance(result, dict) else None
        n = len(decisions) if isinstance(decisions, list) else 0
        _log_event("evaluate_ok", tender_id=req.tender_id, decisions=n)
        return result
    except Exception:
        logger.exception("Evaluation failed for tender %s", req.tender_id)
        raise HTTPException(status_code=500, detail="evaluation engine error")


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------
if __name__ == "__main__":
    import uvicorn

    port = int(os.getenv("PORT", "8081"))
    uvicorn.run("main:app", host="0.0.0.0", port=port, reload=False)
