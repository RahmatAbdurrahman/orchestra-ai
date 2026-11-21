# Hosted simulation: Vercel + Render + Supabase

A low-cost hosted variant of the demo. It is a **simulation deployment**, not the production setup
in [deployment.md](deployment.md).

| Part | Where | Notes |
|---|---|---|
| Web (Next.js) | Vercel, root directory `apps/web` | `apps/web/vercel.json` builds `@orchestra/domain` first |
| API + document intelligence | Render web service (Docker, free) | `deploy/hosted/`, one container, API on `$PORT` |
| PostgreSQL | Supabase, session pooler (port 5432) | migrations and seed run on every start |
| SimERP + UiPath robot | the robot PC | the robot opens `ERP_Simulation_Url` (e.g. `http://localhost:4100`) itself |

Hugging Face was the first choice, but Docker Spaces need a PRO subscription on a free account
(HTTP 402), so the backend runs on Render.

Trade-offs of this variant:

- Background jobs run in-process (`QUEUE_DRIVER=inline`, no Redis), so the container runs with
  `NODE_ENV=development`, because production refuses inline queues and demo login.
- Uploaded documents live on the container's ephemeral disk and are lost on restart or redeploy.
- A free Render service sleeps after about 15 minutes idle; the next request waits for it to start
  (typically under a minute). It has 512 MB of memory.
- The Render URL is public; the API is still protected by Orchestra sign-in. With
  `DEMO_LOGIN_ENABLED=true`, anyone who can open the web URL can sign in as any role, including
  Operator, and start robot jobs on the robot PC.

## Render web service

Runtime **Docker**, Dockerfile `deploy/hosted/Dockerfile`, build context `.` (repository root).
Health check path: `/api/v1/health`.

Environment:

| Name | Value |
|---|---|
| `DATABASE_URL` (secret) | Supabase session pooler URL + `?sslmode=require&connection_limit=5` |
| `DOCUMENT_INTELLIGENCE_TOKEN` (secret) | random string, at least 16 characters |
| `SEED_DEFAULT_PASSWORD` (secret) | password of the seeded demo accounts |
| `UIPATH_CLIENT_ID`, `UIPATH_CLIENT_SECRET` (secret) | external application credentials |
| `UIPATH_MODE` | `cloud` |
| `UIPATH_ORCHESTRATOR_URL`, `UIPATH_IDENTITY_URL` | as in the local `.env` |
| `UIPATH_SCOPES` | `OR.Jobs OR.Execution.Read OR.Folders.Read` |
| `UIPATH_FOLDER_ID`, `UIPATH_PROCESS_NAME` | as in the local `.env` |
| `UIPATH_REQUEST_TIMEOUT_MS` | `30000` |
| `CORS_ORIGINS` | optional; only browsers calling the API directly need to be listed |
| `COOKIE_SECURE` | `true` |
| `DEMO_LOGIN_ENABLED` | `true` or `false` |

## Vercel

1. Import the GitHub repository with root directory **`apps/web`** (framework: Next.js).
2. Set `API_INTERNAL_URL` to the Render URL, e.g. `https://orchestra-ai-api.onrender.com`.
   Leave `API_INTERNAL_AUTH_TOKEN` unset. It is only needed when the API sits behind an
   authenticating gateway.
3. Deploy. Every Vercel hostname works (production domain, team alias, per-deployment URLs):
   the proxy checks that a state-changing request comes from the host it was sent to, and calls
   the API without forwarding the browser `Origin`.

## Demo data

`pnpm demo:data -- --base-url <web or API URL> [--robot <n>]` fills an empty environment with
synthetic requests in every stage. It drives the real API the way the UI does: create, upload a
sample invoice, document intelligence, verify, approve or reject. It does not write to the
database directly.

- It needs `DEMO_LOGIN_ENABLED=true` on the target.
- Titles start with `[DEMO]`.
- `--robot n` fully approves `n` requests (default 1). Each one starts a **real** UiPath job, so
  the robot PC must be ready.
- Each run adds a new set; it is not idempotent. The audit trail is append-only, so demo events
  stay in it.

The browser only talks to Vercel. The Vercel server proxies `/api/v1/*` to Render, so the session
cookie stays first-party on the Vercel domain.
