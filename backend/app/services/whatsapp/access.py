"""Who may read and write client WhatsApp chats (spec §5.4 «Права»)."""
from sqlalchemy.orm import Session

from app.models import Department, Role, User, user_departments

SALES_SLUG = "sales"


def can_use_whatsapp(db: Session, user: User) -> bool:
    """Admins, founders, closers and members of the sales department (by membership, not position)."""
    if user.role == Role.admin or user.is_founder or user.is_closer:
        return True
    return db.query(user_departments).join(
        Department, Department.id == user_departments.c.department_id,
    ).filter(
        user_departments.c.user_id == user.id, Department.slug == SALES_SLUG,
    ).first() is not None
