"""API and end-to-end pipeline tests on generated PDF invoices (PDF text layer path)."""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from app.extraction.ocr import tesseract_available
from app.main import create_app
from tools.invoice_factory import SAMPLE_INVOICES, SCANNED_SAMPLE, render_pdf, render_png

TOKEN = "test-internal-token-123"


@pytest.fixture()
def client(monkeypatch):
    monkeypatch.setenv("DOCUMENT_INTELLIGENCE_TOKEN", TOKEN)
    return TestClient(create_app())


def post(client: TestClient, content: bytes, name: str = "invoice.pdf", token: str | None = TOKEN):
    headers = {"X-Internal-Token": token} if token else {}
    return client.post("/v1/extract", files={"file": (name, content, "application/octet-stream")}, headers=headers)


def test_health(client):
    body = client.get("/health").json()
    assert body["status"] == "ok"
    assert body["pdfTextLayer"] is True


def test_requires_the_internal_token(client):
    pdf = render_pdf(SAMPLE_INVOICES[0])
    assert post(client, pdf, token=None).status_code == 401
    assert post(client, pdf, token="wrong-token").status_code == 401


def test_rejects_unsupported_and_empty_files(client):
    assert post(client, b"").status_code == 400
    assert post(client, b"<html>not a pdf</html>", name="invoice.pdf").status_code == 415


def test_rejects_corrupt_pdfs(client):
    response = post(client, b"%PDF-1.7\n this is not really a pdf")
    assert response.status_code == 422


@pytest.mark.parametrize("spec", SAMPLE_INVOICES, ids=lambda spec: spec.file_stem)
def test_extracts_generated_invoices(client, spec):
    response = post(client, render_pdf(spec))
    assert response.status_code == 200, response.text
    body = response.json()
    fields = body["fields"]
    assert body["extractionMethod"] == "PDF_TEXT"
    assert fields["supplierName"]["value"] == spec.supplier
    assert fields["documentNumber"]["value"] == spec.number
    assert fields["currency"]["value"] == spec.currency
    assert fields["totalAmount"]["value"] == pytest.approx(spec.total)
    assert fields["subtotal"]["value"] == pytest.approx(spec.subtotal)
    assert fields["taxAmount"]["value"] == pytest.approx(spec.tax)
    assert len(body["items"]) == len(spec.items)
    for extracted, expected in zip(body["items"], spec.items):
        assert extracted["description"]["value"] == expected.description
        assert extracted["quantity"]["value"] == expected.quantity
        assert extracted["unitPrice"]["value"] == pytest.approx(expected.unit_price)
    assert body["overallConfidence"] >= 0.85
    assert body["reviewReasons"] == []


def test_ambiguous_numeric_dates_are_flagged(client):
    spec = next(spec for spec in SAMPLE_INVOICES if spec.date_text == "11/11/2026")
    body = post(client, render_pdf(spec)).json()
    # 11/11 is unambiguous because day == month; still parsed as DD/MM.
    assert body["fields"]["documentDate"]["value"] == "2026-11-11"


@pytest.mark.skipif(not tesseract_available(), reason="Tesseract OCR is not installed")
def test_ocr_path_on_scanned_image(client):
    response = post(client, render_png(SCANNED_SAMPLE), name="scan.png")
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["extractionMethod"] == "OCR"
    assert body["fields"]["totalAmount"]["value"] == pytest.approx(SCANNED_SAMPLE.total)


@pytest.mark.skipif(tesseract_available(), reason="Only relevant when Tesseract is missing")
def test_scanned_image_without_ocr_engine_is_unprocessable(client):
    response = post(client, render_png(SCANNED_SAMPLE), name="scan.png")
    assert response.status_code == 422
    assert "Tesseract" in response.json()["detail"]
