"""FastAPI application factory. Run with: uvicorn app.main:app --host 0.0.0.0 --port 8000"""

from __future__ import annotations

import logging

from fastapi import FastAPI

from app import __version__
from app.api.routes import router


def create_app() -> FastAPI:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
    application = FastAPI(
        title="Orchestra AI - Document Intelligence",
        version=__version__,
        description="Invoice text extraction (PDF text layer or OCR), field parsing and confidence scoring. Internal service.",
    )
    application.include_router(router)
    return application


app = create_app()
