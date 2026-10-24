import os

# Ustawienia testowe muszą być ustawione przed importem aplikacji.
os.environ.setdefault("APT_DATABASE_URL", "postgresql+psycopg://apt:apt@localhost:5432/apt_test")
os.environ["APT_COOKIE_SECURE"] = "false"
os.environ.setdefault("APT_SECRET_KEY", "test-secret")
os.environ.setdefault("APT_DATA_KEY", "re3IC_kTb6y861Lgk6PnpjvG1Bn7WvZf0iOgw4oHYHE")
import tempfile  # noqa: E402

os.environ["APT_DATA_DIR"] = tempfile.mkdtemp(prefix="apt-test-")

from collections.abc import Callable, Iterator  # noqa: E402
from datetime import date  # noqa: E402

import pytest  # noqa: E402
from alembic import command  # noqa: E402
from alembic.config import Config  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402
from sqlalchemy import text  # noqa: E402

from app.db import SessionLocal, engine  # noqa: E402
from app.main import app  # noqa: E402
from app.models import Role, User  # noqa: E402
from app.security import hash_password  # noqa: E402

BACKEND_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PASSWORD = "Bezpieczne-Haslo-123"


@pytest.fixture(scope="session", autouse=True)
def _migrate() -> None:
    cfg = Config(os.path.join(BACKEND_DIR, "alembic.ini"))
    cfg.set_main_option("script_location", os.path.join(BACKEND_DIR, "alembic"))
    command.downgrade(cfg, "base")
    command.upgrade(cfg, "head")


@pytest.fixture(autouse=True)
def _clean_db() -> Iterator[None]:
    yield
    with engine.begin() as conn:
        conn.execute(
            text(
                "TRUNCATE audit_log, user_sessions, user_scopes, users, documents, templates, photos, "
                "employees, positions, agencies, departments RESTART IDENTITY CASCADE"
            )
        )
        conn.execute(text("DELETE FROM countries WHERE name LIKE 'Test%'"))
        conn.execute(text("UPDATE countries SET is_active = true"))


@pytest.fixture
def client() -> TestClient:
    return TestClient(app)


@pytest.fixture
def make_user() -> Callable[..., User]:
    def _make(
        username: str = "jan",
        role: Role = Role.admin,
        password: str = PASSWORD,
        must_change_password: bool = False,
        is_active: bool = True,
    ) -> User:
        with SessionLocal() as db:
            user = User(
                username=username,
                full_name=username.capitalize() + " Testowy",
                role=role,
                password_hash=hash_password(password),
                is_active=is_active,
                must_change_password=must_change_password,
                failed_login_count=0,
            )
            db.add(user)
            db.commit()
            db.refresh(user)
            return user

    return _make


def login(client: TestClient, username: str, password: str = PASSWORD) -> dict:
    """Loguje i ustawia nagłówek CSRF na kliencie. Zwraca odpowiedź /login."""
    r = client.post("/api/auth/login", json={"username": username, "password": password})
    assert r.status_code == 200, r.text
    body = r.json()
    client.headers["X-CSRF-Token"] = body["csrf_token"]
    return body


@pytest.fixture
def admin_client(client: TestClient, make_user: Callable[..., User]) -> TestClient:
    make_user("admin", Role.admin)
    login(client, "admin")
    return client


def make_pesel(born: "date", sex: str, serial: int = 123) -> str:
    """Buduje poprawny PESEL dla podanej daty urodzenia i płci (K/M)."""
    from app.pesel import WEIGHTS

    offset = {1800: 80, 1900: 0, 2000: 20, 2100: 40, 2200: 60}[born.year // 100 * 100]
    base = f"{born.year % 100:02d}{born.month + offset:02d}{born.day:02d}{serial:03d}"
    sex_digit = 0 if sex == "K" else 1
    digits = [int(c) for c in base] + [sex_digit]
    check = (10 - sum(d * w for d, w in zip(digits, WEIGHTS, strict=True)) % 10) % 10
    return base + str(sex_digit) + str(check)
