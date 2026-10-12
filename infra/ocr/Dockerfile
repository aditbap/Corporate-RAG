# CPU-only PaddleOCR sidecar. Image is large (paddlepaddle ships prebuilt
# numerics libs) and the first `docker compose up` will take a while to both
# build this and have PaddleOCR download its detection/recognition models on
# first request — that's normal, not a hang.
FROM python:3.11-slim

# libgl1/libglib2.0-0: required by opencv-python-headless, a paddleocr dependency
RUN apt-get update && apt-get install -y --no-install-recommends \
    libgl1 \
    libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY app.py .

EXPOSE 8000
CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8000"]
