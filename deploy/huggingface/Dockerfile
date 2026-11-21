# syntax=docker/dockerfile:1.7
# Hugging Face Docker Space: Orchestra API + document intelligence in one container.
#   - API (NestJS) listens on 7860, the port the Space exposes.
#   - Document intelligence (FastAPI) listens on 127.0.0.1:8000, reachable only by the API.
#   - Background jobs run in-process (QUEUE_DRIVER=inline); no Redis.
#   - PostgreSQL is external (DATABASE_URL secret, e.g. Supabase session pooler).
# The build context is the repository root (scripts/hf-space-push.sh assembles it).

FROM node:22-bookworm-slim
ENV PNPM_HOME=/pnpm \
    PATH=/pnpm:/opt/di/bin:$PATH \
    CI=true \
    CHECKPOINT_DISABLE=1 \
    PRISMA_HIDE_UPDATE_MESSAGE=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

RUN corepack enable && corepack prepare pnpm@10.13.1 --activate \
 && apt-get update \
 && apt-get install -y --no-install-recommends openssl ca-certificates \
      python3 python3-venv tesseract-ocr tesseract-ocr-eng tesseract-ocr-ind \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /repo

# Node dependencies (cached while manifests do not change).
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/api/package.json apps/api/
COPY apps/worker/package.json apps/worker/
COPY apps/web/package.json apps/web/
COPY packages/domain/package.json packages/domain/
COPY packages/database/package.json packages/database/
COPY packages/core/package.json packages/core/
COPY packages/uipath-client/package.json packages/uipath-client/
COPY services/erp-simulation/package.json services/erp-simulation/
COPY services/uipath-orchestrator-mock/package.json services/uipath-orchestrator-mock/
COPY tests/e2e/package.json tests/e2e/
RUN pnpm install --frozen-lockfile --filter "./packages/*" --filter @orchestra/api

# Document intelligence (Python virtual environment).
COPY services/document-intelligence/pyproject.toml services/document-intelligence/
COPY services/document-intelligence/app services/document-intelligence/app
RUN python3 -m venv /opt/di && /opt/di/bin/pip install ./services/document-intelligence

# Build the shared packages (includes prisma generate) and the API.
COPY . .
RUN pnpm --filter "./packages/*" run build && pnpm --filter @orchestra/api run build

# Spaces run the container as uid 1000 (the "node" user in this image).
RUN chmod +x deploy/huggingface/start.sh && mkdir -p /tmp/orchestra && chown -R node:node /repo /tmp/orchestra
USER node

ENV NODE_ENV=development \
    API_PORT=7860 \
    QUEUE_DRIVER=inline \
    UPLOAD_DIR=/tmp/orchestra/uploads \
    DOCUMENT_INTELLIGENCE_URL=http://127.0.0.1:8000 \
    TRUST_PROXY=true \
    SWAGGER_ENABLED=false \
    OCR_ENGINE=tesseract

EXPOSE 7860
CMD ["deploy/huggingface/start.sh"]
