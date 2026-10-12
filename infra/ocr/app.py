"""
PaddleOCR sidecar. A separate Python process because PaddleOCR has no usable
Node.js binding — the worker (apps/worker) calls this over HTTP instead of
running OCR in-process.

CPU-only by design (see project's SHAP/pgvector precedent for why: GPU
inference inside a shared small-team deployment adds an operational dependency
— CUDA drivers, device passthrough into Docker — that this stack deliberately
avoids at this scale).
"""
import os
import tempfile

from fastapi import FastAPI, File, HTTPException, UploadFile
from paddleocr import PaddleOCR

app = FastAPI(title="ocr-sidecar")

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
        # PaddleOCR rasterizes PDFs page-by-page internally; for a plain image
        # it's treated as a single page. Result shape: list of per-page results,
        # each a list of [box, (text, confidence)] lines.
        result = ocr.ocr(tmp_path, cls=True)

        pages = []
        for page_index, page_result in enumerate(result or []):
            lines = [line[1][0] for line in (page_result or [])]
            pages.append({"number": page_index + 1, "text": "\n".join(lines)})

        text = "\n\n".join(p["text"] for p in pages)
        return {"text": text, "pages": pages}
    finally:
        os.unlink(tmp_path)
