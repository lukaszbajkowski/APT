from datetime import date

import pytest

from app import crypto
from app.pesel import PeselError, parse
from tests.conftest import make_pesel


@pytest.mark.parametrize(
    ("born", "sex"),
    [
        (date(1990, 1, 1), "M"),
        (date(2003, 12, 31), "K"),
        (date(1899, 6, 15), "K"),
        (date(2024, 2, 29), "M"),
    ],
)
def test_parse_roundtrip(born, sex):
    info = parse(make_pesel(born, sex))
    assert info.birth_date == born
    assert info.sex == sex


def test_known_example():
    info = parse("44051401359")
    assert info.birth_date == date(1944, 5, 14)
    assert info.sex == "M"


@pytest.mark.parametrize(
    ("value", "message"),
    [
        ("123", "11 cyfr"),
        ("4405140135a", "11 cyfr"),
        ("44051401358", "kontrolna"),
        ("44023001356", "data"),  # 30 lutego
    ],
)
def test_invalid(value, message):
    with pytest.raises(PeselError, match=message):
        parse(value)


def test_spaces_are_ignored():
    assert parse(" 440514 01359 ").birth_date == date(1944, 5, 14)


def test_encryption_roundtrip_and_randomness():
    a = crypto.encrypt("44051401359")
    b = crypto.encrypt("44051401359")
    assert a != b  # losowy nonce
    assert b"44051401359" not in a
    assert crypto.decrypt(a) == "44051401359"
    assert crypto.blind_index("44051401359") == crypto.blind_index("44051401359")
    assert len(crypto.blind_index("44051401359")) == 64


def test_tampered_ciphertext_rejected():
    blob = bytearray(crypto.encrypt("44051401359"))
    blob[-1] ^= 1
    with pytest.raises(Exception):  # noqa: B017
        crypto.decrypt(bytes(blob))
