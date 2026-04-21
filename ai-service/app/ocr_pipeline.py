"""
Document processing: native PDF text via pdfplumber, then OpenCV preprocess +
PaddleOCR primary / Tesseract fallback when needed.
"""

from __future__ import annotations

import os
import re
from dataclasses import dataclass, field
from typing import Any

import cv2
import numpy as np
from PIL import Image


@dataclass
class OCRPage:
    page_no: int
    text: str
    boxes: list[dict[str, Any]] = field(default_factory=list)
    mean_confidence: float = 0.0


@dataclass
class OCRResult:
    text: str
    quality_score: float
    engine: str
    pages: list[OCRPage] = field(default_factory=list)


def _read_pdf_text(path: str) -> str:
    import pdfplumber

    chunks: list[str] = []
    with pdfplumber.open(path) as pdf:
        for i, page in enumerate(pdf.pages):
            t = page.extract_text() or ""
            if t.strip():
                chunks.append(t)
    return "\n".join(chunks)


def _deskew(gray: np.ndarray) -> np.ndarray:
    coords = np.column_stack(np.where(gray > 0))
    if coords.size < 10:
        return gray
    angle = cv2.minAreaRect(coords)[-1]
    if angle < -45:
        angle = 90 + angle
    elif angle > 45:
        angle = angle - 90
    h, w = gray.shape[:2]
    m = cv2.getRotationMatrix2D((w / 2, h / 2), angle, 1.0)
    return cv2.warpAffine(gray, m, (w, h), flags=cv2.INTER_CUBIC, borderMode=cv2.BORDER_REPLICATE)


def _preprocess(image: np.ndarray) -> np.ndarray:
    if len(image.shape) == 3:
        gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    else:
        gray = image
    gray = cv2.fastNlMeansDenoising(gray, None, 10, 7, 21)
    gray = _deskew(gray)
    clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8))
    return clahe.apply(gray)


def _paddle_ocr_image(path: str) -> tuple[str, float, list[dict[str, Any]]]:
    try:
        from paddleocr import PaddleOCR  # type: ignore
    except Exception:
        return "", 0.0, []

    ocr = PaddleOCR(use_angle_cls=True, lang="en", show_log=False)
    result = ocr.ocr(path, cls=True)
    lines: list[str] = []
    confs: list[float] = []
    boxes: list[dict[str, Any]] = []
    if not result or result[0] is None:
        return "", 0.0, []
    for line in result[0]:
        box, (txt, conf) = line[0], line[1]
        lines.append(txt)
        confs.append(float(conf))
        xs = [p[0] for p in box]
        ys = [p[1] for p in box]
        boxes.append(
            {
                "text": txt,
                "confidence": float(conf),
                "bounding_box": {
                    "x": min(xs),
                    "y": min(ys),
                    "w": max(xs) - min(xs),
                    "h": max(ys) - min(ys),
                },
            }
        )
    text = "\n".join(lines)
    mean_conf = sum(confs) / len(confs) if confs else 0.0
    return text, mean_conf, boxes


def _tesseract_image(path: str) -> tuple[str, float]:
    import pytesseract

    im = cv2.imread(path)
    if im is None:
        return "", 0.0
    gray = _preprocess(im)
    prep_path = path + ".prep.png"
    cv2.imwrite(prep_path, gray)
    try:
        data = pytesseract.image_to_data(Image.open(prep_path), output_type=pytesseract.Output.DICT)
    except Exception:
        return "", 0.0
    finally:
        if os.path.exists(prep_path):
            os.remove(prep_path)
    texts = [t for t in data["text"] if t and str(t).strip()]
    confs = [int(c) for c in data["conf"] if c not in ("-1", -1)]
    mean = sum(confs) / len(confs) / 100.0 if confs else 0.5
    return " ".join(texts), mean


def process_path(path: str, document_id: str = "") -> OCRResult:
    """Main entry: PDF text extraction, or image OCR."""
    ext = os.path.splitext(path)[1].lower()
    if ext == ".pdf":
        txt = _read_pdf_text(path)
        if len(txt.strip()) > 50:
            return OCRResult(
                text=txt,
                quality_score=0.95,
                engine="pdfplumber",
                pages=[OCRPage(page_no=1, text=txt, mean_confidence=0.95)],
            )

    if ext in (".png", ".jpg", ".jpeg", ".tif", ".tiff", ".bmp", ".webp"):
        pt, conf, boxes = _paddle_ocr_image(path)
        engine = "paddleocr"
        if not pt.strip():
            pt, conf = _tesseract_image(path)
            engine = "tesseract"
            boxes = []
        qual = min(0.99, max(0.3, conf))
        return OCRResult(
            text=pt,
            quality_score=qual,
            engine=engine,
            pages=[OCRPage(page_no=1, text=pt, boxes=boxes, mean_confidence=conf)],
        )

    # Fallback: try pdf as image rasterization not implemented — return stub
    if ext == ".pdf":
        return OCRResult(text="", quality_score=0.2, engine="none", pages=[])

    return OCRResult(text="", quality_score=0.0, engine="none", pages=[])


def redact_noise(text: str) -> str:
    """Light cleanup for common OCR confusions (O vs 0) in numeric contexts."""
    def fix_num(match: re.Match) -> str:
        s = match.group(0)
        return s.replace("O", "0").replace("o", "0")

    return re.sub(r"(?<=[\d₹,\s])(?:[\dO,o]{1,3}[,\s]?)+(?=[\d\s]|$)", fix_num, text)
