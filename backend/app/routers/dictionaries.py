from fastapi import APIRouter
from sqlalchemy import select

from app.deps import Auth, DbSession
from app.models import Agency, Department
from app.schemas import DictionaryItemOut

# Etap 1: tylko odczyt (potrzebny do przypisywania zakresu kierownikom).
# Edycja słowników dochodzi w etapie 2.
router = APIRouter(prefix="/api", tags=["dictionaries"])


@router.get("/agencies", response_model=list[DictionaryItemOut])
def list_agencies(ctx: Auth, db: DbSession) -> list[Agency]:
    return list(db.scalars(select(Agency).order_by(Agency.name)))


@router.get("/departments", response_model=list[DictionaryItemOut])
def list_departments(ctx: Auth, db: DbSession) -> list[Department]:
    return list(db.scalars(select(Department).order_by(Department.name)))
