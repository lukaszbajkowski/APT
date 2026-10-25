from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="APT_", env_file=".env", extra="ignore")

    database_url: str = "postgresql+psycopg://apt:apt@localhost:5432/apt"
    secret_key: str = "dev-only-change-me"

    cookie_secure: bool = True
    session_cookie_name: str = "apt_session"
    csrf_header_name: str = "X-CSRF-Token"

    session_idle_minutes: int = 30
    session_max_hours: int = 12

    login_max_failures: int = 5
    login_lock_minutes: int = 15

    password_min_length: int = 12

    # Logowanie dwuetapowe obowiązkowe dla Administratora i Kadr.
    # Wyłączać tylko w testach / lokalnie.
    mfa_enforce: bool = True

    # Retencja: dane zwolnionego pracownika przechowujemy tyle lat, licząc od końca roku
    # kalendarzowego, w którym nastąpiło zwolnienie. Potem administrator usuwa je trwale.
    retention_years: int = 10

    # E-mail (SMTP), np. konto pocztowe w hostingu. Puste smtp_host = wysyłka wyłączona.
    smtp_host: str = ""
    smtp_port: int = 465
    smtp_security: str = "ssl"  # ssl (port 465) | starttls (port 587) | none
    smtp_user: str = ""
    smtp_password: str = ""
    mail_from: str = ""  # np. "Identyfikacja APT <powiadomienia@aptid.pl>"
    # Adres aplikacji do linków w e-mailach, np. https://aptid.pl
    public_url: str = "http://localhost"

    # Klucz do szyfrowania danych wrażliwych (PESEL): 32 bajty w base64url.
    # Trzymany poza bazą danych. Wygeneruj: python -m app.cli generate-key
    data_key: str = ""

    # Katalog na pliki (zdjęcia). W Dockerze: wolumen /app/data.
    data_dir: str = "./data"
    photo_max_upload_mb: int = 10


@lru_cache
def get_settings() -> Settings:
    return Settings()
