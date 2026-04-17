import os

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from app.criteria_extractor import extract_criteria_llm
from app.decision_engine import run_evaluation
from app.ocr_pipeline import OCRResult, process_path

app = FastAPI(title="TenderSense AI", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class ProcessDocReq(BaseModel):
    path: str
    document_id: str = ""


class ExtractCriteriaReq(BaseModel):
    text: str
    tender_id: str = ""


class EvaluateReq(BaseModel):
    tender_id: str
    criteria: list[dict] = Field(default_factory=list)
    bidders: list[dict] = Field(default_factory=list)


@app.get("/health")
def health():
    return {"status": "ok", "service": "tendersense-ai"}


@app.post("/v1/process-document")
def process_document(req: ProcessDocReq) -> dict:
    if not os.path.isfile(req.path):
        return {"text": "", "quality_score": 0.0, "engine": "missing_file", "pages": [], "error": "file not found"}
    r: OCRResult = process_path(req.path, req.document_id)
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


@app.post("/v1/extract-criteria")
def extract_criteria(req: ExtractCriteriaReq) -> dict:
    criteria = extract_criteria_llm(req.text or "")
    return {"criteria": criteria, "tender_id": req.tender_id}


@app.post("/v1/evaluate")
def evaluate(req: EvaluateReq) -> dict:
    return run_evaluation(req.model_dump())


if __name__ == "__main__":
    import uvicorn

    port = int(os.getenv("PORT", "8081"))
    uvicorn.run("main:app", host="0.0.0.0", port=port, reload=False)
