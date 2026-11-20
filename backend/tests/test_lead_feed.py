"""Unified lead feed: sources, permissions, cursor pagination."""
from datetime import date, datetime, timedelta, timezone

import pytest

from app.core.security import hash_password
from app.models import (
    Deal, DealPayment, Department, LeadActivity, LeadFile, LeadStageHistory, LeadTask, Meeting,
    PaymentStatus, Role, User, WhatsAppChat, WhatsAppMessage,
)
from tests.conftest import auth_headers

T0 = datetime(2026, 11, 10, 4, 0, tzinfo=timezone.utc)


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


def at(minutes):
    return T0 + timedelta(minutes=minutes)


def feed(client, user, lead_id, before=None, limit=50):
    q = f"/api/leads/{lead_id}/feed?limit={limit}" + (f"&before={before}" if before else "")
    r = client.get(q, headers=auth_headers(user))
    assert r.status_code == 200, r.text
    return r.json()


@pytest.fixture()
def rich_lead(db, lead, stages, staff):
    lead.created_at = at(0)
    db.add(LeadStageHistory(lead_id=lead.id, from_stage_id=stages["Новый лид"].id,
                            to_stage_id=stages["Созвон"].id, changed_by=staff.id, created_at=at(1)))
    db.add(LeadActivity(lead_id=lead.id, activity_type="note", description="Хочет бота для записи",
                        responsible_id=staff.id, created_at=at(2)))
    db.add(LeadActivity(lead_id=lead.id, activity_type="stage_change", description="Этап изменён", created_at=at(1)))
    chat = WhatsAppChat(remote_jid="996700000001@s.whatsapp.net", phone="996700000001", lead_id=lead.id, unread_count=3)
    db.add(chat)
    db.flush()
    db.add(WhatsAppMessage(chat_id=chat.id, external_id="I1", direction="in", kind="text", body="Здравствуйте",
                           status="received", sent_at=at(3)))
    db.add(WhatsAppMessage(chat_id=chat.id, external_id="O1", direction="out", kind="text", body="Добрый день",
                           status="read", sender_user_id=staff.id, sent_at=at(4)))
    db.add(Meeting(lead_id=lead.id, client_name=lead.client_name, meeting_date=at(600), created_at=at(5),
                   closer_id=lead.closer_id))
    db.add(LeadTask(lead_id=lead.id, kind="call", due_at=at(10), assignee_id=staff.id, status="done",
                    result="no_answer", created_at=at(6), completed_at=at(11), completed_by=staff.id))
    db.add(LeadFile(lead_id=lead.id, name="КП.pdf", url="https://x/kp.pdf", created_at=at(12)))
    deal = Deal(lead_id=lead.id, amount=100_000, paid_amount=50_000, status="partial")
    db.add(deal)
    db.flush()
    db.add(DealPayment(deal_id=deal.id, planned_amount=50_000, paid_amount=50_000, status=PaymentStatus.paid,
                       paid_date=date(2026, 11, 11), planned_date=date(2026, 11, 11)))
    db.commit()
    return lead


def test_feed_merges_sources_in_order(client, rich_lead, staff, sales):
    items = feed(client, staff, rich_lead.id)["items"]
    types = [i["type"] for i in items]
    for t in ("created", "stage", "note", "message", "meeting", "task_created", "task_done", "file", "payment"):
        assert t in types, t
    stamps = [i["at"] for i in items]
    assert stamps == sorted(stamps, reverse=True)
    assert len({i["key"] for i in items}) == len(items)


def test_feed_hides_messages_without_access(client, db, rich_lead, staff, outsider, sales):
    items = feed(client, outsider, rich_lead.id)["items"]
    assert "message" not in {i["type"] for i in items}
    assert db.query(WhatsAppChat).one().unread_count == 3
    items = feed(client, staff, rich_lead.id)["items"]
    assert "message" in {i["type"] for i in items}
    db.expire_all()
    assert db.query(WhatsAppChat).one().unread_count == 0


def test_feed_pagination_no_gaps_or_duplicates(client, db, lead, staff, sales):
    lead.created_at = at(-1)
    for i in range(300):
        stamp = at(30) if i < 120 else at(31 + i)          # 120 events share one timestamp
        db.add(LeadActivity(lead_id=lead.id, activity_type="note", description=f"n{i}", created_at=stamp))
    db.commit()
    seen, before = [], None
    for _ in range(20):
        page = feed(client, staff, lead.id, before=before, limit=50)
        seen += [i["key"] for i in page["items"]]
        before = page["next_before"]
        if not before:
            break
    notes = [k for k in seen if k.startswith("note:")]
    assert len(notes) == 300 and len(set(notes)) == 300
    assert "created:" + str(lead.id) in seen[-1] or seen[-1].startswith("created:")


def test_stage_change_activity_not_duplicated(client, rich_lead, staff, sales):
    items = feed(client, staff, rich_lead.id)["items"]
    assert [i["type"] for i in items].count("stage") == 1
    assert not any(i["type"] == "activity" and "Этап" in i["data"].get("description", "") for i in items)


def test_note_created_via_activities_endpoint(client, lead, staff, sales):
    r = client.post(f"/api/leads/{lead.id}/activities", json={"activity_type": "note", "description": "Перезвонить после 18"},
                    headers=auth_headers(staff))
    assert r.status_code == 201, r.text
    notes = [i for i in feed(client, staff, lead.id)["items"] if i["type"] == "note"]
    assert notes and notes[0]["data"]["description"] == "Перезвонить после 18"
