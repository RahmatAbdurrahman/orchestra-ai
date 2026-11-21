"""Synthetic supplier invoices for demos and tests (no real company data).

Suppliers match the Orchestra seed data so the demo flow auto-matches the
supplier master. Amounts are chosen to exercise both approval routes.
"""

from __future__ import annotations

from dataclasses import dataclass, field

BUYER = "PT Orchestra Demo Indonesia"


@dataclass(frozen=True)
class InvoiceItem:
    description: str
    quantity: int
    unit: str
    unit_price: float


@dataclass(frozen=True)
class InvoiceSpec:
    file_stem: str
    language: str  # "id" | "en"
    supplier: str
    supplier_address: str
    number: str
    date_text: str
    due_date_text: str
    currency: str  # IDR | USD
    items: list[InvoiceItem] = field(default_factory=list)
    tax_rate: float = 0.11

    @property
    def subtotal(self) -> float:
        return round(sum(item.quantity * item.unit_price for item in self.items), 2)

    @property
    def tax(self) -> float:
        return round(self.subtotal * self.tax_rate, 2)

    @property
    def total(self) -> float:
        return round(self.subtotal + self.tax, 2)


def money(value: float, currency: str) -> str:
    if currency == "IDR":
        whole, cents = f"{value:,.2f}".split(".")
        text = whole.replace(",", ".")
        return text if cents == "00" else f"{text},{cents}"
    return f"{value:,.2f}"


SAMPLE_INVOICES: list[InvoiceSpec] = [
    InvoiceSpec(
        file_stem="invoice-sinar-jaya-idr",
        language="id",
        supplier="PT Sinar Jaya Abadi",
        supplier_address="Jl. Jend. Sudirman No. 45, Jakarta Selatan",
        number="INV/2026/11/0042",
        date_text="10 November 2026",
        due_date_text="10 Desember 2026",
        currency="IDR",
        items=[
            InvoiceItem("Laptop stand aluminium", 2, "pcs", 750_000),
            InvoiceItem("Wireless keyboard and mouse set", 2, "set", 450_000),
        ],
    ),
    InvoiceSpec(
        file_stem="invoice-teknologi-nusantara-idr",
        language="id",
        supplier="PT Teknologi Nusantara",
        supplier_address="Jl. Gatot Subroto Kav. 12, Bandung",
        number="TN-INV-2026-0318",
        date_text="11/11/2026",
        due_date_text="11/12/2026",
        currency="IDR",
        items=[
            InvoiceItem("Engineering workstation i7 32GB", 2, "unit", 3_500_000),
            InvoiceItem("Monitor 27 inch QHD", 2, "unit", 2_250_000),
        ],
    ),
    InvoiceSpec(
        file_stem="invoice-global-office-usd",
        language="en",
        supplier="Global Office Supplies Ltd",
        supplier_address="88 Market Street, Singapore 048948",
        number="GOS-2026-1187",
        date_text="November 12, 2026",
        due_date_text="December 12, 2026",
        currency="USD",
        tax_rate=0.0,
        items=[
            InvoiceItem("Ergonomic office chair", 3, "pcs", 185.00),
            InvoiceItem("Dual monitor arm", 3, "pcs", 65.00),
        ],
    ),
    InvoiceSpec(
        file_stem="invoice-mitra-lama-blocked-supplier",
        language="id",
        supplier="PT Mitra Lama Sentosa",
        supplier_address="Jl. Pemuda No. 7, Surabaya",
        number="MLS/INV/2026/077",
        date_text="9 November 2026",
        due_date_text="9 Desember 2026",
        currency="IDR",
        items=[InvoiceItem("Office cleaning service (monthly)", 1, "job", 2_500_000)],
    ),
]

SCANNED_SAMPLE = InvoiceSpec(
    file_stem="invoice-maju-bersama-scan",
    language="id",
    supplier="CV Maju Bersama",
    supplier_address="Jl. Diponegoro No. 18, Semarang",
    number="MB-2026-1102",
    date_text="12 November 2026",
    due_date_text="26 November 2026",
    currency="IDR",
    items=[
        InvoiceItem("Kertas A4 80gsm", 10, "rim", 55_000),
        InvoiceItem("Tinta printer hitam", 4, "pcs", 125_000),
    ],
)


def _labels(spec: InvoiceSpec) -> dict[str, str]:
    if spec.language == "id":
        return {
            "title": "FAKTUR / INVOICE",
            "number": "No. Invoice",
            "date": "Tanggal",
            "due": "Jatuh Tempo",
            "buyer": "Kepada",
            "currency": "Mata Uang",
            "headers": "No|Deskripsi|Qty|Satuan|Harga Satuan|Jumlah",
            "subtotal": "Subtotal",
            "tax": f"PPN {int(spec.tax_rate * 100)}%",
            "total": "Total",
        }
    return {
        "title": "INVOICE",
        "number": "Invoice No",
        "date": "Invoice Date",
        "due": "Due Date",
        "buyer": "Bill To",
        "currency": "Currency",
        "headers": "No|Description|Qty|Unit|Unit Price|Amount",
        "subtotal": "Subtotal",
        "tax": "Tax",
        "total": "Total Due",
    }


def render_pdf(spec: InvoiceSpec) -> bytes:
    from fpdf import FPDF
    from fpdf.enums import XPos, YPos

    labels = _labels(spec)
    symbol = "Rp" if spec.currency == "IDR" else "$"
    pdf = FPDF(format="A4")
    pdf.set_auto_page_break(auto=True, margin=15)
    pdf.add_page()
    line = {"new_x": XPos.LMARGIN, "new_y": YPos.NEXT}

    pdf.set_font("Helvetica", "B", 16)
    pdf.cell(0, 9, spec.supplier, **line)
    pdf.set_font("Helvetica", "", 9)
    pdf.cell(0, 5, spec.supplier_address, **line)
    pdf.ln(4)
    pdf.set_font("Helvetica", "B", 14)
    pdf.cell(0, 9, labels["title"], **line)
    pdf.set_font("Helvetica", "", 10)
    pdf.cell(0, 6, f"{labels['number']}: {spec.number}", **line)
    pdf.cell(0, 6, f"{labels['date']}: {spec.date_text}", **line)
    pdf.cell(0, 6, f"{labels['due']}: {spec.due_date_text}", **line)
    pdf.cell(0, 6, f"{labels['currency']}: {spec.currency}", **line)
    pdf.cell(0, 6, f"{labels['buyer']}: {BUYER}", **line)
    pdf.ln(4)

    widths = [10, 78, 14, 18, 34, 36]
    pdf.set_font("Helvetica", "B", 9)
    for width, header in zip(widths, labels["headers"].split("|")):
        pdf.cell(width, 7, header, border=1, align="C")
    pdf.ln()
    pdf.set_font("Helvetica", "", 9)
    for number, item in enumerate(spec.items, start=1):
        cells = [
            (str(number), "C"),
            (item.description, "L"),
            (str(item.quantity), "C"),
            (item.unit, "C"),
            (money(item.unit_price, spec.currency), "R"),
            (money(item.quantity * item.unit_price, spec.currency), "R"),
        ]
        for width, (text, align) in zip(widths, cells):
            pdf.cell(width, 7, text, border=1, align=align)
        pdf.ln()
    pdf.ln(3)
    for label, value in (
        (labels["subtotal"], spec.subtotal),
        (labels["tax"], spec.tax),
        (labels["total"], spec.total),
    ):
        pdf.set_font("Helvetica", "B" if label == labels["total"] else "", 10)
        pdf.cell(120, 6, "")
        pdf.cell(34, 6, label)
        pdf.cell(36, 6, f"{symbol} {money(value, spec.currency)}", align="R", **line)
    pdf.ln(8)
    pdf.set_font("Helvetica", "I", 8)
    pdf.cell(0, 5, "Synthetic document generated for Orchestra AI demos and tests.", **line)
    return bytes(pdf.output())


def render_png(spec: InvoiceSpec) -> bytes:
    """A 'scanned' invoice image (no text layer) for the OCR path."""
    import io

    from PIL import Image, ImageDraw, ImageFont

    labels = _labels(spec)
    image = Image.new("RGB", (1700, 2200), "white")
    draw = ImageDraw.Draw(image)
    font = ImageFont.load_default(size=34)
    bold = ImageFont.load_default(size=44)
    y = 80

    def write(text: str, x: int = 100, use: ImageFont.ImageFont = font, step: int = 56) -> None:
        nonlocal y
        draw.text((x, y), text, fill="black", font=use)
        y += step

    write(spec.supplier, use=bold, step=70)
    write(spec.supplier_address)
    y += 30
    write(labels["title"], use=bold, step=70)
    write(f"{labels['number']}: {spec.number}")
    write(f"{labels['date']}: {spec.date_text}")
    write(f"{labels['due']}: {spec.due_date_text}")
    write(f"{labels['buyer']}: {BUYER}")
    y += 30
    columns = [100, 170, 830, 960, 1150, 1420]
    for x, header in zip(columns, labels["headers"].split("|")):
        draw.text((x, y), header, fill="black", font=font)
    y += 64
    for number, item in enumerate(spec.items, start=1):
        values = [
            str(number),
            item.description,
            str(item.quantity),
            item.unit,
            money(item.unit_price, spec.currency),
            money(item.quantity * item.unit_price, spec.currency),
        ]
        for x, value in zip(columns, values):
            draw.text((x, y), value, fill="black", font=font)
        y += 60
    y += 40
    for label, value in ((labels["subtotal"], spec.subtotal), (labels["tax"], spec.tax), (labels["total"], spec.total)):
        draw.text((960, y), label, fill="black", font=font)
        draw.text((1300, y), f"Rp {money(value, spec.currency)}", fill="black", font=font)
        y += 60
    buffer = io.BytesIO()
    image.save(buffer, format="PNG")
    return buffer.getvalue()
