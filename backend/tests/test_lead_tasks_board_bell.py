"""Tasks on the board, list, bell and analytics."""
from datetime import datetime, timedelta, timezone

import pytest

from app.models import Department, Lead, LeadStatus, LeadTask
from app.services import analytics
from tests.conftest import auth_headers


@pytest.fixture()
def sales(db, staff):
    dept = Department(name="Отдел продаж", slug="sales", kind="sales", members=[staff])
    db.add(dept)
    db.commit()
    return dept


def now():
    return datetime.now(timezone.utc)


def add_task(db, lead, due, assignee):
    t = LeadTask(lead_id=lead.id, kind="call", due_at=due, assignee_id=assignee.id, status="open", comment="")
    db.add(t)
    db.commit()
    return t


def new_lead(db, stages, name, phone, updated=None):
    l = Lead(client_name=name, phone=phone, stage_id=stages["Созвон"].id, status=LeadStatus.active)
    if updated:
        l.updated_at = updated
    db.add(l)
    db.commit()
    return l


def bell(client, user):
    return {n["id"]: n for n in client.get("/api/notifications", headers=auth_headers(user)).json()["items"]}


def test_week_overdue_task_visible_everywhere(client, db, lead, staff, sales):
    t = add_task(db, lead, now() - timedelta(days=7), staff)
    card = next(c for c in client.get("/api/lead-board", headers=auth_headers(staff)).json()["leads"] if c["id"] == lead.id)
    assert card["next_task"]["id"] == t.id and card["next_task"]["overdue"] is True
    assert [x["id"] for x in client.get("/api/lead-tasks?scope=overdue", headers=auth_headers(staff)).json()] == [t.id]
    assert f"task_overdue_{t.id}" in bell(client, staff)


def test_soon_reminder_window(client, db, lead, staff, sales):
    soon = add_task(db, lead, now() + timedelta(minutes=10), staff)
    later = add_task(db, lead, now() + timedelta(minutes=30), staff)
    ids = bell(client, staff)
    assert f"task_soon_{soon.id}" in ids and f"task_soon_{later.id}" not in ids


def test_board_sort_overdue_before_no_task_before_rest(client, db, stages, staff, admin, sales):
    t0 = now()
    rest = new_lead(db, stages, "С задачей", "+996 700 100001", updated=t0)
    no_task = new_lead(db, stages, "Без задачи", "+996 700 100002", updated=t0 - timedelta(days=2))
    overdue = new_lead(db, stages, "Просрочено", "+996 700 100003", updated=t0 - timedelta(days=5))
    add_task(db, rest, t0 + timedelta(days=1), staff)
    add_task(db, overdue, t0 - timedelta(hours=1), staff)
    order = [c["id"] for c in client.get("/api/lead-board", headers=auth_headers(admin)).json()["leads"]]
    ours = [i for i in order if i in (rest.id, no_task.id, overdue.id)]
    assert ours == [overdue.id, no_task.id, rest.id]


def test_board_filters_overdue_and_no_task(client, db, stages, staff, admin, sales, lead):
    overdue = new_lead(db, stages, "Просрочено", "+996 700 100003")
    add_task(db, overdue, now() - timedelta(hours=1), staff)
    add_task(db, lead, now() + timedelta(hours=5), staff)
    bare = new_lead(db, stages, "Без задачи", "+996 700 100004")
    get = lambda q: {c["id"] for c in client.get(f"/api/lead-board?{q}", headers=auth_headers(admin)).json()["leads"]}
    assert get("overdue=true") == {overdue.id}
    assert bare.id in get("no_task=true") and lead.id not in get("no_task=true") and overdue.id not in get("no_task=true")


def test_list_has_next_task_and_streak(client, db, lead, staff, sales):
    done = add_task(db, lead, now() - timedelta(hours=2), staff)
    done.status, done.result, done.completed_at = "done", "no_answer", now()
    nxt = add_task(db, lead, now() + timedelta(hours=2), staff)
    db.commit()
    row = next(i for i in client.get("/api/leads", headers=auth_headers(staff)).json()["items"] if i["id"] == lead.id)
    assert row["next_task"]["id"] == nxt.id and row["no_answer_streak"] == 1


def test_old_next_action_notifications_gone(client, db, lead, staff, sales):
    lead.next_action_type, lead.next_action_at = "Позвонить", now() - timedelta(days=2)
    db.commit()
    assert not any(k.startswith("lead_action_overdue_") for k in bell(client, staff))


def test_no_task_bell_and_analytics(client, db, lead, staff, sales, stages):
    ids = bell(client, staff)
    assert "leads_no_task" in ids and ids["leads_no_task"]["link"] == "/leads/board?no_task=true"
    for i in range(6):
        new_lead(db, stages, f"Пустой {i}", f"+996 700 2000{i:02d}")
    add_task(db, lead, now() - timedelta(hours=1), staff)
    messages = [p["message"] for p in analytics.problems(db)]
    assert any("без задачи" in m for m in messages)
    assert any("просроченной задачей" in m for m in messages)
