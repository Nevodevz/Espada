"""Sales hub API: «Сегодня» and «Показатели» screens data."""
from datetime import date
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.deps import get_current_user
from app.models import User
from app.services import analytics
from app.services.sales_access import is_sales_head, is_sales_staff
from app.services.sales_metrics import employee_rows, totals
from app.services.sales_today import awaiting_reply, unclaimed_leads

router = APIRouter(prefix="/api/sales-hub", tags=["sales-hub"])


@router.get("/today")
def today(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    if not is_sales_staff(db, user):
        raise HTTPException(403, "Только для сотрудников продаж")
    return {"unclaimed": unclaimed_leads(db), "awaiting_reply": awaiting_reply(db, user)}


@router.get("/metrics")
def metrics(
    date_from: date = Query(...),
    date_to: date = Query(...),
    source_id: Optional[int] = Query(None),
    service_id: Optional[int] = Query(None),
    user_id: Optional[int] = Query(None),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    if not is_sales_staff(db, user):
        raise HTTPException(403, "Только для сотрудников продаж")
    if date_to < date_from:
        raise HTTPException(422, "date_to раньше date_from")
    charts = analytics.charts_data(db, date_from, date_to)
    employees = employee_rows(db, date_from, date_to)
    if not is_sales_head(user):
        employees = {k: [r for r in rows if r["user_id"] == user.id] for k, rows in employees.items()}
    return {
        "totals": totals(db, date_from, date_to, source_id, service_id, user_id),
        "funnel": charts["funnel"],
        "daily": charts["daily"],
        "sources": charts["sources_pie"],
        "employees": employees,
    }
