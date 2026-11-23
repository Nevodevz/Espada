"""Sales hub API: «Сегодня» screen data."""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.deps import get_current_user
from app.models import User
from app.services.sales_access import is_sales_staff
from app.services.sales_today import awaiting_reply, unclaimed_leads

router = APIRouter(prefix="/api/sales-hub", tags=["sales-hub"])


@router.get("/today")
def today(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    if not is_sales_staff(db, user):
        raise HTTPException(403, "Только для сотрудников продаж")
    return {"unclaimed": unclaimed_leads(db), "awaiting_reply": awaiting_reply(db, user)}
