import logging

from fastapi import FastAPI
from sqlalchemy import text

from app import hardening
from app.config import get_settings
from app.deps import DbSession
from app.routers import (
    access_review,
    agency_portal,
    agency_reports,
    audit_log,
    auth,
    cards,
    competence,
    dashboard,
    data_link,
    dictionaries,
    documents,
    employees,
    hr_messages,
    i18n,
    imports,
    lifecycle,
    me,
    me_signatures,
    passkeys,
    push,
    quality,
    reports,
    retention,
    signatures,
    training_import,
    trainings,
    translate,
    users,
)

_settings = get_settings()
app = FastAPI(
    title="Identyfikacja pracowników APT",
    version="0.1.0",
    docs_url="/api/docs" if _settings.enable_docs else None,
    redoc_url=None,
    openapi_url="/api/openapi.json" if _settings.enable_docs else None,
)


hardening.install_log_filter()
app.middleware("http")(hardening.sign_rate_limit)


@app.on_event("startup")
def _check_secrets() -> None:
    """Ostrzeżenie w logach, gdy na serwerze klucz jest domyślny lub krótki (nie blokuje startu)."""
    s = get_settings()
    if s.cookie_secure and (s.secret_key == "dev-only-change-me" or len(s.secret_key) < 32):
        logging.getLogger("uvicorn.error").error(
            "APT_SECRET_KEY jest pusty, domyślny albo krótszy niż 32 znaki – ustaw długi losowy klucz w .env."
        )


@app.on_event("startup")
def _apply_planned_changes() -> None:
    """Zaległe zaplanowane zmiany (np. gdy serwer był wyłączony w nocy, gdy działa zadanie dzienne)."""
    from app import lifecycle
    from app.db import SessionLocal

    try:
        with SessionLocal() as db:
            lifecycle.apply_due_changes(db)
    except Exception:  # noqa: BLE001 – start aplikacji nie może zależeć od tego kroku (np. przed migracją)
        pass


app.include_router(auth.router)
app.include_router(passkeys.router)
app.include_router(me.router)
app.include_router(me_signatures.router)
app.include_router(data_link.staff_router)
app.include_router(data_link.public_router)
app.include_router(hr_messages.me_router)
app.include_router(hr_messages.staff_router)
app.include_router(users.router)
app.include_router(dictionaries.router)
app.include_router(audit_log.router)
app.include_router(employees.router)
app.include_router(imports.router)
app.include_router(cards.router)
app.include_router(documents.router)
app.include_router(push.router)
app.include_router(i18n.router)
app.include_router(translate.router)
app.include_router(access_review.router)
app.include_router(dashboard.router)
app.include_router(retention.router)
app.include_router(reports.router)
app.include_router(quality.router)
app.include_router(trainings.router)
app.include_router(competence.router)
app.include_router(lifecycle.router)
app.include_router(signatures.router)
app.include_router(training_import.router)
app.include_router(agency_reports.router)
app.include_router(agency_portal.router)


@app.get("/api/health", tags=["system"])
def health(db: DbSession) -> dict[str, str]:
    db.execute(text("SELECT 1"))
    return {"status": "ok"}
