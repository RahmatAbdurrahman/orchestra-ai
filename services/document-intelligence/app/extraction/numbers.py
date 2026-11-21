"""Locale tolerant parsing of amounts and dates found on Indonesian and English invoices."""

from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import date

AMOUNT_TOKEN = re.compile(
    r"(?<![\w.,/\-])-?(?:\d{1,3}(?:[.,]\d{3})+(?:[.,]\d{1,2})?|\d+(?:[.,]\d{1,2})?)(?![\w%/])"
)
CURRENCY_NOISE = re.compile(r"(?i)\b(?:rp|idr|usd|sgd|eur)(?=[\s.:\d]|$)\.?|us\$|[$€]")


def parse_amount(raw: str) -> float | None:
    """Parses '1.250.000', '1,250,000.00', '1.250.000,50', 'Rp 750.000', '$185.00'."""
    text = CURRENCY_NOISE.sub("", raw).strip().replace(" ", "")
    if not text or not re.fullmatch(r"-?[\d.,]+", text):
        return None
    negative = text.startswith("-")
    text = text.lstrip("-")
    if "." in text and "," in text:
        decimal = "." if text.rfind(".") > text.rfind(",") else ","
        thousands = "," if decimal == "." else "."
        text = text.replace(thousands, "").replace(decimal, ".")
    elif "." in text or "," in text:
        separator = "." if "." in text else ","
        parts = text.split(separator)
        if len(parts) > 2 or len(parts[-1]) == 3:
            text = "".join(parts)  # thousands separators
        else:
            text = ".".join(parts)  # decimal separator
    try:
        value = float(text)
    except ValueError:
        return None
    return -value if negative else value


def amounts_in(line: str) -> list[float]:
    """All amount-like tokens in a line, left to right."""
    cleaned = CURRENCY_NOISE.sub(" ", line)
    values: list[float] = []
    for match in AMOUNT_TOKEN.finditer(cleaned):
        value = parse_amount(match.group(0))
        if value is not None:
            values.append(value)
    return values


MONTHS = {
    "januari": 1, "january": 1, "jan": 1,
    "februari": 2, "february": 2, "feb": 2, "pebruari": 2,
    "maret": 3, "march": 3, "mar": 3,
    "april": 4, "apr": 4,
    "mei": 5, "may": 5,
    "juni": 6, "june": 6, "jun": 6,
    "juli": 7, "july": 7, "jul": 7,
    "agustus": 8, "august": 8, "aug": 8, "agu": 8, "agt": 8,
    "september": 9, "sep": 9, "sept": 9,
    "oktober": 10, "october": 10, "oct": 10, "okt": 10,
    "november": 11, "nov": 11, "nopember": 11,
    "desember": 12, "december": 12, "dec": 12, "des": 12,
}

_MONTH_NAMES = "|".join(sorted(MONTHS, key=len, reverse=True))
DATE_PATTERNS = [
    ("iso", re.compile(r"\b(\d{4})-(\d{1,2})-(\d{1,2})\b")),
    ("dmy_name", re.compile(rf"\b(\d{{1,2}})\s+({_MONTH_NAMES})\.?\s+(\d{{4}})\b", re.IGNORECASE)),
    ("mdy_name", re.compile(rf"\b({_MONTH_NAMES})\.?\s+(\d{{1,2}}),?\s+(\d{{4}})\b", re.IGNORECASE)),
    ("numeric", re.compile(r"\b(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{4})\b")),
]


@dataclass(frozen=True)
class ParsedDate:
    value: date
    ambiguous: bool
    raw: str


def find_date(text: str) -> ParsedDate | None:
    """Finds the first date in the text. Numeric dates are read as DD/MM/YYYY (Indonesian convention)."""
    best: tuple[int, ParsedDate] | None = None
    for kind, pattern in DATE_PATTERNS:
        for match in pattern.finditer(text):
            parsed = _to_date(kind, match.groups())
            if parsed is None:
                continue
            candidate = ParsedDate(value=parsed[0], ambiguous=parsed[1], raw=match.group(0))
            if best is None or match.start() < best[0]:
                best = (match.start(), candidate)
    return best[1] if best else None


def _to_date(kind: str, groups: tuple[str, ...]) -> tuple[date, bool] | None:
    try:
        if kind == "iso":
            return date(int(groups[0]), int(groups[1]), int(groups[2])), False
        if kind == "dmy_name":
            return date(int(groups[2]), MONTHS[groups[1].lower()], int(groups[0])), False
        if kind == "mdy_name":
            return date(int(groups[2]), MONTHS[groups[0].lower()], int(groups[1])), False
        first, second, year = int(groups[0]), int(groups[1]), int(groups[2])
        if first > 12:
            return date(year, second, first), False
        if second > 12:
            return date(year, first, second), False  # clearly MM/DD
        return date(year, second, first), first != second  # assume DD/MM, flag ambiguity
    except (ValueError, KeyError):
        return None
