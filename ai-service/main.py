"""TenderSense AI Service — FastAPI entry point."""

import json
import logging
import os
import tempfile

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from app.cache import cache_get_json, cache_set_json, stable_hash_key
from app.criteria_extractor import extract_criteria as extract_criteria_lang_aware
from app.decision_engine import run_evaluation
from app.ocr_pipeline import OCRResult, process_path
from app.pii import install_redaction
from app.translation import (
    _devanagari_ratio,
    detect_language,
    get_translator,
    translate_in_chunks,
)

# ---------------------------------------------------------------------------
# Logging — PII redaction filter is attached to the root logger so every
# emission (incl. uvicorn / fastapi / httpx) is sanitised before stdout.
# ---------------------------------------------------------------------------
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
install_redaction(logging.getLogger())
logger = logging.getLogger("tendersense-ai")


def parse_allowed_origins(raw: str | None = None) -> list[str]:
    """Return a non-empty origin list. Never defaults to wildcard — misconfigured empty CSV must not open CORS."""
    r = (raw if raw is not None else os.getenv("ALLOWED_ORIGINS") or "").strip()
    if not r:
        r = "http://localhost:5173"
    parts = [x.strip() for x in r.split(",") if x.strip()]
    if not parts:
        raise RuntimeError(
            "ALLOWED_ORIGINS must list at least one non-empty origin (comma-separated). "
            "Wildcard CORS is not allowed."
        )
    return parts


_MAX_PROCESS_CHARS = int(os.getenv("MAX_PROCESS_TEXT_CHARS", "500000"))
_MAX_CRITERIA_CHARS = int(os.getenv("MAX_CRITERIA_TEXT_CHARS", "400000"))
_MAX_EVAL_CRITERIA = int(os.getenv("MAX_EVAL_CRITERIA", "200"))
_MAX_EVAL_BIDDERS = int(os.getenv("MAX_EVAL_BIDDERS", "100"))

DATA_DIR = os.path.abspath(os.getenv("DATA_DIR", "/app/data/uploads"))


def _require_env(name: str) -> str:
    val = (os.getenv(name) or "").strip()
    if not val:
        raise RuntimeError(f"missing required environment variable: {name}")
    return val


def _log_event(event: str, **fields: object) -> None:
    try:
        payload = json.dumps({"event": event, **fields}, default=str)
    except (TypeError, ValueError):
        payload = json.dumps({"event": event, "msg": "log_serialize_failed"})
    logger.info("%s", payload)


def validate_path(path: str) -> str:
    """Resolve path under DATA_DIR. Supports absolute paths and backend-relative paths
    (e.g. data/uploads/...). Rejects any input whose normalised form attempts to escape
    via ``..`` segments — even if the basename happens to exist under DATA_DIR."""
    data_root = os.path.realpath(DATA_DIR)
    raw = (path or "").strip()
    if not raw:
        raise HTTPException(status_code=403, detail="Access denied: empty path")

    # Refuse explicit traversal attempts up-front. Without this, a basename-fallback
    # candidate would silently redirect ``../../etc/passwd`` to ``DATA_DIR/passwd``.
    if ".." in raw.replace("\\", "/").split("/"):
        raise HTTPException(
            status_code=403,
            detail="Access denied: path traversal not allowed",
        )

    candidates: list[str] = []
    if os.path.isabs(raw):
        candidates.append(raw)
    else:
        norm = os.path.normpath(raw)
        # If normalisation reveals a traversal we missed, also reject.
        if norm.startswith("..") or norm == "..":
            raise HTTPException(
                status_code=403,
                detail="Access denied: path traversal not allowed",
            )
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
    allow_origins=parse_allowed_origins(),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
def startup_validate_env() -> None:
    _require_env("DATA_DIR")
    _require_env("ALLOWED_ORIGINS")
    _ = parse_allowed_origins()
    _log_event("startup_ok", data_dir=DATA_DIR)


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


class DetectLanguageReq(BaseModel):
    text: str = Field(default="", max_length=_MAX_CRITERIA_CHARS)


class TranslateReq(BaseModel):
    text: str = Field(default="", max_length=_MAX_CRITERIA_CHARS)
    src: str = Field(default="hi", max_length=8)
    tgt: str = Field(default="en", max_length=8)


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------
@app.get("/health")
def health():
    return {"status": "ok", "service": "tendersense-ai"}


def _active_llm_backend() -> str:
    return (os.getenv("LLM_BACKEND") or "anthropic").strip().lower()


def _active_translation_backend() -> str:
    return (os.getenv("TRANSLATION_BACKEND") or "disabled").strip().lower()


@app.get("/v1/version")
def version():
    return {
        "version": "0.2.0",
        "git_sha": os.getenv("GIT_SHA", ""),
        "llm_backend": _active_llm_backend(),
        "translation_backend": _active_translation_backend(),
    }


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

    cache_fp = ""
    if os.path.isfile(safe_path):
        try:
            st = os.stat(safe_path)
            cache_fp = f"{st.st_mtime_ns}:{st.st_size}"
        except OSError:
            pass
    cache_key = stable_hash_key("ocr:v1", req.path, req.document_id or "", cache_fp)
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


@app.post("/v1/process-document-upload")
async def process_document_upload(
    file: UploadFile = File(...),
    document_id: str = Form(default=""),
) -> dict:
    """OCR an uploaded file without shared filesystem paths (for split backend/AI deploys)."""
    suffix = os.path.splitext(file.filename or "")[1] or ".bin"
    tmp_path = ""
    try:
        raw = await file.read()
        max_b = int(os.getenv("MAX_UPLOAD_BYTES", str(55 * 1024 * 1024)))
        if len(raw) > max_b:
            _log_event("process_document_upload_rejected", reason="too_large", bytes=len(raw))
            return {"error": "file_too_large", "text": "", "quality_score": 0.0, "pages": []}
        with tempfile.NamedTemporaryFile(
            delete=False,
            suffix=suffix,
            dir=tempfile.gettempdir(),
        ) as tmp:
            tmp.write(raw)
            tmp_path = tmp.name
        _log_event(
            "process_document_upload_start",
            document_id=document_id,
            bytes=len(raw),
        )
        try:
            r: OCRResult = process_path(tmp_path, document_id)
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
                "document_id": document_id,
            }
            _log_event(
                "process_document_upload_ok",
                document_id=document_id,
                pages=len(pages_out),
                quality=r.quality_score,
            )
            return out
        except Exception:
            logger.exception("OCR processing failed for uploaded %s", document_id)
            return {"error": "ocr_failed", "text": "", "quality_score": 0.0, "pages": []}
    finally:
        if tmp_path:
            try:
                os.remove(tmp_path)
            except OSError:
                pass


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
        result = extract_criteria_lang_aware(text)
        criteria = result.get("criteria") or []
        out: dict = {"criteria": criteria, "tender_id": req.tender_id}
        # Surface additive language metadata so clients can render bilingual UI.
        if "source_text_lang" in result:
            out["source_text_lang"] = result["source_text_lang"]
        if "extraction_warning" in result:
            out["extraction_warning"] = result["extraction_warning"]
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
        cache_key = stable_hash_key(
            "evaluate:v2",
            req.tender_id,
            req.criteria,
            [
                {
                    "bidder_id": b.get("bidder_id"),
                    "documents": [
                        {
                            "id": d.get("id"),
                            "doc_type": d.get("doc_type"),
                            "filename": d.get("filename"),
                        }
                        for d in (b.get("documents") or [])
                    ],
                }
                for b in req.bidders
            ],
        )
        if cached := cache_get_json(cache_key):
            _log_event("evaluate_cache_hit", tender_id=req.tender_id)
            return cached
        result = run_evaluation(req.model_dump())
        cache_set_json(
            cache_key,
            result,
            ttl_seconds=int(os.getenv("EVALUATE_CACHE_TTL_SECONDS", "900")),
        )
        decisions = result.get("decisions") if isinstance(result, dict) else None
        n = len(decisions) if isinstance(decisions, list) else 0
        _log_event("evaluate_ok", tender_id=req.tender_id, decisions=n)
        return result
    except Exception:
        logger.exception("Evaluation failed for tender %s", req.tender_id)
        raise HTTPException(status_code=500, detail="evaluation engine error")


@app.post("/v1/detect-language")
def detect_language_endpoint(req: DetectLanguageReq) -> dict:
    text = req.text or ""
    lang = detect_language(text)
    ratio = _devanagari_ratio(text)
    # Confidence is the distance from the decision boundary, clamped [0, 1].
    if lang == "hi":
        confidence = min(1.0, (ratio - 0.3) / 0.7 + 0.5) if ratio > 0.3 else 0.5
    elif lang == "en":
        confidence = min(1.0, (0.05 - ratio) / 0.05 + 0.5) if ratio < 0.05 else 0.5
    else:
        confidence = 0.5
    return {
        "lang": lang,
        "confidence": round(confidence, 3),
        "devanagari_ratio": round(ratio, 4),
    }


@app.post("/v1/translate")
def translate_endpoint(req: TranslateReq) -> dict:
    backend_name = _active_translation_backend()
    if backend_name == "disabled":
        raise HTTPException(status_code=503, detail="translation backend disabled")
    try:
        translator = get_translator()
    except Exception as e:
        logger.warning("translator construction failed: %s", e)
        raise HTTPException(status_code=503, detail="translation backend unavailable")
    if getattr(translator, "name", "disabled") == "disabled":
        # Backend was requested but env was incomplete; factory degraded silently.
        raise HTTPException(status_code=503, detail="translation backend unconfigured")
    try:
        translated = translate_in_chunks(translator, req.text or "", req.src, req.tgt)
    except Exception as e:
        logger.exception("translation failed: %s", e)
        raise HTTPException(status_code=502, detail="translation failed")
    return {"translated": translated, "backend": getattr(translator, "name", backend_name)}


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------
if __name__ == "__main__":
    import uvicorn

    port = int(os.getenv("PORT", "8081"))
    uvicorn.run("main:app", host="0.0.0.0", port=port, reload=False)
