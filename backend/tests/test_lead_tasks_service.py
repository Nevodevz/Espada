"""Lead tasks: creation, results, no-answer streak, reschedule, auto-cancel."""
from datetime import datetime, timedelta, timezone

from app.models import LeadActivity, LeadTask, RejectReason, WhatsAppChat, WhatsAppMessage
from app.services import lead_tasks as svc

T0 = datetime(2026, 11, 20, 4, 0, tzinfo=timezone.utc)


def task(db, lead, kind="call", at=T0, assignee=None, comment=""):
    return svc.create_task(db, lead, kind=kind, due_at=at, assignee_id=assignee, created_by=None, comment=comment)


def finish(db, t, result, uid, note=""):
    return svc.complete_task(db, t, result=result, note=note, user_id=uid)


def test_create_and_next_task(db, lead, staff):
    later = task(db, lead, at=T0 + timedelta(hours=3), assignee=staff.id)
    sooner = task(db, lead, at=T0 + timedelta(hours=1), assignee=staff.id)
    db.commit()
    assert svc.next_tasks(db, [lead.id])[lead.id].id == sooner.id
    assert later.status == "open"


def test_complete_no_answer_writes_activity_and_streak(db, lead, staff):
    for _ in range(3):
        finish(db, task(db, lead), "no_answer", staff.id)
    db.commit()
    assert svc.no_answer_streaks(db, [lead.id])[lead.id] == 3
    notes = db.query(LeadActivity).filter_by(lead_id=lead.id, activity_type="call_result").all()
    assert len(notes) == 3 and all("Недозвон" in a.description for a in notes)


def test_connected_resets_streak(db, lead, staff):
    for result in ("no_answer", "no_answer", "connected", "no_answer"):
        finish(db, task(db, lead), result, staff.id)
        db.flush()
    db.commit()
    assert svc.no_answer_streaks(db, [lead.id])[lead.id] == 1


def test_inbound_whatsapp_resets_streak(db, lead, staff):
    for _ in range(3):
        finish(db, task(db, lead), "no_answer", staff.id)
    db.commit()
    chat = WhatsAppChat(remote_jid="996700000001@s.whatsapp.net", phone="996700000001", lead_id=lead.id)
    db.add(chat)
    db.flush()
    db.add(WhatsAppMessage(chat_id=chat.id, external_id="IN", direction="in", kind="text", body="я тут",
                           status="received", sent_at=datetime.now(timezone.utc) + timedelta(minutes=1)))
    db.commit()
    assert svc.no_answer_streaks(db, [lead.id]).get(lead.id, 0) == 0


def test_streak_counts_only_calls(db, lead, staff):
    finish(db, task(db, lead, kind="message"), "no_answer", staff.id)
    db.commit()
    assert svc.no_answer_streaks(db, [lead.id]).get(lead.id, 0) == 0


def test_reschedule_creates_new_open_task(db, lead, staff):
    old = task(db, lead, assignee=staff.id, comment="уточнить бюджет")
    new = svc.reschedule_task(db, old, due_at=T0 + timedelta(days=1), user_id=staff.id)
    db.commit()
    assert (old.status, old.result) == ("done", "rescheduled")
    assert new.status == "open" and new.id != old.id
    assert (new.kind, new.comment, new.assignee_id) == ("call", "уточнить бюджет", staff.id)
    assert new.due_at.replace(tzinfo=timezone.utc) == T0 + timedelta(days=1)


def test_cancel_open_tasks(db, lead, staff):
    task(db, lead)
    task(db, lead)
    done = task(db, lead)
    finish(db, done, "done", staff.id)
    db.commit()
    assert svc.cancel_open_tasks(db, lead.id) == 2
    db.commit()
    statuses = sorted((t.status, t.result) for t in db.query(LeadTask).filter_by(lead_id=lead.id))
    assert statuses == [("canceled", "auto_canceled"), ("canceled", "auto_canceled"), ("done", "done")]


def test_seed_has_unreachable_reason(monkeypatch, engine):
    from sqlalchemy.orm import sessionmaker
    import app.seed as seed_module
    Session = sessionmaker(bind=engine)
    monkeypatch.setattr(seed_module, "SessionLocal", Session)
    seed_module.seed_lookups()
    s = Session()
    assert s.query(RejectReason).filter_by(name="Не выходит на связь").count() == 1
    s.close()
