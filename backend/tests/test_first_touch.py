from datetime import datetime, timezone

from app.models import LeadActivity, WhatsAppChat, WhatsAppMessage
from app.services.first_touch import first_touch_at, working_minutes
from app.services.leads import BISHKEK_TZ


def bk(month, day, hour, minute=0):
    return datetime(2026, month, day, hour, minute, tzinfo=BISHKEK_TZ).astimezone(timezone.utc)


# 2026-11-09 is a Monday
def test_working_minutes_same_day():
    assert working_minutes(bk(11, 9, 10, 0), bk(11, 9, 10, 22)) == 22


def test_working_minutes_night_lead():
    start = bk(11, 9, 23, 0)
    assert working_minutes(start, bk(11, 10, 10, 0)) == 0
    assert working_minutes(start, bk(11, 10, 10, 30)) == 30


def test_working_minutes_over_weekend():
    assert working_minutes(bk(11, 13, 18, 50), bk(11, 16, 10, 5)) == 15


def test_working_minutes_before_open():
    assert working_minutes(bk(11, 9, 8, 0), bk(11, 9, 11, 0)) == 60


def test_working_minutes_end_not_after_start():
    assert working_minutes(bk(11, 9, 12, 0), bk(11, 9, 11, 0)) == 0


def test_first_touch_at_takes_earliest_of_sources(db, lead, staff):
    db.add(LeadActivity(lead_id=lead.id, activity_type="call_result", description="x",
                        responsible_id=staff.id, created_at=bk(11, 9, 12)))
    db.add(LeadActivity(lead_id=lead.id, activity_type="note", description="x",
                        responsible_id=staff.id, created_at=bk(11, 9, 13)))
    db.add(LeadActivity(lead_id=lead.id, activity_type="stage_change", description="x",
                        responsible_id=staff.id, created_at=bk(11, 9, 10)))
    chat = WhatsAppChat(remote_jid="996700000001@s.whatsapp.net", lead_id=lead.id)
    db.add(chat)
    db.flush()
    db.add(WhatsAppMessage(chat_id=chat.id, direction="out", body="x",
                           sender_user_id=staff.id, sent_at=bk(11, 9, 11)))
    db.commit()
    got = first_touch_at(db, [lead.id])
    at = got[lead.id]
    at = at if at.tzinfo else at.replace(tzinfo=timezone.utc)
    assert at == bk(11, 9, 11)
    assert first_touch_at(db, []) == {}


# ── Task 4: new lead timer ─────────────────────────────────────────
import app.routers.lead_board as lead_board_router
from app.models import Lead, LeadStatus
from app.services.sales_metrics import employee_rows
from app.services.sales_today import unclaimed_leads
from tests.conftest import auth_headers


def _lead(db, stage, created_at, **kw):
    l = Lead(client_name="Т", phone="+996 700 222222", stage_id=stage.id, status=LeadStatus.active,
             created_at=created_at, **kw)
    db.add(l)
    db.commit()
    return l


def _card(client, user, lead_id):
    r = client.get("/api/lead-board", headers=auth_headers(user))
    assert r.status_code == 200, r.text
    return next(c for c in r.json()["leads"] if c["id"] == lead_id)


def test_board_card_waiting_minutes_until_first_touch(client, db, admin, staff, stages, monkeypatch):
    monkeypatch.setattr(lead_board_router, "_now", lambda: bk(11, 9, 10, 22))
    l = _lead(db, stages["Новый лид"], bk(11, 9, 10, 0))
    assert _card(client, admin, l.id)["waiting_minutes"] == 22
    db.add(LeadActivity(lead_id=l.id, activity_type="note", description="x",
                        responsible_id=staff.id, created_at=bk(11, 9, 10, 5)))
    db.commit()
    assert _card(client, admin, l.id)["waiting_minutes"] is None


def test_board_no_timer_when_touched_before_taken(client, db, admin, staff, stages, monkeypatch):
    """Touched by someone while the lead had no setter yet: still no timer."""
    monkeypatch.setattr(lead_board_router, "_now", lambda: bk(11, 9, 12, 0))
    l = _lead(db, stages["Новый лид"], bk(11, 9, 10, 0), setter_id=None)
    db.add(LeadActivity(lead_id=l.id, activity_type="call_result", description="✅",
                        responsible_id=staff.id, created_at=bk(11, 9, 10, 1)))
    db.commit()
    assert _card(client, admin, l.id)["waiting_minutes"] is None


def test_unclaimed_waiting_minutes(db, stages):
    l = _lead(db, stages["Новый лид"], bk(11, 9, 18, 50))
    rows = unclaimed_leads(db, now=bk(11, 10, 10, 5))
    assert next(r for r in rows if r["id"] == l.id)["waiting_minutes"] == 15


def test_avg_first_touch_per_setter(db, stages, staff):
    from datetime import date
    a = _lead(db, stages["Новый лид"], bk(11, 9, 10, 0), setter_id=staff.id)
    b = _lead(db, stages["Новый лид"], bk(11, 9, 11, 0), setter_id=staff.id)
    _lead(db, stages["Новый лид"], bk(11, 9, 12, 0), setter_id=staff.id)
    for lead_, at in ((a, bk(11, 9, 10, 10)), (b, bk(11, 9, 11, 30))):
        db.add(LeadActivity(lead_id=lead_.id, activity_type="call_result", description="✅ Дозвонился",
                            responsible_id=staff.id, created_at=at))
    db.commit()
    row = next(r for r in employee_rows(db, date(2026, 11, 1), date(2026, 11, 30))["setters"]
               if r["user_id"] == staff.id)
    assert row["avg_first_touch_minutes"] == 20
    assert row["untouched"] == 1
