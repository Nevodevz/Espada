"""Lead tasks API: permissions, results, my-tasks scopes, auto-cancel."""
from datetime import datetime, timedelta, timezone

import pytest

from app.core.security import hash_password
from app.models import Department, LeadStatus, LeadTask, Role, User, WhatsAppChat
from tests.conftest import auth_headers

BISHKEK = timezone(timedelta(hours=6))


@pytest.fixture()
def sales(db, staff):
    dept = Department(name="Отдел продаж", slug="sales", kind="sales", members=[staff])
    db.add(dept)
    db.commit()
    return dept


@pytest.fixture()
def outsider(db):
    u = User(name="Промптер", email="prompt@test.kg", password_hash=hash_password("x"),
             role=Role.staff, position="Промпт-инженер", is_active=True)
    db.add(u)
    db.commit()
    return u


def iso(dt):
    return dt.isoformat()


def create(client, user, lead_id, **body):
    payload = {"kind": "call", "due_at": iso(datetime.now(timezone.utc) + timedelta(hours=1)), "comment": "", **body}
    return client.post(f"/api/leads/{lead_id}/tasks", json=payload, headers=auth_headers(user))


def test_create_requires_sales_access(client, lead, staff, outsider, sales):
    assert create(client, outsider, lead.id).status_code == 403
    r = create(client, staff, lead.id, comment="уточнить бюджет")
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["assignee"]["id"] == staff.id and body["status"] == "open" and body["can_edit"] is True
    assert body["lead_name"] == lead.client_name


def test_assignee_must_have_access(client, lead, staff, outsider, sales):
    assert create(client, staff, lead.id, assignee_id=outsider.id).status_code == 422


def test_invalid_kind_rejected(client, lead, staff, sales):
    assert create(client, staff, lead.id, kind="sleep").status_code == 422


def test_complete_by_other_staff_forbidden(client, db, lead, staff, other_staff, sales):
    sales.members.append(other_staff)
    db.commit()
    tid = create(client, staff, lead.id).json()["id"]
    assert client.post(f"/api/lead-tasks/{tid}/complete", json={"result": "done"}, headers=auth_headers(other_staff)).status_code == 403
    assert client.post(f"/api/lead-tasks/{tid}/complete", json={"result": "done"}, headers=auth_headers(staff)).status_code == 200


def test_complete_returns_streak_and_suggest_lost(client, lead, staff, sales):
    out = None
    for _ in range(5):
        tid = create(client, staff, lead.id).json()["id"]
        out = client.post(f"/api/lead-tasks/{tid}/complete", json={"result": "no_answer"}, headers=auth_headers(staff)).json()
    assert out["no_answer_streak"] == 5 and out["suggest_lost"] is True
    assert out["task"]["result"] == "no_answer"


def test_reschedule_endpoint_returns_new_task(client, lead, staff, sales):
    tid = create(client, staff, lead.id).json()["id"]
    due = iso(datetime.now(timezone.utc) + timedelta(days=1))
    r = client.post(f"/api/lead-tasks/{tid}/reschedule", json={"due_at": due}, headers=auth_headers(staff))
    assert r.status_code == 200 and r.json()["id"] != tid and r.json()["status"] == "open"


def test_closed_task_conflict(client, lead, staff, sales):
    tid = create(client, staff, lead.id).json()["id"]
    client.post(f"/api/lead-tasks/{tid}/complete", json={"result": "done"}, headers=auth_headers(staff))
    assert client.post(f"/api/lead-tasks/{tid}/complete", json={"result": "done"}, headers=auth_headers(staff)).status_code == 409
    assert client.post(f"/api/lead-tasks/{tid}/cancel", headers=auth_headers(staff)).status_code == 409


def test_lead_tasks_listing(client, lead, staff, sales):
    create(client, staff, lead.id)
    tid = create(client, staff, lead.id).json()["id"]
    client.post(f"/api/lead-tasks/{tid}/cancel", headers=auth_headers(staff))
    assert len(client.get(f"/api/leads/{lead.id}/tasks?status=open", headers=auth_headers(staff)).json()) == 1
    assert len(client.get(f"/api/leads/{lead.id}/tasks?status=all", headers=auth_headers(staff)).json()) == 2


def test_my_tasks_scopes(client, db, lead, staff, admin, sales):
    now_bk = datetime.now(BISHKEK)
    yesterday = (now_bk - timedelta(days=1)).replace(hour=12)
    today_late = now_bk.replace(hour=23, minute=59)
    tomorrow = (now_bk + timedelta(days=1)).replace(hour=12)
    for when in (yesterday, today_late, tomorrow):
        create(client, staff, lead.id, due_at=iso(when))
    create(client, admin, lead.id, assignee_id=admin.id)
    scope = lambda s, extra="": [t["due_at"] for t in client.get(f"/api/lead-tasks?scope={s}{extra}", headers=auth_headers(staff)).json()]
    assert len(scope("overdue")) == 1 and len(scope("today")) >= 1 and len(scope("upcoming")) == 1
    assert len(scope("all", f"&assignee={admin.id}")) == 3      # staff cannot peek at others: forced to own


def test_unassigned_visible_to_admin_only(client, db, lead, staff, admin, sales):
    db.add(LeadTask(lead_id=lead.id, kind="call", due_at=datetime.now(timezone.utc), assignee_id=None, status="open"))
    db.commit()
    assert len(client.get("/api/lead-tasks?scope=all&assignee=none", headers=auth_headers(admin)).json()) == 1
    assert client.get("/api/lead-tasks?scope=all&assignee=none", headers=auth_headers(staff)).json() == []


def test_lost_stage_cancels_open_tasks(client, db, lead, staff, admin, stages, sales):
    create(client, staff, lead.id)
    from app.models import RejectReason
    reason = RejectReason(name="Не выходит на связь")
    db.add(reason)
    db.commit()
    r = client.patch(f"/api/leads/{lead.id}/stage", headers=auth_headers(admin),
                     json={"to_stage_id": stages["Минус"].id, "extra_data": {"reject_reason_id": reason.id}})
    assert r.status_code == 200, r.text
    assert client.get("/api/lead-tasks?scope=all", headers=auth_headers(staff)).json() == []
    assert db.query(LeadTask).filter_by(lead_id=lead.id).one().result == "auto_canceled"


def test_archive_cancels_open_tasks(client, db, lead, staff, admin, sales):
    create(client, staff, lead.id)
    client.post(f"/api/leads/{lead.id}/archive", headers=auth_headers(admin))
    db.expire_all()
    assert db.query(LeadTask).filter_by(lead_id=lead.id).one().status == "canceled"


def test_whatsapp_ignore_cancels_tasks_of_auto_lead(client, db, lead, staff, sales):
    chat = WhatsAppChat(remote_jid="996700000001@s.whatsapp.net", phone="996700000001",
                        lead_id=lead.id, created_lead_id=lead.id)
    db.add(chat)
    db.commit()
    create(client, staff, lead.id)
    client.post(f"/api/whatsapp/chats/{chat.id}/ignore", headers=auth_headers(staff))
    db.expire_all()
    assert db.get(type(lead), lead.id).status == LeadStatus.archived
    assert db.query(LeadTask).filter_by(lead_id=lead.id).one().status == "canceled"


def test_assign_unassigned_task(client, db, lead, staff, admin, sales):
    t = LeadTask(lead_id=lead.id, kind="call", due_at=datetime.now(timezone.utc), assignee_id=None, status="open")
    db.add(t)
    db.commit()
    r = client.post(f"/api/lead-tasks/{t.id}/assign", json={"assignee_id": staff.id}, headers=auth_headers(admin))
    assert r.status_code == 200 and r.json()["assignee"]["id"] == staff.id


def test_assign_requires_sales_assignee(client, db, lead, staff, outsider, admin, sales):
    tid = create(client, staff, lead.id).json()["id"]
    assert client.post(f"/api/lead-tasks/{tid}/assign", json={"assignee_id": outsider.id},
                       headers=auth_headers(admin)).status_code == 422


def test_unassigned_tasks_in_manager_bell(client, db, lead, admin, sales):
    db.add(LeadTask(lead_id=lead.id, kind="call", due_at=datetime.now(timezone.utc) - timedelta(days=1),
                    assignee_id=None, status="open"))
    db.commit()
    items = {n["id"]: n for n in client.get("/api/notifications", headers=auth_headers(admin)).json()["items"]}
    assert "tasks_unassigned" in items and items["tasks_unassigned"]["link"] == "/tasks?assignee=none"


def test_no_tasks_on_closed_or_archived_lead(client, db, lead, staff, stages, sales):
    lead.stage_id = stages["Минус"].id
    db.commit()
    assert create(client, staff, lead.id).status_code == 409
    lead.stage_id, lead.status = stages["Созвон"].id, LeadStatus.archived
    db.commit()
    assert create(client, staff, lead.id).status_code == 409
