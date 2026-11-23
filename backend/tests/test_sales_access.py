"""Sales access helpers: sales head and sales staff."""
from datetime import datetime, timezone

from app.models import LeadTask
from app.services.sales_access import is_sales_head, is_sales_staff
from tests.conftest import auth_headers


def test_head_by_position(staff):
    staff.position = "Руководитель продаж"
    assert is_sales_head(staff) is True


def test_admin_and_founder_are_heads(admin, staff):
    assert is_sales_head(admin) is True
    staff.is_founder = True
    assert is_sales_head(staff) is True


def test_setter_is_not_head(staff):
    assert is_sales_head(staff) is False


def test_staff_delegates_to_whatsapp_access(db, admin, staff):
    assert is_sales_staff(db, admin) is True
    assert is_sales_staff(db, staff) is False


def test_head_of_sales_sees_unassigned_tasks(client, db, lead, staff):
    staff.position = "Руководитель продаж"
    db.add(LeadTask(lead_id=lead.id, kind="call", due_at=datetime.now(timezone.utc), assignee_id=None, status="open"))
    db.commit()
    r = client.get("/api/lead-tasks?scope=all&assignee=none", headers=auth_headers(staff))
    assert r.status_code == 200 and len(r.json()) == 1
