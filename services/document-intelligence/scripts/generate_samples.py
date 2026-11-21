"""Writes the synthetic sample invoices to <repo>/samples/invoices.

Usage (from services/document-intelligence):  python -m scripts.generate_samples
"""

from __future__ import annotations

from pathlib import Path

from tools.invoice_factory import SAMPLE_INVOICES, SCANNED_SAMPLE, render_pdf, render_png

OUTPUT = Path(__file__).resolve().parents[3] / "samples" / "invoices"


def main() -> None:
    OUTPUT.mkdir(parents=True, exist_ok=True)
    for spec in SAMPLE_INVOICES:
        target = OUTPUT / f"{spec.file_stem}.pdf"
        target.write_bytes(render_pdf(spec))
        print(f"wrote {target.name}: total {spec.currency} {spec.total:,.2f}")
    target = OUTPUT / f"{SCANNED_SAMPLE.file_stem}.png"
    target.write_bytes(render_png(SCANNED_SAMPLE))
    print(f"wrote {target.name}: total {SCANNED_SAMPLE.currency} {SCANNED_SAMPLE.total:,.2f} (requires OCR)")


if __name__ == "__main__":
    main()
