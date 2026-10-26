from fastapi import FastAPI
from sqlalchemy import text

from app.deps import DbSession
from app.routers import (
    audit_log,
    auth,
    cards,
    competence,
    dashboard,
    dictionaries,
    documents,
    employees,
    imports,
    lifecycle,
    quality,
    reports,
    retention,
    training_import,
    trainings,
    users,
)

app = FastAPI(
    title="Identyfikacja pracowników APT",
    version="0.1.0",
    docs_url="/api/docs",
    redoc_url=None,
    openapi_url="/api/openapi.json",
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
app.include_router(users.router)
app.include_router(dictionaries.router)
app.include_router(audit_log.router)
app.include_router(employees.router)
app.include_router(imports.router)
app.include_router(cards.router)
app.include_router(documents.router)
app.include_router(dashboard.router)
app.include_router(retention.router)
app.include_router(reports.router)
app.include_router(quality.router)
app.include_router(trainings.router)
app.include_router(competence.router)
app.include_router(lifecycle.router)
app.include_router(training_import.router)


@app.get("/api/health", tags=["system"])
def health(db: DbSession) -> dict[str, str]:
    db.execute(text("SELECT 1"))
    return {"status": "ok"}
