"""
PaddleOCR sidecar. A separate Python process because PaddleOCR has no usable
Node.js binding — the worker (apps/worker) calls this over HTTP instead of
running OCR in-process.

CPU-only by design (see project's SHAP/pgvector precedent for why: GPU
inference inside a shared small-team deployment adds an operational dependency
— CUDA drivers, device passthrough into Docker — that this stack deliberately
avoids at this scale).
"""
import logging
import os
import tempfile

import fitz  # PyMuPDF — rasterizes PDF pages; paddleocr 2.9.1 does not ship it
import numpy as np
from fastapi import FastAPI, File, HTTPException, UploadFile
from paddleocr import PaddleOCR

app = FastAPI(title="ocr-sidecar")
log = logging.getLogger("ocr-sidecar")

# 2x zoom (~144 dpi) is the usual accuracy/speed sweet spot for scanned pages.
PDF_ZOOM = float(os.environ.get("OCR_PDF_ZOOM", "2"))
MAX_PDF_PAGES = int(os.environ.get("OCR_MAX_PDF_PAGES", "100"))

# Loaded once at startup, not per-request — model load is the slow part.
ocr = PaddleOCR(use_angle_cls=True, lang=os.environ.get("OCR_LANG", "en"), show_log=False)


@app.get("/health")
def health():
    return {"status": "ok"}


@app.post("/ocr")
async def run_ocr(file: UploadFile = File(...)):
    data = await file.read()
    if not data:
        raise HTTPException(status_code=400, detail="Empty file")

    suffix = os.path.splitext(file.filename or "")[1] or ".pdf"
    with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tmp:
        tmp.write(data)
        tmp_path = tmp.name

    try:
        pages = []
        if suffix.lower() == ".pdf":
            # Rasterize ourselves instead of relying on PaddleOCR's implicit PDF path,
            # which needs PyMuPDF and failed with an opaque 500 when it was missing.
            with fitz.open(tmp_path) as pdf:
                if pdf.page_count > MAX_PDF_PAGES:
                    raise HTTPException(status_code=413, detail=f"PDF has {pdf.page_count} pages (max {MAX_PDF_PAGES})")
                for page_index, page in enumerate(pdf):
                    pix = page.get_pixmap(matrix=fitz.Matrix(PDF_ZOOM, PDF_ZOOM), alpha=False)
                    img = np.frombuffer(pix.samples, dtype=np.uint8).reshape(pix.height, pix.width, pix.n)
                    # PaddleOCR expects BGR; PyMuPDF gives RGB.
                    page_result = ocr.ocr(img[:, :, ::-1].copy(), cls=True)
                    lines = [line[1][0] for line in (page_result[0] or [])] if page_result else []
                    pages.append({"number": page_index + 1, "text": "\n".join(lines)})
        else:
            # Plain image: a single page. Result shape: list of per-page results,
            # each a list of [box, (text, confidence)] lines.
            result = ocr.ocr(tmp_path, cls=True)
            for page_index, page_result in enumerate(result or []):
                lines = [line[1][0] for line in (page_result or [])]
                pages.append({"number": page_index + 1, "text": "\n".join(lines)})

        text = "\n\n".join(p["text"] for p in pages)
        return {"text": text, "pages": pages}
    except HTTPException:
        raise
    except Exception as exc:
        # Surface the real cause in the logs and in the error the worker records.
        log.exception("OCR failed for %s", file.filename)
        raise HTTPException(status_code=422, detail=f"OCR failed: {type(exc).__name__}: {exc}")
    finally:
        os.unlink(tmp_path)
