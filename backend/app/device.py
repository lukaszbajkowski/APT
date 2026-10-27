"""Potwierdzenie podpisu blokadą urządzenia (Face ID / odcisk palca / PIN) przez WebAuthn.

Przeglądarka tworzy na telefonie poświadczenie z wymuszoną weryfikacją użytkownika
(userVerification = required); serwer sprawdza, że flaga „user verified” jest ustawiona.
To dowód, że podpis zatwierdził ktoś, kto potrafi odblokować to urządzenie – nie dowód tożsamości.
Poświadczenia nie są zapisywane do ponownego użycia, zostaje tylko identyfikator jako ślad w dzienniku.
"""

import base64
import json
import os
from urllib.parse import urlparse

from fastapi import HTTPException, Request, status
from webauthn import generate_registration_options, options_to_json, verify_registration_response
from webauthn.helpers.exceptions import InvalidAuthenticatorDataStructure, InvalidRegistrationResponse
from webauthn.helpers.structs import (
    AttestationConveyancePreference,
    AuthenticatorAttachment,
    AuthenticatorSelectionCriteria,
    ResidentKeyRequirement,
    UserVerificationRequirement,
)

from app.config import get_settings


def _b64(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode()


def _unb64(text: str) -> bytes:
    return base64.urlsafe_b64decode(text + "=" * (-len(text) % 4))


def rp_and_origin(request: Request) -> tuple[str, str]:
    """Domena (rp_id) z adresu aplikacji; origin z nagłówka przeglądarki, o ile dotyczy tej domeny."""
    public = urlparse(get_settings().public_url)
    rp_id = public.hostname or "localhost"
    origin = request.headers.get("origin")
    if origin:
        host = urlparse(origin).hostname
        if host != rp_id:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="Nieprawidłowy adres strony podpisu.")
        return rp_id, origin
    return rp_id, f"{public.scheme}://{public.netloc}"


def new_options(rp_id: str) -> tuple[dict, str]:
    """Opcje dla navigator.credentials.create() i wyzwanie (do zapisania przy podpisie)."""
    challenge = os.urandom(32)
    opts = generate_registration_options(
        rp_id=rp_id,
        rp_name="Identyfikacja pracowników APT",
        user_id=os.urandom(16),
        user_name="podpis",
        user_display_name="Podpis dokumentu",
        challenge=challenge,
        timeout=120_000,
        attestation=AttestationConveyancePreference.NONE,
        authenticator_selection=AuthenticatorSelectionCriteria(
            authenticator_attachment=AuthenticatorAttachment.PLATFORM,
            resident_key=ResidentKeyRequirement.DISCOURAGED,
            user_verification=UserVerificationRequirement.REQUIRED,
        ),
    )
    return json.loads(options_to_json(opts)), _b64(challenge)


def verify(credential: dict, challenge: str, rp_id: str, origin: str) -> str:
    """Sprawdza odpowiedź przeglądarki (z wymuszoną weryfikacją użytkownika); zwraca id poświadczenia."""
    try:
        result = verify_registration_response(
            credential=credential,
            expected_challenge=_unb64(challenge),
            expected_rp_id=rp_id,
            expected_origin=origin,
            require_user_verification=True,
        )
    except (
        InvalidRegistrationResponse,
        InvalidAuthenticatorDataStructure,
        ValueError,
        KeyError,
        TypeError,
    ) as exc:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            detail="Nie udało się potwierdzić blokadą urządzenia. Spróbuj jeszcze raz.",
        ) from exc
    return _b64(result.credential_id)
