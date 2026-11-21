"""Response contract (mirrors extractionResultSchema in @orchestra/domain)."""

from __future__ import annotations

from typing import Generic, TypeVar

from pydantic import BaseModel, ConfigDict, Field
from pydantic.alias_generators import to_camel

T = TypeVar("T")


class CamelModel(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)


class ExtractedField(CamelModel, Generic[T]):
    value: T | None = None
    confidence: float = Field(ge=0, le=1, default=0.0)
    needs_review: bool = True
    source: str | None = None


class InvoiceFields(CamelModel):
    supplier_name: ExtractedField[str]
    document_number: ExtractedField[str]
    document_date: ExtractedField[str]
    currency: ExtractedField[str]
    subtotal: ExtractedField[float]
    tax_amount: ExtractedField[float]
    total_amount: ExtractedField[float]


class LineItem(CamelModel):
    description: ExtractedField[str]
    quantity: ExtractedField[float]
    unit_price: ExtractedField[float]
    line_total: ExtractedField[float]
    confidence: float = Field(ge=0, le=1)
    needs_review: bool


class ExtractionResult(CamelModel):
    document_type: str = "INVOICE"
    extraction_method: str
    engine: str | None = None
    page_count: int
    fields: InvoiceFields
    items: list[LineItem]
    overall_confidence: float = Field(ge=0, le=1)
    needs_review: bool
    review_reasons: list[str]
    warnings: list[str]
    raw_text_preview: str | None = None
    processing_ms: float | None = None
