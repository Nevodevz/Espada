from datetime import date, datetime, timedelta, timezone

import pytest

from app.models import (Deal, Department, Lead, LeadActivity, LeadStatus, Meeting,
                        MeetingStatus, WhatsAppChat, WhatsAppMessage)
from app.services.leads import BISHKEK_TZ
from app.services.sales_metrics import employee_rows, totals
from tests.conftest import auth_headers

D1, D2 = date(2026, 11, 1), date(2026, 11, 30)
NOON = datetime(2026, 11, 10, 6, 0, tzinfo=timezone.utc)  # 12:00 Bishkek


def bk(day, hour, minute=0):
    return datetime(2026, 11, day, hour, minute, tzinfo=BISHKEK_TZ).astimezone(timezone.utc)


@pytest.fixture()
def sales(db, staff):
    dept = Department(name="Отдел продаж", slug="sales", kind="sales", members=[staff])
    db.add(dept)
    db.commit()
    return dept


def mk_lead(db, **kw):
    l = Lead(client_name="Л", phone="+996 700 111111", status=LeadStatus.active, **kw)
    db.add(l)
    db.commit()
    return l


def act(db, lead, user, at, typ="call_result", desc="✅ Дозвонился"):
    db.add(LeadActivity(lead_id=lead.id, activity_type=typ, description=desc,
                        responsible_id=user.id, created_at=at))
    db.commit()


def wa_out(db, lead, user, at, n=[0]):
    n[0] += 1
    c = WhatsAppChat(remote_jid=f"99670{n[0]:07d}@s.whatsapp.net", lead_id=lead.id)
    db.add(c)
    db.flush()
    db.add(WhatsAppMessage(chat_id=c.id, direction="out", body="x", sender_user_id=user.id, sent_at=at))
    db.commit()


def mk_meeting(db, **kw):
    m = Meeting(client_name="К", meeting_date=kw.pop("meeting_date", NOON),
                created_at=kw.pop("created_at", NOON), **kw)
    db.add(m)
    db.commit()
    return m


def setter_row(db, user):
    return next((r for r in employee_rows(db, D1, D2)["setters"] if r["user_id"] == user.id), None)


def test_touch_is_lead_per_day(db, lead, staff):
    for i in range(10):
        wa_out(db, lead, staff, NOON + timedelta(minutes=i))
    act(db, lead, staff, NOON + timedelta(minutes=30))
    assert setter_row(db, staff)["touches"] == 1


def test_touch_day_boundary_is_bishkek(db, lead, staff):
    act(db, lead, staff, bk(10, 23, 30))
    act(db, lead, staff, bk(11, 0, 30))
    assert setter_row(db, staff)["touches"] == 2


def test_stage_change_is_not_a_touch(db, lead, staff):
    act(db, lead, staff, NOON, typ="stage_change", desc="Новый → Созвон")
    act(db, lead, staff, NOON, typ="whatsapp", desc="msg")
    assert setter_row(db, staff) is None


def test_manual_activity_is_a_touch(db, lead, staff):
    act(db, lead, staff, NOON, typ="note", desc="Позвонил в мессенджер")
    assert setter_row(db, staff)["touches"] == 1


def test_calls_connected_and_no_answer(db, lead, staff):
    act(db, lead, staff, NOON, desc="✅ Дозвонился")
    act(db, lead, staff, NOON + timedelta(hours=1), desc="✅ Дозвонился: договорились")
    act(db, lead, staff, NOON + timedelta(hours=2), desc="📵 Недозвон")
    row = setter_row(db, staff)
    assert (row["calls_connected"], row["calls_no_answer"]) == (2, 1)


def test_booked_ignores_reschedule_children(db, staff, other_staff):
    parent = mk_meeting(db, setter_id=staff.id, closer_id=other_staff.id)
    mk_meeting(db, setter_id=staff.id, closer_id=other_staff.id, parent_id=parent.id)
    assert setter_row(db, staff)["booked"] == 1
    assert totals(db, D1, D2)["meetings_booked"] == 1


def test_held_by_meeting_date(db, staff, other_staff):
    # created in October, held in November -> held counts, booked does not
    mk_meeting(db, setter_id=staff.id, closer_id=other_staff.id, status=MeetingStatus.closed,
               created_at=datetime(2026, 10, 5, tzinfo=timezone.utc))
    mk_meeting(db, setter_id=staff.id, closer_id=other_staff.id, status=MeetingStatus.scheduled)
    row = setter_row(db, staff)
    assert (row["held"], row["booked"]) == (1, 1)
    assert totals(db, D1, D2)["meetings_held"] == 1


def test_closer_status_counts_skip_rescheduled(db, staff, other_staff):
    for st in (MeetingStatus.closed, MeetingStatus.closed, MeetingStatus.minus,
               MeetingStatus.not_held, MeetingStatus.rescheduled):
        mk_meeting(db, setter_id=staff.id, closer_id=other_staff.id, status=st)
    row = next(r for r in employee_rows(db, D1, D2)["closers"] if r["user_id"] == other_staff.id)
    assert row["by_status"] == {"scheduled": 0, "closed": 2, "minus": 1, "push": 0, "not_held": 1}


def test_closer_sales_from_paid_deals(db, lead, other_staff):
    db.add_all([
        Deal(lead_id=lead.id, amount=100, paid_amount=100, status="paid",
             payment_date=date(2026, 11, 5), closer_id=other_staff.id),
        Deal(lead_id=lead.id, amount=50, paid_amount=20, status="partial",
             payment_date=date(2026, 11, 6), closer_id=other_staff.id),
        Deal(lead_id=lead.id, amount=70, paid_amount=70, status="paid",
             payment_date=date(2026, 10, 6), closer_id=other_staff.id),
    ])
    db.commit()
    row = next(r for r in employee_rows(db, D1, D2)["closers"] if r["user_id"] == other_staff.id)
    assert (row["sales"], row["sales_amount"]) == (1, 100)
    assert totals(db, D1, D2)["sales"] == 1


def test_staff_sees_only_own_row(db, client, sales, staff, other_staff, lead):
    act(db, lead, staff, NOON)
    act(db, lead, other_staff, NOON)
    r = client.get("/api/sales-hub/metrics?date_from=2026-11-01&date_to=2026-11-30",
                   headers=auth_headers(staff))
    assert r.status_code == 200
    body = r.json()
    assert set(body) == {"totals", "funnel", "daily", "sources", "employees"}
    assert [s["user_id"] for s in body["employees"]["setters"]] == [staff.id]


def test_head_sees_all_rows(db, client, admin, staff, other_staff, lead):
    act(db, lead, staff, NOON)
    act(db, lead, other_staff, NOON)
    r = client.get("/api/sales-hub/metrics?date_from=2026-11-01&date_to=2026-11-30",
                   headers=auth_headers(admin))
    assert len(r.json()["employees"]["setters"]) == 2


def test_metrics_forbidden_for_non_sales(db, client, staff):
    r = client.get("/api/sales-hub/metrics?date_from=2026-11-01&date_to=2026-11-30",
                   headers=auth_headers(staff))
    assert r.status_code == 403


def test_totals_money_and_conversion(db, stages, staff):
    mk_lead(db, stage_id=stages["Договор"].id, created_at=NOON)
    won = mk_lead(db, stage_id=stages["Оплачено"].id, created_at=NOON)
    open_l = db.query(Lead).filter(Lead.stage_id == stages["Договор"].id).one()
    db.add_all([Deal(lead_id=open_l.id, amount=100, paid_amount=40, status="partial"),
                Deal(lead_id=won.id, amount=999, paid_amount=999, status="paid")])
    db.commit()
    t = totals(db, D1, D2)
    assert t["leads"] == 2 and t["conversion_pct"] == 50.0
    assert (t["deals_amount"], t["paid"], t["remaining"]) == (100, 40, 60)


def test_staff_cannot_filter_by_other_user(db, client, sales, staff, other_staff):
    q = "?date_from=2026-11-01&date_to=2026-11-30&user_id="
    assert client.get(f"/api/sales-hub/metrics{q}{other_staff.id}", headers=auth_headers(staff)).status_code == 403
    assert client.get(f"/api/sales-hub/metrics{q}{staff.id}", headers=auth_headers(staff)).status_code == 200


def test_position_head_outside_sales_dept_sees_all(db, client, staff, other_staff, lead):
    from app.core.security import hash_password
    from app.models import Role, User
    head = User(name="РП", email="rp@test.kg", password_hash=hash_password("x"), role=Role.staff,
                position="Руководитель продаж", is_active=True)
    db.add(head)
    db.commit()
    act(db, lead, staff, NOON)
    act(db, lead, other_staff, NOON)
    h = auth_headers(head)
    r = client.get("/api/sales-hub/metrics?date_from=2026-11-01&date_to=2026-11-30", headers=h)
    assert r.status_code == 200 and len(r.json()["employees"]["setters"]) == 2
    assert client.get("/api/sales-hub/today", headers=h).status_code == 200
