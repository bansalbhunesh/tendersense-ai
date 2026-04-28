"""
Document processing: native PDF text via pdfplumber, then OpenCV preprocess +
PaddleOCR primary / Tesseract fallback when needed.
"""

from __future__ import annotations

import os
import re
import tempfile
from dataclasses import dataclass, field
from typing import Any

import cv2
import numpy as np
import pdfplumber
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
    if abs(angle) < 0.5:
        return gray
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


def _ocr_langs() -> str:
    """Tesseract language string. Default: ``eng``. For Hindi, set ``eng+hin``."""
    return os.getenv("OCR_LANGS", "eng")


def _paddle_run(path: str, lang_code: str) -> tuple[list[str], list[float], list[dict[str, Any]]]:
    """Run a single PaddleOCR pass and return (lines, confs, boxes). Empty on failure."""
    try:
        from paddleocr import PaddleOCR  # type: ignore
    except Exception:
        return [], [], []
    try:
        ocr = PaddleOCR(use_angle_cls=True, lang=lang_code, show_log=False)
        result = ocr.ocr(path, cls=True)
    except Exception:
        return [], [], []
    lines: list[str] = []
    confs: list[float] = []
    boxes: list[dict[str, Any]] = []
    if not result or result[0] is None:
        return [], [], []
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
    return lines, confs, boxes


def _paddle_ocr_image(path: str) -> tuple[str, float, list[dict[str, Any]]]:
    """Run PaddleOCR. If OCR_LANGS contains ``hin``, run a second Hindi pass and
    concat results — PaddleOCR ships separate models per language."""
    langs = _ocr_langs().lower()
    primary_lang = "en"
    lines, confs, boxes = _paddle_run(path, primary_lang)
    if "hin" in langs:
        h_lines, h_confs, h_boxes = _paddle_run(path, "hi")
        lines.extend(h_lines)
        confs.extend(h_confs)
        boxes.extend(h_boxes)
    if not lines:
        return "", 0.0, []
    text = "\n".join(lines)
    mean_conf = sum(confs) / len(confs) if confs else 0.0
    return text, mean_conf, boxes


def _tesseract_image(path: str, preprocessed: bool = False) -> tuple[str, float]:
    import pytesseract

    im = cv2.imread(path)
    if im is None:
        return "", 0.0
    gray = im if preprocessed else _preprocess(im)
    fd, prep_path = tempfile.mkstemp(suffix=".prep.png")
    os.close(fd)
    cv2.imwrite(prep_path, gray)
    try:
        data = pytesseract.image_to_data(
            Image.open(prep_path),
            lang=_ocr_langs(),
            output_type=pytesseract.Output.DICT,
        )
    except Exception:
        return "", 0.0
    finally:
        if os.path.exists(prep_path):
            os.remove(prep_path)
    texts = [t for t in data["text"] if t and str(t).strip()]
    confs = [int(c) for c in data["conf"] if c not in ("-1", -1)]
    mean = sum(confs) / len(confs) / 100.0 if confs else 0.5
    return redact_noise(" ".join(texts)), mean


def _ocr_scanned_pdf(path: str) -> OCRResult:
    """OCR each PDF page as image when native text extraction is empty."""
    max_pages = int(os.getenv("OCR_MAX_PDF_PAGES", "40"))
    pages: list[OCRPage] = []
    all_text: list[str] = []
    confs: list[float] = []
    with pdfplumber.open(path) as pdf:
        for i, page in enumerate(pdf.pages[:max_pages], start=1):
            try:
                pil = page.to_image(resolution=200).original.convert("RGB")
                arr = np.array(pil)
                bgr = cv2.cvtColor(arr, cv2.COLOR_RGB2BGR)
            except Exception:
                continue
            with tempfile.NamedTemporaryFile(suffix=".prep.png", delete=False) as tf2:
                prep_tmp_path = tf2.name
            try:
                prep = _preprocess(bgr)
                cv2.imwrite(prep_tmp_path, prep)
                pt, conf, boxes = _paddle_ocr_image(prep_tmp_path)
                engine = "paddleocr"
                if not pt.strip():
                    pt, conf = _tesseract_image(prep_tmp_path, preprocessed=True)
                    boxes = []
                    engine = "tesseract"
                pt = redact_noise(pt or "")
                pages.append(OCRPage(page_no=i, text=pt, boxes=boxes, mean_confidence=conf))
                if pt.strip():
                    all_text.append(pt)
                confs.append(conf if conf > 0 else 0.35)
            finally:
                if os.path.exists(prep_tmp_path):
                    os.remove(prep_tmp_path)
    text = "\n".join(x for x in all_text if x.strip())
    q = min(0.95, max(0.2, (sum(confs) / len(confs)) if confs else 0.2))
    return OCRResult(text=text, quality_score=q, engine="pdf_raster_ocr", pages=pages)


def process_path(path: str, document_id: str = "") -> OCRResult:
    """Main entry: PDF text extraction, or image OCR."""
    ext = os.path.splitext(path)[1].lower()
    if ext == ".pdf":
        txt = _read_pdf_text(path)
        if len(txt.strip()) > 50:
            return OCRResult(
                text=redact_noise(txt),
                quality_score=0.95,
                engine="pdfplumber",
                pages=[OCRPage(page_no=1, text=redact_noise(txt), mean_confidence=0.95)],
            )
        # Scanned PDF fallback: rasterize pages + OCR instead of silent empty text.
        return _ocr_scanned_pdf(path)

    if ext in (".png", ".jpg", ".jpeg", ".tif", ".tiff", ".bmp", ".webp"):
        pt, conf, boxes = _paddle_ocr_image(path)
        engine = "paddleocr"
        if not pt.strip():
            pt, conf = _tesseract_image(path)
            engine = "tesseract"
            boxes = []
        qual = min(0.99, max(0.3, conf))
        return OCRResult(
            text=redact_noise(pt),
            quality_score=qual,
            engine=engine,
            pages=[OCRPage(page_no=1, text=redact_noise(pt), boxes=boxes, mean_confidence=conf)],
        )

    return OCRResult(text="", quality_score=0.0, engine="none", pages=[])


def redact_noise(text: str) -> str:
    """Light cleanup for common OCR confusions (O vs 0) in numeric contexts."""
    def fix_num(match: re.Match) -> str:
        s = match.group(0)
        return s.replace("O", "0").replace("o", "0")

    return re.sub(r"(?<=[\d₹,\s])(?:[\dO,o]{1,3}[,\s]?)+(?=[\d\s]|$)", fix_num, text)
