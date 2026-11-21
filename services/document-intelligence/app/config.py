"""Environment based configuration."""

from __future__ import annotations

import os
from dataclasses import dataclass, field


def _env_float(name: str, default: float) -> float:
    raw = os.getenv(name)
    return float(raw) if raw else default


def _env_int(name: str, default: int) -> int:
    raw = os.getenv(name)
    return int(raw) if raw else default


@dataclass(frozen=True)
class Settings:
    internal_token: str = field(default_factory=lambda: os.getenv("DOCUMENT_INTELLIGENCE_TOKEN", ""))
    max_file_mb: int = field(default_factory=lambda: _env_int("DI_MAX_FILE_MB", 15))
    max_pages: int = field(default_factory=lambda: _env_int("DI_MAX_PAGES", 10))
    review_threshold: float = field(default_factory=lambda: _env_float("DI_REVIEW_THRESHOLD", 0.85))
    ocr_engine: str = field(default_factory=lambda: os.getenv("OCR_ENGINE", "tesseract").lower())
    ocr_languages: str = field(default_factory=lambda: os.getenv("OCR_LANGUAGES", "eng+ind"))
    ocr_dpi: int = field(default_factory=lambda: _env_int("OCR_DPI", 300))

    @property
    def max_file_bytes(self) -> int:
        return self.max_file_mb * 1024 * 1024


def get_settings() -> Settings:
    return Settings()
