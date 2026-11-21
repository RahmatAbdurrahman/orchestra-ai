# Hosted simulation: Vercel + Hugging Face + Supabase

A low-cost hosted variant of the demo. It is a **simulation deployment**, not the production setup
in [deployment.md](deployment.md).

| Part | Where | Notes |
|---|---|---|
| Web (Next.js) | Vercel, root directory `apps/web` | `apps/web/vercel.json` builds `@orchestra/domain` first |
| API + document intelligence | Hugging Face Docker Space (private) | `deploy/huggingface/`; one container, API on 7860 |
| PostgreSQL | Supabase, session pooler (port 5432) | migrations and seed run on every Space start |
| SimERP + UiPath robot | the robot PC | the robot opens `ERP_Simulation_Url` (e.g. `http://localhost:4100`) itself |

Trade-offs of this variant:

- Background jobs run in-process (`QUEUE_DRIVER=inline`, no Redis), so the Space runs with
  `NODE_ENV=development`. Production refuses inline queues and demo login.
- Uploaded documents live on the Space's ephemeral disk and are lost when the Space restarts.
- A free Space sleeps when idle. The first request after that waits for it to wake up.
- When `DEMO_LOGIN_ENABLED=true`, anyone who can open the web URL can sign in as any role,
  including Operator, and start robot jobs on the robot PC.

## Hugging Face Space

1. Create a **Docker** Space (blank template), visibility **Private**.
2. In **Settings → Variables and secrets**, add:

   | Name | Kind | Value |
   |---|---|---|
   | `DATABASE_URL` | secret | Supabase session pooler URL + `?sslmode=require&connection_limit=5` |
   | `DOCUMENT_INTELLIGENCE_TOKEN` | secret | random string, at least 16 characters |
   | `SEED_DEFAULT_PASSWORD` | secret | password of the seeded demo accounts |
   | `UIPATH_CLIENT_ID`, `UIPATH_CLIENT_SECRET` | secret | external application credentials |
   | `UIPATH_MODE` | variable | `cloud` |
   | `UIPATH_ORCHESTRATOR_URL`, `UIPATH_IDENTITY_URL` | variable | as in the local `.env` |
   | `UIPATH_SCOPES` | variable | `OR.Jobs OR.Execution.Read OR.Folders.Read` |
   | `UIPATH_FOLDER_ID`, `UIPATH_PROCESS_NAME` | variable | as in the local `.env` |
   | `CORS_ORIGINS` | variable | the Vercel URL, e.g. `https://orchestra-ai.vercel.app` |
   | `COOKIE_SECURE` | variable | `true` |
   | `DEMO_LOGIN_ENABLED` | variable | `true` or `false` |

3. Push the committed code:

   ```bash
   scripts/hf-space-push.sh <hf-user>/<space-name>
   ```

   Git asks for credentials: your Hugging Face username and an access token with **write** access.
4. Check the build and runtime logs in the Space. The API is healthy when `/api/v1/health` answers.

## Vercel

1. Import the GitHub repository, root directory **`apps/web`** (framework: Next.js).
2. Environment variables:
   - `API_INTERNAL_URL`: `https://<hf-user>-<space-name>.hf.space`
   - `API_INTERNAL_AUTH_TOKEN`: a Hugging Face access token with **read** access to the private Space
3. Deploy. Then put the final Vercel URL in the Space's `CORS_ORIGINS` and restart the Space.

The browser only talks to Vercel. The Vercel server proxies `/api/v1/*` to the Space with the
token, so the token and the Space URL are never exposed to the browser.
