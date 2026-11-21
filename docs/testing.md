# Testing

The test suites follow SAD §18. The guiding rule: **never claim a UiPath end-to-end result from a
mocked Orchestrator**. Every suite below states what is real and what is simulated.

## Suites

| Suite | Location | Real | Simulated / mocked |
|---|---|---|---|
| Domain unit tests | `packages/domain/src/**/*.spec.ts` | state machines, rule engine, RBAC matrix, approval eligibility, robot output validation, status normalisation, money, supplier matching, config schema | — |
| Core unit tests | `packages/core/src/core.spec.ts` | audit redaction, in-process queue retry/de-dup semantics, storage path safety | — |
| UiPath adapter tests | `packages/uipath-client/src/*.spec.ts` | request shapes, token caching/refresh, reference lookup, error classification | Orchestrator HTTP responses (fake `fetch`) |
| ERP simulation tests | `services/erp-simulation/src/app.spec.ts` | login, PO creation, idempotency key uniqueness, business errors, HTML escaping, maintenance mode | — |
| Orchestrator mock tests | `services/uipath-orchestrator-mock/src/app.spec.ts` | the mock's own API; mock robot driving a real ERP simulation instance over HTTP | the Orchestrator itself |
| API unit tests | `apps/api/src/**/*.spec.ts` | upload validation (magic bytes, names) | — |
| **API integration** | `apps/api/test/*.int-spec.ts` | NestJS app, guards, validation, PostgreSQL (migrations + trigger), transactions, rule engine, approvals, automation executor, reconciler, UiPath adapter over HTTP, ERP simulation | **UiPath Orchestrator (mock)**, document intelligence (stub returning a canned extraction), queue (in-process instead of BullMQ) |
| Worker BullMQ tests | `apps/worker/test/bullmq.int-spec.ts` | BullMQ + Redis: job-id de-duplication, retries, final-attempt flag | — (skipped without `REDIS_URL`) |
| Python service | `services/document-intelligence/tests` | number/date parsing, parser on Indonesian and English invoices, cross-checks, API auth and validation, extraction of generated PDFs | OCR test skipped when Tesseract is not installed |
| **End-to-end** | `tests/e2e/specs` (Playwright) | browser UI, API, PostgreSQL, worker logic, Python service, ERP simulation | **UiPath Orchestrator (mock)** |

## Commands

```bash
pnpm build                    # shared packages must be built before dependants are tested
pnpm test                     # every unit suite
```

```bash
TEST_DATABASE_URL=postgresql://... pnpm test:integration   # the database is TRUNCATED by the tests
```

```bash
REDIS_URL=redis://localhost:6379 pnpm --filter @orchestra/worker test:integration
```

```bash
cd services/document-intelligence && pytest
```

```bash
docker compose up --build --detach --wait && pnpm test:e2e     # PW_CHANNEL=msedge|chrome to use an installed browser
```

## Scenario coverage (SAD §18 / PRD §21)

| Scenario | Where |
|---|---|
| Login, logout, session revocation, lockout, generic errors | `auth-rbac.int-spec.ts` |
| RBAC matrix enforced on the server; data scoping own / assigned / all | `auth-rbac.int-spec.ts`, `permissions.spec.ts`, E2E |
| Audit trail append-only at the database level | `auth-rbac.int-spec.ts` |
| CSRF origin check, unknown fields rejected | `auth-rbac.int-spec.ts` |
| Request submission, document processing, verification with low-confidence acknowledgement | `purchase-flow.int-spec.ts`, E2E |
| Rule engine (completeness, supplier, quantity, budget, duplicates, thresholds, FX) | `engine.spec.ts`, `purchase-flow.int-spec.ts` |
| Tiered approval, order of levels, eligibility, own request, double decision | `purchase-flow.int-spec.ts`, `eligibility.spec.ts`, E2E |
| Rejected request never executed | `purchase-flow.int-spec.ts` |
| Automation dispatch → robot → PO, transitions audited in order | `purchase-flow.int-spec.ts`, E2E |
| Robot crash after the ERP accepted the order → operator retry → **no duplicate PO** | `automation-reliability.int-spec.ts`, E2E |
| `StartJobs` timeout with the job created → adopted by reference, no resubmission | `automation-reliability.int-spec.ts` |
| Submission error → automatic retry | `automation-reliability.int-spec.ts` |
| Business exception → failed, no automatic retry, operator cancel | `automation-reliability.int-spec.ts` |
| Retry limit → `RETRY_LIMIT_REACHED`, intervention required | `automation-reliability.int-spec.ts` |
| Completed job cannot be retried | `automation-reliability.int-spec.ts` |
| Worker crash: lost queue message and interrupted submission recovered by the reconciler | `automation-reliability.int-spec.ts` |
| UiPath health / test connection, no secrets returned | `automation-reliability.int-spec.ts` |
| Robot unavailable (pending timeout) | executor logic (`automation-executor.ts`); mock scenario `robot-unavailable` for manual testing — not automated because the minimum timeout is one minute |

## UiPath tests that still need a real robot

These are listed in `uipath/PurchaseOrderAutomation/README.md` and must be executed in UiPath Studio /
Orchestrator before claiming that the robot works: successful PO creation, duplicate key, invalid input,
missing fields, application timeout, application down, robot unavailable.

## Results of the last full run (local machine, Windows 11)

| Suite | Result |
|---|---|
| Domain unit | 68 passed |
| Core unit | 5 passed |
| UiPath adapter | 13 passed |
| ERP simulation | 9 passed |
| Orchestrator mock | 5 passed |
| API unit | 4 passed |
| API integration (PostgreSQL via Prisma's local dev server, mocked UiPath) | 19 passed |
| Worker BullMQ | skipped locally (no Redis on the machine); runs in CI |
| Python | 41 passed, 1 skipped (OCR: Tesseract not installed locally; installed in Docker and CI) |
| Playwright E2E (Edge, standalone Next.js server as in the Docker image, local services, in-process queue, mocked UiPath) | 4 passed |

Not run locally: Docker Compose (Docker is not installed on the development machine), BullMQ with a
real Redis, the OCR path, and anything involving a real UiPath tenant or robot.
