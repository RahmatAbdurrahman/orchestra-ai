"""OCR engines. Tesseract is the default (installed in the Docker image); PaddleOCR is optional."""

from __future__ import annotations

import shutil
from dataclasses import dataclass
from functools import lru_cache
from typing import Protocol

from PIL import Image, ImageOps


@dataclass(frozen=True)
class TextLine:
    text: str
    confidence: float  # 0..1


class OcrUnavailableError(RuntimeError):
    """Raised when a scanned document needs OCR but no OCR engine is installed."""


class OcrEngine(Protocol):
    name: str

    def recognize(self, image: Image.Image) -> list[TextLine]: ...


def _prepare(image: Image.Image) -> Image.Image:
    gray = ImageOps.grayscale(image)
    if max(gray.size) < 1500:  # upscale small scans for better recognition
        factor = 1500 / max(gray.size)
        gray = gray.resize((int(gray.width * factor), int(gray.height * factor)), Image.Resampling.LANCZOS)
    return ImageOps.autocontrast(gray)


class TesseractEngine:
    name = "tesseract"

    def __init__(self, languages: str) -> None:
        import pytesseract

        self._pytesseract = pytesseract
        available = set(pytesseract.get_languages(config=""))
        requested = [language for language in languages.split("+") if language in available]
        self.languages = "+".join(requested) or "eng"

    def recognize(self, image: Image.Image) -> list[TextLine]:
        data = self._pytesseract.image_to_data(
            _prepare(image),
            lang=self.languages,
            config="--psm 6",
            output_type=self._pytesseract.Output.DICT,
        )
        lines: dict[tuple[int, int, int], list[tuple[str, float]]] = {}
        for index, word in enumerate(data["text"]):
            word = word.strip()
            if not word:
                continue
            key = (data["block_num"][index], data["par_num"][index], data["line_num"][index])
            confidence = max(float(data["conf"][index]), 0.0) / 100.0
            lines.setdefault(key, []).append((word, confidence))
        result: list[TextLine] = []
        for key in sorted(lines):
            words = lines[key]
            result.append(
                TextLine(
                    text=" ".join(word for word, _ in words),
                    confidence=sum(confidence for _, confidence in words) / len(words),
                )
            )
        return result


class PaddleEngine:
    name = "paddle"

    def __init__(self) -> None:
        from paddleocr import PaddleOCR  # type: ignore[import-not-found]

        self._ocr = PaddleOCR(use_angle_cls=True, lang="en", show_log=False)

    def recognize(self, image: Image.Image) -> list[TextLine]:
        import numpy as np  # type: ignore[import-not-found]

        output = self._ocr.ocr(np.array(image.convert("RGB")), cls=True)
        boxes = output[0] or []
        # Sort boxes top-to-bottom, then merge boxes on the same visual line.
        boxes.sort(key=lambda box: (box[0][0][1], box[0][0][0]))
        lines: list[list[tuple[float, str, float]]] = []
        for box in boxes:
            top = box[0][0][1]
            text, confidence = box[1]
            if lines and abs(lines[-1][0][0] - top) < 12:
                lines[-1].append((top, text, confidence))
            else:
                lines.append([(top, text, confidence)])
        return [
            TextLine(
                text=" ".join(part[1] for part in line),
                confidence=sum(part[2] for part in line) / len(line),
            )
            for line in lines
        ]


def tesseract_available() -> bool:
    return shutil.which("tesseract") is not None


@lru_cache(maxsize=4)
def get_engine(name: str, languages: str) -> OcrEngine:
    if name == "paddle":
        try:
            return PaddleEngine()
        except Exception as error:  # pragma: no cover - optional dependency
            raise OcrUnavailableError(f"PaddleOCR is not available: {error}") from error
    if name == "tesseract":
        if not tesseract_available():
            raise OcrUnavailableError("Tesseract OCR is not installed; scanned documents cannot be read")
        return TesseractEngine(languages)
    raise OcrUnavailableError(f"OCR engine '{name}' is not supported (use tesseract or paddle)")
