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


@lru_cache
def get_settings() -> Settings:
    return Settings()
