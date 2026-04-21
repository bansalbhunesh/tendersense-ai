"""TenderSense AI Service — FastAPI entry point."""

import logging
import os

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

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

# ---------------------------------------------------------------------------
# App
# ---------------------------------------------------------------------------
app = FastAPI(title="TenderSense AI", version="0.2.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=_split_origins(os.getenv("ALLOWED_ORIGINS", "*")),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

DATA_DIR = os.path.abspath(os.getenv("DATA_DIR", "/app/data/uploads"))

_MAX_PROCESS_CHARS = int(os.getenv("MAX_PROCESS_TEXT_CHARS", "500000"))
_MAX_CRITERIA_CHARS = int(os.getenv("MAX_CRITERIA_TEXT_CHARS", "400000"))
_MAX_EVAL_CRITERIA = int(os.getenv("MAX_EVAL_CRITERIA", "200"))
_MAX_EVAL_BIDDERS = int(os.getenv("MAX_EVAL_BIDDERS", "100"))


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
def validate_path(path: str) -> str:
    """Resolve path and ensure it is under DATA_DIR (prefix-safe). Raises HTTPException on violation."""
    data_root = os.path.realpath(DATA_DIR)
    resolved = os.path.realpath(path)
    try:
        common = os.path.commonpath((data_root, resolved))
    except ValueError:
        raise HTTPException(status_code=403, detail="Access denied: invalid path")
    if common != data_root:
        raise HTTPException(
            status_code=403,
            detail=f"Access denied: path must be under {data_root}",
        )
    return resolved


def _split_origins(raw: str) -> list[str]:
    parts = [x.strip() for x in raw.split(",") if x.strip()]
    return parts if parts else ["*"]


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
    logger.info("Processing document %s at %s", req.document_id, req.path)

    try:
        safe_path = validate_path(req.path)
    except HTTPException:
        logger.warning("Path validation failed: %s", req.path)
        return {"error": "invalid path", "text": "", "quality_score": 0.0}

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
        return {
            "text": r.text,
            "quality_score": r.quality_score,
            "engine": r.engine,
            "pages": pages_out,
            "document_id": req.document_id,
        }
    except Exception:
        logger.exception("OCR processing failed for %s", req.document_id)
        return {"error": "ocr_failed", "text": "", "quality_score": 0.0}


@app.post("/v1/extract-criteria")
def extract_criteria(req: ExtractCriteriaReq) -> dict:
    logger.info("Extracting criteria for tender %s (%d chars)", req.tender_id, len(req.text or ""))
    try:
        criteria = extract_criteria_llm(req.text or "")
        return {"criteria": criteria, "tender_id": req.tender_id}
    except Exception:
        logger.exception("Criteria extraction failed")
        return {"criteria": [], "tender_id": req.tender_id, "error": "extraction_failed"}


@app.post("/v1/evaluate")
def evaluate(req: EvaluateReq) -> dict:
    logger.info(
        "Evaluating tender %s: %d criteria × %d bidders",
        req.tender_id,
        len(req.criteria),
        len(req.bidders),
    )
    try:
        return run_evaluation(req.model_dump())
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
