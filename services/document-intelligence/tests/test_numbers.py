from datetime import date

import pytest

from app.extraction.numbers import amounts_in, find_date, parse_amount


@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        ("1.250.000", 1_250_000),
        ("1.250.000,50", 1_250_000.50),
        ("1,250,000.00", 1_250_000.00),
        ("750.000", 750_000),
        ("185.00", 185.00),
        ("12,5", 12.5),
        ("1,250", 1_250),
        ("Rp 2.664.000", 2_664_000),
        ("Rp750.000", 750_000),
        ("$185.00", 185.00),
        ("IDR 1.000", 1_000),
        ("-3.000", -3_000),
        ("abc", None),
        ("", None),
    ],
)
def test_parse_amount(raw, expected):
    assert parse_amount(raw) == expected


def test_amounts_in_ignores_percentages_and_document_numbers():
    assert amounts_in("PPN 11%   Rp 264.000") == [264_000]
    assert amounts_in("No. Invoice: INV/2026/11/0042") == []
    assert amounts_in("1  Laptop stand  2  pcs  750.000  1.500.000") == [1, 2, 750_000, 1_500_000]


@pytest.mark.parametrize(
    ("text", "expected", "ambiguous"),
    [
        ("Tanggal: 10 November 2026", date(2026, 11, 10), False),
        ("Invoice Date: November 12, 2026", date(2026, 11, 12), False),
        ("Date: 2026-11-05", date(2026, 11, 5), False),
        ("Tanggal 25/11/2026", date(2026, 11, 25), False),
        ("Tanggal 11/12/2026", date(2026, 12, 11), True),
        ("Tgl 3 Agt 2026", date(2026, 8, 3), False),
        ("Tanggal 9 Desember 2026", date(2026, 12, 9), False),
    ],
)
def test_find_date(text, expected, ambiguous):
    parsed = find_date(text)
    assert parsed is not None
    assert parsed.value == expected
    assert parsed.ambiguous is ambiguous


def test_find_date_rejects_invalid_dates():
    assert find_date("31/02/2026") is None
    assert find_date("no date here") is None
