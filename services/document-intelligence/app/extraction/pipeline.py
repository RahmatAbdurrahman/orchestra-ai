"""End-to-end extraction: bytes -> text lines -> parsed invoice -> scored result."""

from __future__ import annotations

import time

from app.config import Settings
from app.extraction.parser import FieldValue, InvoiceParser, ParsedInvoice
from app.extraction.text import extract_text
from app.schemas.extraction import ExtractedField, ExtractionResult, InvoiceFields, LineItem

FIELD_WEIGHTS = {
    "supplier_name": 0.2,
    "document_number": 0.15,
    "document_date": 0.1,
    "currency": 0.05,
    "total_amount": 0.25,
}
ITEMS_WEIGHT = 0.25


def _field(value: FieldValue, threshold: float, cast=None) -> ExtractedField:
    raw = value.value
    if raw is not None and cast is not None:
        raw = cast(raw)
    confidence = round(max(0.0, min(1.0, value.confidence if raw is not None else 0.0)), 4)
    return ExtractedField(value=raw, confidence=confidence, needs_review=raw is None or confidence < threshold, source=value.source)


def score(parsed: ParsedInvoice, threshold: float) -> tuple[float, bool]:
    weighted = sum(getattr(parsed, name).confidence * weight for name, weight in FIELD_WEIGHTS.items() if getattr(parsed, name).value is not None)
    items_confidence = sum(item.confidence for item in parsed.items) / len(parsed.items) if parsed.items else 0.0
    overall = round(min(1.0, weighted + items_confidence * ITEMS_WEIGHT), 4)
    key_fields_weak = any(
        getattr(parsed, name).value is None or getattr(parsed, name).confidence < threshold for name in FIELD_WEIGHTS
    )
    items_weak = not parsed.items or any(item.confidence < threshold for item in parsed.items)
    needs_review = overall < threshold or key_fields_weak or items_weak or bool(parsed.review_reasons)
    return overall, needs_review


def extract_document(content: bytes, mime_type: str, settings: Settings) -> ExtractionResult:
    started = time.perf_counter()
    text = extract_text(content, mime_type, settings)
    parsed = InvoiceParser(text.lines).parse()
    threshold = settings.review_threshold
    overall, needs_review = score(parsed, threshold)

    items = [
        LineItem(
            description=_field(item.description, threshold),
            quantity=_field(item.quantity, threshold, float),
            unit_price=_field(item.unit_price, threshold, float),
            line_total=_field(item.line_total, threshold, float),
            confidence=round(item.confidence, 4),
            needs_review=item.confidence < threshold,
        )
        for item in parsed.items
    ]
    raw_text = "\n".join(line.text for line in text.lines)
    return ExtractionResult(
        document_type="INVOICE",
        extraction_method=text.method,
        engine=text.engine,
        page_count=text.page_count,
        fields=InvoiceFields(
            supplier_name=_field(parsed.supplier_name, threshold),
            document_number=_field(parsed.document_number, threshold),
            document_date=_field(parsed.document_date, threshold),
            currency=_field(parsed.currency, threshold),
            subtotal=_field(parsed.subtotal, threshold, float),
            tax_amount=_field(parsed.tax_amount, threshold, float),
            total_amount=_field(parsed.total_amount, threshold, float),
        ),
        items=items,
        overall_confidence=overall,
        needs_review=needs_review,
        review_reasons=parsed.review_reasons,
        warnings=text.warnings,
        raw_text_preview=raw_text[:2000],
        processing_ms=round((time.perf_counter() - started) * 1000, 1),
    )
