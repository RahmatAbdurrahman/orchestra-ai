"""Text acquisition: PDF text layer first, OCR for scans and images."""

from __future__ import annotations

import io
from dataclasses import dataclass

from PIL import Image

from app.config import Settings
from app.extraction.ocr import TextLine, get_engine


class UnreadableDocumentError(ValueError):
    """The file could not be opened or contains no readable content."""


@dataclass
class TextExtraction:
    lines: list[TextLine]
    method: str  # PDF_TEXT | OCR
    engine: str | None
    page_count: int
    warnings: list[str]


MIN_TEXT_LAYER_CHARS = 40


def extract_text(content: bytes, mime_type: str, settings: Settings) -> TextExtraction:
    if mime_type == "application/pdf":
        return _from_pdf(content, settings)
    return _from_image(content, settings)


def _from_pdf(content: bytes, settings: Settings) -> TextExtraction:
    from pypdf import PdfReader
    from pypdf.errors import PdfReadError

    try:
        reader = PdfReader(io.BytesIO(content))
        if reader.is_encrypted:
            raise UnreadableDocumentError("Encrypted PDFs are not supported")
        pages = reader.pages
        page_count = len(pages)
    except PdfReadError as error:
        raise UnreadableDocumentError(f"The PDF could not be read: {error}") from error

    warnings: list[str] = []
    if page_count > settings.max_pages:
        warnings.append(f"Only the first {settings.max_pages} of {page_count} pages were processed")
    lines: list[TextLine] = []
    for page in list(pages)[: settings.max_pages]:
        try:
            text = page.extract_text(extraction_mode="layout") or ""
        except Exception:  # noqa: BLE001 - fall back to the plain extractor
            text = page.extract_text() or ""
        lines.extend(TextLine(text=line.rstrip(), confidence=0.99) for line in text.splitlines() if line.strip())

    if sum(len(line.text.strip()) for line in lines) >= MIN_TEXT_LAYER_CHARS:
        return TextExtraction(lines=lines, method="PDF_TEXT", engine=None, page_count=page_count, warnings=warnings)

    # Scanned PDF: render pages and OCR them.
    import pypdfium2 as pdfium

    engine = get_engine(settings.ocr_engine, settings.ocr_languages)
    document = pdfium.PdfDocument(content)
    ocr_lines: list[TextLine] = []
    try:
        for index in range(min(len(document), settings.max_pages)):
            image = document[index].render(scale=settings.ocr_dpi / 72).to_pil()
            ocr_lines.extend(engine.recognize(image))
    finally:
        document.close()
    warnings.append("No text layer found; the document was read with OCR")
    return TextExtraction(lines=ocr_lines, method="OCR", engine=engine.name, page_count=page_count, warnings=warnings)


def _from_image(content: bytes, settings: Settings) -> TextExtraction:
    try:
        image = Image.open(io.BytesIO(content))
        image.load()
    except Exception as error:  # noqa: BLE001
        raise UnreadableDocumentError(f"The image could not be read: {error}") from error
    engine = get_engine(settings.ocr_engine, settings.ocr_languages)
    return TextExtraction(
        lines=engine.recognize(image),
        method="OCR",
        engine=engine.name,
        page_count=1,
        warnings=[],
    )
