"""Entering the «Встреча» stage: Bishkek wall-clock time, one open meeting per lead."""
from datetime import datetime, timezone

from app.models import Meeting, MeetingStatus
from app.services.leads import change_lead_stage


def _utc(dt: datetime) -> datetime:
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


def test_meeting_time_is_entered_in_bishkek(db, lead, stages):
    change_lead_stage(db, lead, stages["Встреча"].id, extra_data={"meeting_date": "2026-12-01", "meeting_time": "12:00"})
    m = db.query(Meeting).filter_by(lead_id=lead.id).one()
    assert _utc(m.meeting_date) == datetime(2026, 12, 1, 6, 0, tzinfo=timezone.utc)


def test_reentering_meeting_stage_reschedules_existing(db, lead, stages):
    meet = stages["Встреча"].id
    change_lead_stage(db, lead, meet, extra_data={"meeting_date": "2026-12-01", "meeting_time": "12:00"})
    change_lead_stage(db, lead, stages["Созвон"].id)
    change_lead_stage(db, lead, meet, extra_data={"meeting_date": "2026-12-03", "meeting_time": "15:30", "address": "Офис"})
    rows = db.query(Meeting).filter_by(lead_id=lead.id).all()
    assert len(rows) == 1
    assert _utc(rows[0].meeting_date) == datetime(2026, 12, 3, 9, 30, tzinfo=timezone.utc)
    assert rows[0].address == "Офис"


def test_closed_meeting_is_not_reused(db, lead, stages):
    meet = stages["Встреча"].id
    change_lead_stage(db, lead, meet, extra_data={"meeting_date": "2026-12-01", "meeting_time": "12:00"})
    db.query(Meeting).filter_by(lead_id=lead.id).update({"status": MeetingStatus.not_held})
    db.commit()
    change_lead_stage(db, lead, meet, extra_data={"meeting_date": "2026-12-05", "meeting_time": "10:00"})
    assert db.query(Meeting).filter_by(lead_id=lead.id).count() == 2


def test_reschedule_keeps_address_and_comment_when_not_sent(db, lead, stages):
    meet = stages["Встреча"].id
    change_lead_stage(db, lead, meet, extra_data={
        "meeting_date": "2026-12-01", "meeting_time": "12:00", "address": "3 этаж", "comment": "взять договор",
    })
    change_lead_stage(db, lead, stages["Созвон"].id)
    change_lead_stage(db, lead, meet, extra_data={"meeting_date": "2026-12-02", "meeting_time": "10:00", "comment": ""})
    m = db.query(Meeting).filter_by(lead_id=lead.id).one()
    assert m.address == "3 этаж" and m.notes == "взять договор"


def test_lead_detail_exposes_scheduled_meeting(client, db, admin, lead, stages):
    from tests.conftest import auth_headers
    assert client.get(f"/api/leads/{lead.id}", headers=auth_headers(admin)).json()["scheduled_meeting"] is None
    change_lead_stage(db, lead, stages["Встреча"].id, extra_data={"meeting_date": "2026-12-01", "meeting_time": "12:00"})
    db.commit()
    body = client.get(f"/api/leads/{lead.id}", headers=auth_headers(admin)).json()
    assert body["scheduled_meeting"]["meeting_date"].startswith("2026-12-01T06:00")
