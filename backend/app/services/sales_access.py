"""Sales module access: who heads sales and who works in it."""
from sqlalchemy.orm import Session

from app.models import Role, User
from app.services.whatsapp.access import can_use_whatsapp

SALES_HEAD_POSITION = "Руководитель продаж"


def is_sales_head(user: User) -> bool:
    """Admin, founder or the «Руководитель продаж» position."""
    return user.role == Role.admin or bool(user.is_founder) or user.position == SALES_HEAD_POSITION


def is_sales_staff(db: Session, user: User) -> bool:
    """Admin, founder, closer or member of the sales department."""
    return can_use_whatsapp(db, user)
