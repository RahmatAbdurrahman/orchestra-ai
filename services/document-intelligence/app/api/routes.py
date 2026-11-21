"""HTTP API of the document intelligence service (internal; called by the Orchestra worker)."""

from __future__ import annotations

import hmac
import logging

from fastapi import APIRouter, Depends, File, Header, HTTPException, UploadFile, status

from app import __version__
from app.config import Settings, get_settings
from app.extraction.ocr import OcrUnavailableError, tesseract_available
from app.extraction.pipeline import extract_document
from app.extraction.text import UnreadableDocumentError
from app.schemas.extraction import ExtractionResult
from app.validators.files import sniff_mime_type

logger = logging.getLogger("document_intelligence")
router = APIRouter()


def require_internal_token(
    x_internal_token: str | None = Header(default=None),
    settings: Settings = Depends(get_settings),
) -> None:
    expected = settings.internal_token
    if not expected:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "DOCUMENT_INTELLIGENCE_TOKEN is not configured")
    if not x_internal_token or not hmac.compare_digest(x_internal_token, expected):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid internal token")


@router.get("/health")
def health(settings: Settings = Depends(get_settings)) -> dict:
    return {
        "status": "ok",
        "service": "document-intelligence",
        "version": __version__,
        "pdfTextLayer": True,
        "ocr": {"engine": settings.ocr_engine, "tesseractInstalled": tesseract_available(), "languages": settings.ocr_languages},
    }


@router.post(
    "/v1/extract",
    response_model=ExtractionResult,
    response_model_by_alias=True,
    dependencies=[Depends(require_internal_token)],
)
def extract(
    file: UploadFile = File(...),
    x_correlation_id: str | None = Header(default=None),
    settings: Settings = Depends(get_settings),
) -> ExtractionResult:
    # Read at most one byte more than the limit to detect oversized uploads cheaply.
    content = file.file.read(settings.max_file_bytes + 1)
    if not content:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "The file is empty")
    if len(content) > settings.max_file_bytes:
        raise HTTPException(status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, f"The file exceeds {settings.max_file_mb} MB")
    mime_type = sniff_mime_type(content)
    if mime_type is None:
        raise HTTPException(status.HTTP_415_UNSUPPORTED_MEDIA_TYPE, "Only PDF, PNG and JPEG documents are supported")
    try:
        result = extract_document(content, mime_type, settings)
    except (UnreadableDocumentError, OcrUnavailableError) as error:
        raise HTTPException(422, str(error)) from error
    logger.info(
        "extracted document",
        extra={
            "correlation_id": x_correlation_id,
            "method": result.extraction_method,
            "items": len(result.items),
            "confidence": result.overall_confidence,
            "ms": result.processing_ms,
        },
    )
    return result
