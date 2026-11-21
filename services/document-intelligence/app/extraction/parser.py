"""Rule-based invoice parser with per-field confidence scores.

The parser is deliberately transparent (regular expressions + cross checks)
so that every value can be traced to a source line, and every uncertainty is
surfaced to the human verifier instead of being silently "fixed".
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Generic, TypeVar

from app.extraction.numbers import CURRENCY_NOISE, amounts_in, find_date, parse_amount
from app.extraction.ocr import TextLine

T = TypeVar("T")


@dataclass
class FieldValue(Generic[T]):
    value: T | None
    confidence: float
    source: str | None = None


@dataclass
class ParsedItem:
    description: FieldValue[str]
    quantity: FieldValue[float]
    unit_price: FieldValue[float]
    line_total: FieldValue[float]
    confidence: float


@dataclass
class ParsedInvoice:
    supplier_name: FieldValue[str]
    document_number: FieldValue[str]
    document_date: FieldValue[str]
    currency: FieldValue[str]
    subtotal: FieldValue[float]
    tax_amount: FieldValue[float]
    total_amount: FieldValue[float]
    items: list[ParsedItem]
    review_reasons: list[str] = field(default_factory=list)


LEGAL_FORM = re.compile(r"(?i)(?<![A-Za-z])(PT|CV|UD|Tbk|Ltd|Inc|LLC|Corp|GmbH|Co\.)(?![A-Za-z])")
BUYER_LABEL = re.compile(r"(?i)\b(bill\s*to|ship\s*to|kepada|customer|pelanggan|buyer|pembeli|sold\s*to|ditagihkan\s*kepada)\b")
SUPPLIER_LABEL = re.compile(r"(?i)^\s*(?:from|supplier|vendor|seller|penjual|pemasok|dari)\s*[:\-]\s*(?P<value>.+)$")
TITLE_WORDS = re.compile(r"(?i)^\s*(invoice|faktur|nota|tagihan|receipt|kwitansi|tax\s*invoice|faktur\s*pajak)\s*$")

DOC_NUMBER_PATTERNS = [
    re.compile(
        r"(?i)\b(?:invoice|faktur|nota|inv)\s*(?:no\.?|number|nomor|num\.?|#)\s*[:.]?\s*(?P<value>[A-Z0-9][A-Z0-9/\-._]{2,40})"
    ),
    re.compile(r"(?i)\b(?:no\.?|nomor)\s*(?:invoice|faktur|nota|inv)\s*[:.]?\s*(?P<value>[A-Z0-9][A-Z0-9/\-._]{2,40})"),
    re.compile(r"(?i)\b(?:invoice|faktur)\s*[:#]\s*(?P<value>[A-Z0-9][A-Z0-9/\-._]{2,40})"),
]
FALLBACK_DOC_NUMBER = re.compile(r"(?i)\b(?P<value>(?:INV|FKT|FAK|NOTA)[-/][A-Z0-9/\-._]{3,40})")

DATE_LABEL = re.compile(
    r"(?i)\b(?:invoice\s*date|date\s*of\s*invoice|tanggal(?:\s*(?:invoice|faktur))?|tgl\.?|date|issued)\b\s*[:.]?\s*(?P<rest>.*)$"
)
DUE_DATE = re.compile(r"(?i)\b(due|jatuh\s*tempo|expiry|berlaku)\b")

CURRENCY_LABEL = re.compile(r"(?i)\b(?:currency|mata\s*uang)\s*[:]\s*(?P<code>[A-Z]{3})\b")
CURRENCY_SIGNALS = {
    "IDR": [re.compile(r"\bIDR\b"), re.compile(r"(?i)\bRp\.?(?=[\s\d])")],
    "USD": [re.compile(r"\bUSD\b"), re.compile(r"US\$|\$(?=\s?\d)")],
    "SGD": [re.compile(r"\bSGD\b"), re.compile(r"S\$")],
    "EUR": [re.compile(r"\bEUR\b"), re.compile(r"€")],
}

SUBTOTAL_LABEL = re.compile(r"(?i)\b(?:sub\s*-?\s*total|dpp|dasar\s*pengenaan\s*pajak|jumlah\s*harga\s*jual)\b")
TAX_LABEL = re.compile(r"(?i)\b(?:ppn|vat|tax|pajak|gst)\b")
TOTAL_LABEL = re.compile(
    r"(?i)\b(?:grand\s*total|total\s*(?:amount|due|tagihan|bayar|keseluruhan|invoice)?|amount\s*due|jumlah\s*tagihan|balance\s*due)\b"
)
TABLE_HEADER_DESC = re.compile(r"(?i)\b(description|item|items|deskripsi|uraian|nama\s*barang|barang|produk|keterangan|product)\b")
TABLE_HEADER_QTY = re.compile(r"(?i)\b(qty|quantity|kuantitas|banyaknya|jml|jumlah)\b")
ITEM_ROW = re.compile(
    r"^(?:\d{1,2}[.)]?\s+)?(?P<desc>.*?[A-Za-z].*?)\s+(?P<qty>\d+(?:[.,]\d+)?)\s*(?P<unit>[A-Za-z]{1,8}\.?)?\s+(?:[x@]\s*)?"
    r"(?P<price>\d[\d.,]*)\s+(?P<total>\d[\d.,]*)\s*$"
)
ITEM_ROW_NO_PRICE = re.compile(
    r"^(?:\d{1,2}[.)]?\s+)?(?P<desc>.*?[A-Za-z].*?)\s+(?P<qty>\d+(?:[.,]\d+)?)\s*(?P<unit>[A-Za-z]{1,8}\.?)?\s+(?P<total>\d[\d.,]*)\s*$"
)


def _columns(text: str) -> list[str]:
    return [part.strip() for part in re.split(r"\s{2,}|\t", text.strip()) if part.strip()]


def _clean_name(value: str) -> str:
    value = re.sub(r"\s+", " ", value).strip(" .,:;-|")
    return value[:200]


def _close(a: float, b: float, tolerance: float = 0.01) -> bool:
    return abs(a - b) <= max(abs(a), abs(b), 1.0) * tolerance


class InvoiceParser:
    def __init__(self, lines: list[TextLine]) -> None:
        self.lines = [TextLine(text=line.text.rstrip(), confidence=line.confidence) for line in lines if line.text.strip()]

    # ------------------------------------------------------------------ public
    def parse(self) -> ParsedInvoice:
        reasons: list[str] = []
        supplier = self._supplier()
        number = self._document_number()
        doc_date = self._document_date(reasons)
        currency = self._currency()
        subtotal, tax, total, totals_start = self._totals()
        items = self._items(totals_start)

        # ---- cross checks ------------------------------------------------
        if items:
            item_sum = round(sum(item.line_total.value or 0 for item in items), 2)
            if subtotal.value is not None:
                if _close(item_sum, subtotal.value):
                    subtotal.confidence = min(0.99, subtotal.confidence + 0.03)
                    for item in items:
                        item.confidence = min(0.99, item.confidence + 0.03)
                else:
                    reasons.append(f"Line items add up to {item_sum:,.2f} but the subtotal is {subtotal.value:,.2f}")
                    subtotal.confidence = min(subtotal.confidence, 0.6)
                    for item in items:
                        item.confidence = min(item.confidence, 0.6)
            else:
                subtotal = FieldValue(item_sum, 0.8, "derived:sum-of-items")
        elif subtotal.value is None and total.value is not None and tax.value is not None:
            subtotal = FieldValue(round(total.value - tax.value, 2), 0.6, "derived:total-minus-tax")

        if tax.value is None and subtotal.value is not None and total.value is not None:
            difference = round(total.value - subtotal.value, 2)
            if difference >= 0:
                tax = FieldValue(difference, 0.9 if difference == 0 else 0.7, "derived:total-minus-subtotal")

        if total.value is None and subtotal.value is not None:
            total = FieldValue(round(subtotal.value + (tax.value or 0), 2), 0.6, "derived:subtotal-plus-tax")
            reasons.append("No total amount found on the document; it was calculated")
        elif total.value is not None and subtotal.value is not None:
            expected = round(subtotal.value + (tax.value or 0), 2)
            if _close(expected, total.value):
                total.confidence = min(0.99, total.confidence + 0.03)
            else:
                reasons.append(f"Subtotal plus tax ({expected:,.2f}) does not match the total ({total.value:,.2f})")
                total.confidence = min(total.confidence, 0.6)

        if not items:
            reasons.append("No line items could be read; enter them manually")
        if supplier.value is None:
            reasons.append("Supplier name not found")
        if number.value is None:
            reasons.append("Invoice number not found")

        return ParsedInvoice(
            supplier_name=supplier,
            document_number=number,
            document_date=doc_date,
            currency=currency,
            subtotal=subtotal,
            tax_amount=tax,
            total_amount=total,
            items=items,
            review_reasons=reasons,
        )

    # ----------------------------------------------------------------- fields
    def _supplier(self) -> FieldValue[str]:
        for index, line in enumerate(self.lines[:40]):
            match = SUPPLIER_LABEL.match(line.text)
            if match:
                value = _clean_name(_columns(match.group("value"))[0])
                if value:
                    return FieldValue(value, 0.95 * line.confidence, f"line {index + 1}: labelled")
        buyer_zone = False
        for index, line in enumerate(self.lines[:15]):
            if BUYER_LABEL.search(line.text):
                buyer_zone = True
            if buyer_zone:
                continue
            for column in _columns(line.text):
                if LEGAL_FORM.search(column) and not TITLE_WORDS.match(column):
                    return FieldValue(_clean_name(column), 0.88 * line.confidence, f"line {index + 1}: company name")
        for index, line in enumerate(self.lines[:5]):
            first = _columns(line.text)[0] if _columns(line.text) else ""
            if first and not TITLE_WORDS.match(first) and re.search(r"[A-Za-z]{3,}", first) and not DATE_LABEL.search(first):
                return FieldValue(_clean_name(first), 0.45 * line.confidence, f"line {index + 1}: first heading")
        return FieldValue(None, 0.0)

    def _document_number(self) -> FieldValue[str]:
        for index, line in enumerate(self.lines[:60]):
            for pattern in DOC_NUMBER_PATTERNS:
                match = pattern.search(line.text)
                if match and any(char.isdigit() for char in match.group("value")):
                    return FieldValue(match.group("value").strip(".-_"), 0.95 * line.confidence, f"line {index + 1}: labelled")
        for index, line in enumerate(self.lines[:60]):
            match = FALLBACK_DOC_NUMBER.search(line.text)
            if match and any(char.isdigit() for char in match.group("value")):
                return FieldValue(match.group("value").strip(".-_"), 0.72 * line.confidence, f"line {index + 1}: pattern")
        return FieldValue(None, 0.0)

    def _document_date(self, reasons: list[str]) -> FieldValue[str]:
        candidates: list[tuple[float, FieldValue[str]]] = []
        for index, line in enumerate(self.lines[:60]):
            label = DATE_LABEL.search(line.text)
            if label and not DUE_DATE.search(line.text[: label.end()]):
                parsed = find_date(label.group("rest")) or find_date(line.text)
                if parsed:
                    confidence = (0.75 if parsed.ambiguous else 0.93) * line.confidence
                    candidates.append((confidence, FieldValue(parsed.value.isoformat(), confidence, f"line {index + 1}: labelled")))
        if not candidates:
            for index, line in enumerate(self.lines[:30]):
                if DUE_DATE.search(line.text):
                    continue
                parsed = find_date(line.text)
                if parsed:
                    confidence = 0.6 * line.confidence
                    candidates.append((confidence, FieldValue(parsed.value.isoformat(), confidence, f"line {index + 1}: first date")))
                    break
        if not candidates:
            reasons.append("Invoice date not found")
            return FieldValue(None, 0.0)
        best = max(candidates, key=lambda candidate: candidate[0])[1]
        if best.confidence < 0.8:
            reasons.append("Invoice date is ambiguous; check the day and month")
        return best

    def _currency(self) -> FieldValue[str]:
        text = "\n".join(line.text for line in self.lines)
        labelled = CURRENCY_LABEL.search(text)
        if labelled:
            return FieldValue(labelled.group("code").upper(), 0.97, "labelled")
        scores: dict[str, tuple[int, bool]] = {}
        for code, (code_pattern, symbol_pattern) in CURRENCY_SIGNALS.items():
            code_hits = len(code_pattern.findall(text))
            symbol_hits = len(symbol_pattern.findall(text))
            if code_hits or symbol_hits:
                scores[code] = (code_hits + symbol_hits, code_hits > 0)
        if not scores:
            return FieldValue("IDR", 0.4, "default")
        code, (hits, explicit) = max(scores.items(), key=lambda entry: entry[1][0])
        confidence = 0.92 if explicit else 0.85
        if len(scores) > 1:
            confidence -= 0.2
        return FieldValue(code, max(confidence, 0.3), f"{hits} occurrence(s)")

    def _totals(self) -> tuple[FieldValue[float], FieldValue[float], FieldValue[float], int | None]:
        subtotal: FieldValue[float] = FieldValue(None, 0.0)
        tax: FieldValue[float] = FieldValue(None, 0.0)
        total: FieldValue[float] = FieldValue(None, 0.0)
        first_index: int | None = None
        for index, line in enumerate(self.lines):
            values = amounts_in(line.text)
            if not values:
                continue
            amount = values[-1]
            source = f"line {index + 1}"
            if SUBTOTAL_LABEL.search(line.text):
                subtotal = FieldValue(amount, 0.93 * line.confidence, source)
            elif TAX_LABEL.search(line.text) and not TOTAL_LABEL.search(line.text):
                tax = FieldValue(amount, 0.9 * line.confidence, source)
            elif TOTAL_LABEL.search(line.text):
                total = FieldValue(amount, 0.95 * line.confidence, source)  # the last total line wins (grand total)
            else:
                continue
            first_index = index if first_index is None else min(first_index, index)
        return subtotal, tax, total, first_index

    def _items(self, totals_start: int | None) -> list[ParsedItem]:
        end = totals_start if totals_start is not None else len(self.lines)
        header = next(
            (
                index
                for index, line in enumerate(self.lines[:end])
                if TABLE_HEADER_DESC.search(line.text) and TABLE_HEADER_QTY.search(line.text) and not amounts_in(line.text)
            ),
            None,
        )
        start = header + 1 if header is not None else 0
        items: list[ParsedItem] = []
        for index in range(start, end):
            line = self.lines[index]
            if header is None and (DATE_LABEL.search(line.text) or any(p.search(line.text) for p in DOC_NUMBER_PATTERNS)):
                continue
            item = self._parse_row(line, index, allow_without_price=header is not None)
            if item:
                items.append(item)
            if len(items) >= 50:
                break
        return items

    def _parse_row(self, line: TextLine, index: int, allow_without_price: bool) -> ParsedItem | None:
        text = CURRENCY_NOISE.sub(" ", line.text)
        text = re.sub(r"\s+", " ", text).strip()
        source = f"line {index + 1}"
        match = ITEM_ROW.match(text)
        if match:
            quantity = parse_amount(match.group("qty"))
            unit_price = parse_amount(match.group("price"))
            line_total = parse_amount(match.group("total"))
            description = _clean_name(match.group("desc"))
            if quantity is None or unit_price is None or line_total is None or not description or quantity <= 0:
                return None
            consistent = _close(quantity * unit_price, line_total)
            base = (0.95 if consistent else 0.55) * line.confidence
            return ParsedItem(
                description=FieldValue(description, 0.9 * line.confidence, source),
                quantity=FieldValue(quantity, base, source),
                unit_price=FieldValue(unit_price, base, source),
                line_total=FieldValue(line_total, base, source),
                confidence=base,
            )
        if allow_without_price:
            match = ITEM_ROW_NO_PRICE.match(text)
            if match:
                quantity = parse_amount(match.group("qty"))
                line_total = parse_amount(match.group("total"))
                description = _clean_name(match.group("desc"))
                if quantity and line_total and description and quantity > 0:
                    confidence = 0.65 * line.confidence
                    return ParsedItem(
                        description=FieldValue(description, 0.85 * line.confidence, source),
                        quantity=FieldValue(quantity, confidence, source),
                        unit_price=FieldValue(round(line_total / quantity, 2), 0.6 * line.confidence, f"{source}: derived"),
                        line_total=FieldValue(line_total, confidence, source),
                        confidence=confidence,
                    )
        return None
