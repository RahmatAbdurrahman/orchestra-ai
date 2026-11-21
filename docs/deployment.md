# Deployment

## Development / demo: Docker Compose

```bash
docker compose up --build
```

| Service | Port | Notes |
|---|---|---|
| `web` | 3000 | Next.js standalone; proxies `/api/v1/*` to `api` (`API_INTERNAL_URL`) |
| `api` | 4000 | NestJS; OpenAPI at `/api/v1/docs` |
| `worker` | — | BullMQ consumers + reconciler; health on 4001 inside the network |
| `document-intelligence` | — | FastAPI + Tesseract (eng, ind) |
| `postgres` | 127.0.0.1:5432 | data volume `pgdata` |
| `redis` | 127.0.0.1:6379 | AOF persistence, volume `redisdata` |
| `migrate` | — | one-shot: `prisma migrate deploy` + idempotent seed |
| `erp-simulation` | 4100 | SimERP; must be reachable from the UiPath robot machine |
| `uipath-mock` | 127.0.0.1:4200 | development only; remove or ignore when using a real tenant |

Uploaded documents live in the `uploads` volume shared by `api` and `worker`.

## Configuration reference

Environment variables are validated at start-up (API: `apps/api/src/config/app-config.ts`, worker:
`apps/worker/src/worker-config.ts`); the process refuses to start with an invalid configuration.

| Variable | Used by | Default | Notes |
|---|---|---|---|
| `DATABASE_URL` | api, worker, migrate | — | PostgreSQL connection string |
| `REDIS_URL` | api, worker | `redis://localhost:6379` | |
| `QUEUE_DRIVER` | api | `bullmq` | `inline` is for development/tests and is rejected when `NODE_ENV=production` |
| `UPLOAD_DIR` | api, worker | `./storage/uploads` | must be the same storage for both |
| `API_PORT` | api | 4000 | |
| `CORS_ORIGINS` | api | `http://localhost:3000` | also the allow-list of the CSRF origin check |
| `COOKIE_SECURE` | api | `false` | **set `true` behind HTTPS** |
| `TRUST_PROXY` | api | `false` | set `true` only behind a trusted reverse proxy |
| `SESSION_TTL_HOURS` | api | 12 | |
| `LOGIN_MAX_FAILED_ATTEMPTS`, `LOGIN_LOCKOUT_MINUTES` | api | 5, 15 | |
| `LOGIN_RATE_LIMIT_PER_MINUTE`, `API_RATE_LIMIT_PER_MINUTE` | api | 10, 1200 | per client IP |
| `RBAC_ADMIN_CAN_APPROVE`, `RBAC_ADMIN_CAN_OPERATE_AUTOMATION` | api | `false` | the "Configurable/Controlled" cells of the RBAC matrix |
| `SWAGGER_ENABLED` | api | `true` | consider `false` in production |
| `DOCUMENT_INTELLIGENCE_URL`, `DOCUMENT_INTELLIGENCE_TOKEN` | api, worker, python | — | shared internal token (≥ 16 chars) |
| `OCR_ENGINE`, `OCR_LANGUAGES`, `DI_MAX_FILE_MB`, `DI_REVIEW_THRESHOLD` | python | `tesseract`, `eng+ind`, 15, 0.85 | |
| `UIPATH_*` | api, worker | — | see [uipath-integration.md](uipath-integration.md) |
| `WORKER_DOCUMENT_CONCURRENCY`, `WORKER_AUTOMATION_CONCURRENCY` | worker | 2, 5 | |
| `RECONCILE_INTERVAL_MS` | api (inline), worker | 60000 | |
| `AUTOMATION_*_MS` | api (inline), worker | see `packages/core/src/settings.ts` | timing overrides, mainly for tests |
| `API_INTERNAL_URL` | web | `http://localhost:4000` | runtime; no rebuild needed |
| `SEED_DEFAULT_PASSWORD` | migrate | — | demo users only; quote it in `.env` files if it contains `#` |

## Production notes

The MVP explicitly excludes production-grade high availability (PRD §9). Before exposing it beyond a demo:

* **TLS** in front of `web` (reverse proxy), `COOKIE_SECURE=true`, `TRUST_PROXY=true`, HSTS at the proxy.
* **Secrets** from a secret manager (UiPath client secret, internal token, database password); never in
  images or the repository. Rotate the demo passwords, or do not run the seed.
* **Network**: only `web` (and the ERP for the robot) should be reachable; keep the API, Redis, PostgreSQL
  and the Python service on the internal network. Do not deploy `uipath-mock`.
* **Scaling**: the API is stateless (sessions are in PostgreSQL) and can run several replicas; run
  several workers for throughput — job claims are compare-and-set and queue ids are de-duplicated.
* **Storage**: replace the shared volume with object storage when running on more than one host
  (`LocalFileStorage` is the only implementation today).
* **Backups**: PostgreSQL (business data and audit trail) and Redis AOF (queue state; recoverable
  from PostgreSQL by the reconciler, so Redis is not the source of truth).
* **Observability**: logs are structured (JSON lines in core, Nest logger in the apps) and carry the
  correlation id that is also sent to UiPath as `in_CorrelationId`.
* **Database privileges**: the application role does not need `TRUNCATE`; revoking it makes the audit
  trail tamper-resistant even for the application account (the trigger already blocks UPDATE/DELETE).
* **UiPath**: unattended robot licences, External Application with least-privilege scopes, robot machine
  network access to the ERP, and Orchestrator reachable from the worker over HTTPS.

## CI

`.github/workflows/ci.yml` runs on every push and pull request:

1. **node** — install, build, typecheck, unit tests, migrations against PostgreSQL, API integration tests,
   worker BullMQ tests against Redis, web build.
2. **python** — pytest with Tesseract installed (the OCR test runs here).
3. **e2e** — `docker compose up --build --wait`, Playwright against the running stack (mocked UiPath),
   report uploaded as an artifact.
