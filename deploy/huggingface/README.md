---
title: Orchestra AI API
emoji: 🎼
colorFrom: indigo
colorTo: blue
sdk: docker
app_port: 7860
pinned: false
short_description: Orchestra AI API and document intelligence (simulation)
---

# Orchestra AI API (Hugging Face Space)

This Space runs the Orchestra AI backend for the hosted simulation:

- NestJS API on port 7860 (`/api/v1/health`)
- Document intelligence (FastAPI + Tesseract) on `127.0.0.1:8000`, internal only
- Background jobs in-process (`QUEUE_DRIVER=inline`)
- PostgreSQL is external (`DATABASE_URL`)

The web front end runs on Vercel and calls this Space server-side with a Hugging Face token.
It is deployed from the source repository with `scripts/hf-space-push.sh`; the setup is in
`docs/deployment-vercel-huggingface.md` there. Synthetic data only.
