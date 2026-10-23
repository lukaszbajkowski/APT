import hashlib
import secrets

from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError, VerifyMismatchError

from app.config import get_settings

_hasher = PasswordHasher()

# Hash "pustego" hasła, żeby logowanie na nieistniejący login trwało tyle samo
# co na istniejący (utrudnia zgadywanie loginów po czasie odpowiedzi).
_DUMMY_HASH = _hasher.hash(secrets.token_urlsafe(16))


def hash_password(password: str) -> str:
    return _hasher.hash(password)


def verify_password(password_hash: str | None, password: str) -> bool:
    try:
        return _hasher.verify(password_hash or _DUMMY_HASH, password) and password_hash is not None
    except (VerifyMismatchError, VerificationError, InvalidHashError):
        return False


def password_needs_rehash(password_hash: str) -> bool:
    return _hasher.check_needs_rehash(password_hash)


def password_problems(password: str, username: str | None = None) -> list[str]:
    """Zwraca listę problemów z hasłem (pusta lista = hasło w porządku)."""
    settings = get_settings()
    problems: list[str] = []
    if len(password) < settings.password_min_length:
        problems.append(f"Hasło musi mieć co najmniej {settings.password_min_length} znaków.")
    if len(password) > 256:
        problems.append("Hasło może mieć najwyżej 256 znaków.")
    classes = sum(
        [
            any(c.islower() for c in password),
            any(c.isupper() for c in password),
            any(c.isdigit() for c in password),
            any(not c.isalnum() for c in password),
        ]
    )
    if classes < 3:
        problems.append(
            "Hasło musi zawierać znaki z co najmniej 3 grup: małe litery, wielkie litery, "
            "cyfry, znaki specjalne."
        )
    if username and username.lower() in password.lower():
        problems.append("Hasło nie może zawierać loginu.")
    return problems


def new_token() -> str:
    return secrets.token_urlsafe(32)


def token_hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def generate_temporary_password() -> str:
    """Hasło tymczasowe po resecie przez administratora (spełnia politykę haseł)."""
    alphabet_lower = "abcdefghijkmnopqrstuvwxyz"
    alphabet_upper = "ABCDEFGHJKLMNPQRSTUVWXYZ"
    digits = "23456789"
    symbols = "-_!?#"
    every = alphabet_lower + alphabet_upper + digits + symbols
    chars = [
        secrets.choice(alphabet_lower),
        secrets.choice(alphabet_upper),
        secrets.choice(digits),
        secrets.choice(symbols),
    ] + [secrets.choice(every) for _ in range(12)]
    secrets.SystemRandom().shuffle(chars)
    return "".join(chars)
