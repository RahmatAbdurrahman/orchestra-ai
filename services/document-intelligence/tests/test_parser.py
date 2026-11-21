from app.extraction.ocr import TextLine
from app.extraction.parser import InvoiceParser


def lines(text: str, confidence: float = 0.99) -> list[TextLine]:
    return [TextLine(text=line, confidence=confidence) for line in text.strip("\n").splitlines()]


INDONESIAN_INVOICE = """
PT Sinar Jaya Abadi
Jl. Jend. Sudirman No. 45, Jakarta Selatan
FAKTUR / INVOICE
No. Invoice: INV/2026/11/0042
Tanggal: 10 November 2026
Jatuh Tempo: 10 Desember 2026
Kepada: PT Orchestra Demo Indonesia
No   Deskripsi                         Qty   Satuan   Harga Satuan   Jumlah
1    Laptop stand aluminium            2     pcs      750.000        1.500.000
2    Wireless keyboard and mouse set   2     set      450.000        900.000
                                                Subtotal       Rp 2.400.000
                                                PPN 11%        Rp 264.000
                                                Total          Rp 2.664.000
"""


def test_parses_an_indonesian_invoice():
    parsed = InvoiceParser(lines(INDONESIAN_INVOICE)).parse()
    assert parsed.supplier_name.value == "PT Sinar Jaya Abadi"
    assert parsed.document_number.value == "INV/2026/11/0042"
    assert parsed.document_date.value == "2026-11-10"
    assert parsed.currency.value == "IDR"
    assert parsed.subtotal.value == 2_400_000
    assert parsed.tax_amount.value == 264_000
    assert parsed.total_amount.value == 2_664_000
    assert [(item.description.value, item.quantity.value, item.unit_price.value, item.line_total.value) for item in parsed.items] == [
        ("Laptop stand aluminium", 2, 750_000, 1_500_000),
        ("Wireless keyboard and mouse set", 2, 450_000, 900_000),
    ]
    assert parsed.review_reasons == []
    assert all(item.confidence >= 0.9 for item in parsed.items)


def test_does_not_take_the_buyer_or_the_due_date():
    parsed = InvoiceParser(lines(INDONESIAN_INVOICE)).parse()
    assert "Orchestra" not in (parsed.supplier_name.value or "")
    assert parsed.document_date.value != "2026-12-10"


ENGLISH_INVOICE = """
Global Office Supplies Ltd
88 Market Street, Singapore 048948
INVOICE
Invoice No: GOS-2026-1187
Invoice Date: November 12, 2026
Due Date: December 12, 2026
Currency: USD
Bill To: PT Orchestra Demo Indonesia
No  Description              Qty  Unit  Unit Price  Amount
1   Ergonomic office chair   3    pcs   185.00      555.00
2   Dual monitor arm         3    pcs   65.00       195.00
                         Subtotal     $ 750.00
                         Tax          $ 0.00
                         Total Due    $ 750.00
"""


def test_parses_an_english_usd_invoice():
    parsed = InvoiceParser(lines(ENGLISH_INVOICE)).parse()
    assert parsed.supplier_name.value == "Global Office Supplies Ltd"
    assert parsed.document_number.value == "GOS-2026-1187"
    assert parsed.document_date.value == "2026-11-12"
    assert parsed.currency.value == "USD"
    assert parsed.currency.confidence >= 0.95
    assert parsed.total_amount.value == 750.0
    assert len(parsed.items) == 2
    assert parsed.items[0].unit_price.value == 185.0


def test_flags_inconsistent_totals_for_review():
    broken = INDONESIAN_INVOICE.replace("Rp 2.664.000", "Rp 2.964.000")
    parsed = InvoiceParser(lines(broken)).parse()
    assert parsed.total_amount.confidence <= 0.6
    assert any("does not match the total" in reason for reason in parsed.review_reasons)


def test_flags_line_items_that_do_not_add_up():
    broken = INDONESIAN_INVOICE.replace("Rp 2.400.000", "Rp 2.500.000")
    parsed = InvoiceParser(lines(broken)).parse()
    assert any("Line items add up" in reason for reason in parsed.review_reasons)
    assert all(item.confidence <= 0.6 for item in parsed.items)


def test_lowers_item_confidence_when_quantity_times_price_is_wrong():
    broken = INDONESIAN_INVOICE.replace("750.000        1.500.000", "750.000        1.400.000")
    parsed = InvoiceParser(lines(broken)).parse()
    assert parsed.items[0].confidence < 0.6


def test_propagates_ocr_confidence():
    parsed = InvoiceParser(lines(INDONESIAN_INVOICE, confidence=0.7)).parse()
    assert parsed.document_number.confidence < 0.7
    assert parsed.items[0].confidence < 0.7


def test_reports_missing_data_instead_of_guessing():
    parsed = InvoiceParser(lines("Some unrelated letter\nwithout any invoice data")).parse()
    assert parsed.document_number.value is None
    assert parsed.items == []
    assert parsed.total_amount.value is None
    assert "No line items could be read; enter them manually" in parsed.review_reasons
    assert parsed.currency.confidence < 0.5
