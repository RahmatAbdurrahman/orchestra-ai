"""Upload validation by content (magic bytes), never by the client supplied type."""

from __future__ import annotations

SIGNATURES: list[tuple[str, bytes]] = [
    ("application/pdf", b"%PDF-"),
    ("image/png", b"\x89PNG\r\n\x1a\n"),
    ("image/jpeg", b"\xff\xd8\xff"),
]


def sniff_mime_type(content: bytes) -> str | None:
    for mime_type, signature in SIGNATURES:
        if content.startswith(signature):
            return mime_type
    return None
