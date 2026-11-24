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
