from datetime import datetime, timedelta, timezone

import pytest

from app.models import (Department, Lead, LeadSource, LeadStatus, WhatsAppChat,
                        WhatsAppMessage)
from app.services.sales_today import awaiting_reply, unclaimed_leads
from tests.conftest import auth_headers

T0 = datetime(2026, 11, 1, 10, 0, tzinfo=timezone.utc)


@pytest.fixture()
def sales(db, staff):
    dept = Department(name="Отдел продаж", slug="sales", kind="sales", members=[staff])
    db.add(dept)
    db.commit()
    return dept


def mk_lead(db, stage=None, **kw):
    l = Lead(client_name=kw.pop("client_name", "Л"), phone="+996 700 111111",
             stage_id=stage.id if stage else None, status=kw.pop("status", LeadStatus.active), **kw)
    db.add(l)
    db.commit()
    return l


def mk_chat(db, lead, msgs, n=[0]):
    n[0] += 1
    c = WhatsAppChat(remote_jid=f"99670{n[0]:07d}@s.whatsapp.net", lead_id=lead.id if lead else None)
    db.add(c)
    db.flush()
    for i, (direction, body) in enumerate(msgs):
        db.add(WhatsAppMessage(chat_id=c.id, direction=direction, body=body,
                               sent_at=T0 + timedelta(minutes=i)))
    db.commit()
    return c


def test_unclaimed_excludes_taken_and_closed(db, stages, staff):
    src = LeadSource(name="Instagram", is_active=True, position=0)
    db.add(src)
    db.commit()
    a = mk_lead(db, stages["Новый лид"], source_id=src.id)
    mk_lead(db, stages["Новый лид"], setter_id=staff.id)
    mk_lead(db, stages["Минус"])
    mk_lead(db, stages["Оплачено"])
    mk_lead(db, stages["Новый лид"], status=LeadStatus.archived)
    rows = unclaimed_leads(db)
    assert [r["id"] for r in rows] == [a.id]
    assert rows[0]["source_name"] == "Instagram"
    assert set(rows[0]) == {"id", "client_name", "phone", "source_name", "created_at"}


def test_awaiting_reply_last_inbound_only(db, stages, admin):
    l1 = mk_lead(db, stages["Созвон"], client_name="A")
    l2 = mk_lead(db, stages["Созвон"], client_name="B")
    mk_chat(db, l1, [("out", "hi"), ("in", "привет")])
    mk_chat(db, l2, [("in", "привет"), ("out", "шаблон")])
    rows = awaiting_reply(db, admin)
    assert [r["lead_id"] for r in rows] == [l1.id]
    assert rows[0]["last_body"] == "привет"
    assert set(rows[0]) == {"lead_id", "client_name", "last_body", "last_at"}


def test_awaiting_reply_skips_lost_and_unlinked_chats(db, stages, admin):
    lost = mk_lead(db, stages["Минус"])
    arch = mk_lead(db, stages["Созвон"], status=LeadStatus.archived)
    mk_chat(db, lost, [("in", "x")])
    mk_chat(db, arch, [("in", "x")])
    mk_chat(db, None, [("in", "x")])
    assert awaiting_reply(db, admin) == []


def test_won_lead_is_included(db, stages, admin):
    won = mk_lead(db, stages["Оплачено"])
    mk_chat(db, won, [("in", "спасибо")])
    assert [r["lead_id"] for r in awaiting_reply(db, admin)] == [won.id]


def test_staff_sees_own_and_unassigned_head_sees_all(db, stages, staff, other_staff, admin):
    mine = mk_lead(db, stages["Созвон"], setter_id=staff.id)
    free = mk_lead(db, stages["Созвон"])
    theirs = mk_lead(db, stages["Созвон"], setter_id=other_staff.id, closer_id=other_staff.id)
    closing = mk_lead(db, stages["Созвон"], setter_id=other_staff.id, closer_id=staff.id)
    for l in (mine, free, theirs, closing):
        mk_chat(db, l, [("in", "x")])
    assert {r["lead_id"] for r in awaiting_reply(db, staff)} == {mine.id, free.id, closing.id}
    assert {r["lead_id"] for r in awaiting_reply(db, admin)} == {mine.id, free.id, theirs.id, closing.id}


def test_today_endpoint(client, db, stages, staff, sales):
    l = mk_lead(db, stages["Созвон"])
    mk_chat(db, l, [("in", "x")])
    r = client.get("/api/sales-hub/today", headers=auth_headers(staff))
    assert r.status_code == 200
    body = r.json()
    assert [x["id"] for x in body["unclaimed"]] == [l.id]
    assert [x["lead_id"] for x in body["awaiting_reply"]] == [l.id]


def test_today_forbidden_for_non_sales(client, staff):
    assert client.get("/api/sales-hub/today", headers=auth_headers(staff)).status_code == 403
