# --- build the React screen ---------------------------------------------------
FROM node:22-alpine AS client
# Set by the GitHub build (e.g. 0.1.0.7); shown in the ☰ menu and /api/health.
ARG APP_VERSION=dev
ENV APP_VERSION=$APP_VERSION
WORKDIR /client
COPY client/package.json client/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY client/ ./
RUN npm run build

# --- runtime: FastAPI + PyMuPDF, serving the built screen ----------------------
FROM python:3.13-slim
ARG APP_VERSION=dev
ENV APP_VERSION=$APP_VERSION \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    STATIC_DIR=/app/static
# Tesseract lets export read scanned pages (OCR).
RUN apt-get update \
 && apt-get install -y --no-install-recommends tesseract-ocr tesseract-ocr-eng \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY server/requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt
COPY server/app ./app
COPY --from=client /client/dist ./static
RUN useradd --system --uid 10001 pdfedit
USER 10001
EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--proxy-headers", "--forwarded-allow-ips", "*"]
