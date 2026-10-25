import pytest

from app.masks import MaskError, apply_mask, format_value, guess_format


def test_apply_mask():
    assert apply_mask("50001", "99-999") == "50-001"
    assert apply_mask("50-001", "99-999") == "50-001"
    assert apply_mask("abc 123456", "AAA 999999") == "ABC 123456"
    for bad in ("5000", "500011", "5a001"):
        with pytest.raises(MaskError):
            apply_mask(bad, "99-999")


def test_checksums():
    assert format_value("526-025-02-74", "nip", None) == "526-025-02-74"
    with pytest.raises(MaskError):
        format_value("5260250275", "nip", None)
    assert format_value("pl61109010140000071219812874", "iban", None).startswith("61 1090")
    with pytest.raises(MaskError):
        format_value("jan@", "email", None)
    assert format_value("Jan@Firma.pl", "email", None) == "Jan@Firma.pl"


def test_guess():
    assert [guess_format(k) for k in ("zam_kod", "kor_kod", "tel_dom", "email", "nip_firmy", "miasto")] == [
        "postal",
        "postal",
        "phone",
        "email",
        "nip",
        None,
    ]
