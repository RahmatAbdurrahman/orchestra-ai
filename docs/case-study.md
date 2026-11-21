# Case study — Orchestra AI

**An enterprise automation platform that turns a supplier invoice into an ERP purchase order with
document intelligence, business rules, human approval and a UiPath robot — without ever creating a
duplicate order.**

## The problem

Purchasing in many organisations still runs on e-mail and spreadsheets: someone retypes invoice data,
approvals are chased by hand, someone else retypes the approved request into the ERP, and nobody can
say where a request is or who decided what. Every retyping step is a chance for an error, and naive
automation adds a new one: a robot that retries after a timeout can create the same purchase order twice.

## The solution

Orchestra AI orchestrates one complete flow end to end:

1. A requester uploads the supplier invoice. A Python service reads it (PDF text layer, OCR for scans)
   and scores every field.
2. The requester verifies the extracted values; low-confidence fields must be explicitly confirmed.
3. A configurable rule engine validates the request (supplier master, budget, duplicates, limits) and
   picks the approval route — department only, or department and finance above 5,000,000.
4. Approvers decide in order, with segregation of duties enforced on the server.
5. A worker submits a UiPath job; the robot enters the purchase order in the ERP through its web UI and
   reports the PO number back.
6. Operators see every attempt, error and log line, and can retry safely.

Everything is recorded in an append-only audit trail.

## Engineering highlights

* **Workflow as an explicit state machine.** Twelve business statuses, one transition table shared by
  the backend and the UI, compare-and-set updates, and an audit event in the same transaction as every
  transition.
* **Three layers against duplicate purchase orders.** One automation job per request (unique keys);
  one Orchestrator `Reference` per attempt, looked up before any (re)submission so a timeout is never
  treated as "not submitted"; and an idempotency key that the ERP enforces with a unique constraint and
  answers with the original PO number. Tested with a simulated robot crash after the ERP accepted the
  order: the retry completes with the same PO and the ERP still holds exactly one order.
* **Failure taxonomy instead of blind retries.** Failures before the robot starts (API errors, no robot
  available) are retried automatically with backoff; failures after it started wait for an authorized
  operator; business errors are never retried automatically; every budget is bounded.
* **Restart recovery.** PostgreSQL is the source of truth; a reconciler rebuilds lost queue messages and
  resolves interrupted submissions by reference.
* **Human in the loop by design.** AI output is stored, never applied directly; the API refuses
  verification until low-confidence fields are acknowledged; approval cannot be skipped by any code path.
* **Security fundamentals.** Server-side sessions, argon2id, lockout and rate limiting, backend RBAC with
  data scoping, CSRF origin checks, content-sniffed uploads, secrets only on the server, DB-enforced audit
  immutability.
* **Testability.** Pure domain package; an Orchestrator mock with failure injection; integration tests on
  a real PostgreSQL; Playwright tests through the UI — with mocked parts named explicitly.

## Architecture

Modular monolith (NestJS) + background worker (BullMQ/Redis) + Python document intelligence (FastAPI) +
Next.js frontend + UiPath (Orchestrator/Robot) + an ERP simulation. Details in
[architecture.md](architecture.md).

## Results (test environment)

* 19 API integration tests on PostgreSQL covering the full flow, RBAC, audit immutability and seven
  failure/recovery scenarios; 4 Playwright end-to-end tests through the UI; 140+ unit tests across the
  TypeScript packages and the Python service.
* Sample invoices (Indonesian and English, IDR and USD) are extracted with 87–97% field confidence via
  the PDF text layer; all key fields and line items match the source documents.
* All UiPath results so far come from the development **mock** of Orchestrator. The UiPath project is
  provided but has not yet been validated in UiPath Studio or run on a robot.

## What I would do next

1. Validate and publish the UiPath process in Studio, then run the robot test cases against SimERP.
2. Orchestrator webhooks (job completed/faulted) to complete jobs faster than polling.
3. Object storage for documents, and a visual workflow builder (PRD "Future").
4. Learning from verification corrections to improve extraction (supplier-specific layouts).
