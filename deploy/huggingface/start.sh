#!/bin/sh
# Container entry point for the Hugging Face Space (see Dockerfile next to this file).
set -eu
cd /repo

: "${DATABASE_URL:?Set the DATABASE_URL secret in the Space settings}"
: "${DOCUMENT_INTELLIGENCE_TOKEN:?Set the DOCUMENT_INTELLIGENCE_TOKEN secret in the Space settings}"
: "${SEED_DEFAULT_PASSWORD:?Set the SEED_DEFAULT_PASSWORD secret in the Space settings}"
mkdir -p "$UPLOAD_DIR"

echo "[start] applying database migrations"
(cd packages/database && ./node_modules/.bin/prisma migrate deploy)

echo "[start] seeding reference data and demo accounts (idempotent upserts)"
(cd packages/database && node dist/seed.js)

echo "[start] starting document intelligence on 127.0.0.1:8000"
uvicorn app.main:app --host 127.0.0.1 --port 8000 --workers 1 &

echo "[start] starting Orchestra API on port ${API_PORT}"
exec node apps/api/dist/main.js
