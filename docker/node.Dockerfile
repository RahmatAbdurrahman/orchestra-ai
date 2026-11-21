# syntax=docker/dockerfile:1.7
# One build for every Node.js component of the monorepo.
#   target "backend": api, worker, migrate/seed, erp-simulation, uipath-orchestrator-mock
#   target "web":     Next.js standalone server

FROM node:22-bookworm-slim AS base
ENV PNPM_HOME=/pnpm \
    PATH=/pnpm:$PATH \
    CI=true \
    NEXT_TELEMETRY_DISABLED=1 \
    CHECKPOINT_DISABLE=1 \
    PRISMA_HIDE_UPDATE_MESSAGE=1
RUN corepack enable && corepack prepare pnpm@10.13.1 --activate \
 && apt-get update \
 && apt-get install -y --no-install-recommends openssl ca-certificates \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /repo

# ---- dependencies (cached while manifests do not change) ----------------------
FROM base AS deps
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
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store pnpm install --frozen-lockfile

# ---- build ---------------------------------------------------------------------
FROM deps AS build
COPY . .
RUN pnpm --filter "./packages/*" run build \
 && pnpm --filter @orchestra/api --filter @orchestra/worker \
         --filter @orchestra/erp-simulation --filter @orchestra/uipath-orchestrator-mock run build \
 && pnpm --filter @orchestra/web run build

# ---- backend runtime -----------------------------------------------------------
FROM base AS backend
ENV NODE_ENV=production
COPY --from=build --chown=node:node /repo /repo
RUN mkdir -p /data/uploads /data/erp && chown -R node:node /data
USER node
EXPOSE 4000 4100 4200
CMD ["node", "apps/api/dist/main.js"]

# ---- web runtime (Next.js standalone) ------------------------------------------
FROM node:22-bookworm-slim AS web
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0
WORKDIR /app
COPY --from=build --chown=node:node /repo/apps/web/.next/standalone ./
COPY --from=build --chown=node:node /repo/apps/web/.next/static ./apps/web/.next/static
USER node
EXPOSE 3000
CMD ["node", "apps/web/server.js"]
