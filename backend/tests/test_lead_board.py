"""Sales board: columns are funnel stages, cards are open leads."""
from datetime import datetime, timedelta, timezone

from app.models import Lead, LeadStage, LeadStatus
from app.services.leads import change_lead_stage
from tests.conftest import auth_headers


def board(client, user, **params):
    r = client.get("/api/lead-board", params=params, headers=auth_headers(user))
    assert r.status_code == 200, r.text
    return r.json()


def add_lead(db, stage, name="Ещё", setter=None, closer=None, status=LeadStatus.active, updated_at=None):
    lead = Lead(
        client_name=name, phone=f"+996 700 {abs(hash(name)) % 1000000:06d}",
        stage_id=stage.id, setter_id=setter.id if setter else None,
        closer_id=closer.id if closer else None, status=status,
    )
    if updated_at:
        lead.updated_at = updated_at
    db.add(lead)
    db.commit()
    return lead


def ids(data):
    return [c["id"] for c in data["leads"]]


def test_board_returns_active_stages_with_kind(client, db, admin, stages):
    db.add(LeadStage(name="Демо-тест", position=99, is_archived=True))
    db.commit()
    data = board(client, admin)
    assert [s["name"] for s in data["stages"]] == [
        "Новый лид", "Созвон", "Встреча", "Договор", "Ожидание оплаты", "Оплачено", "Минус",
    ]
    assert {s["name"]: s["kind"] for s in data["stages"]}["Встреча"] == "meeting"


def test_closed_leads_hidden_unless_requested(client, db, admin, stages, lead):
    won = add_lead(db, stages["Оплачено"], "Оплатил")
    lost = add_lead(db, stages["Минус"], "Отказ")
    assert set(ids(board(client, admin))) == {lead.id}
    assert set(ids(board(client, admin, show_closed=True))) == {lead.id, won.id, lost.id}


def test_archived_leads_never_shown(client, db, admin, stages):
    gone = add_lead(db, stages["Созвон"], "Архив", status=LeadStatus.archived)
    assert gone.id not in ids(board(client, admin, show_closed=True))


def test_mine_filter(client, db, admin, staff, stages, lead):
    other = add_lead(db, stages["Созвон"], "Чужой")
    mine = ids(board(client, staff, mine=True))
    assert lead.id in mine and other.id not in mine


def test_unassigned_filter(client, db, admin, staff, stages, lead):
    free = add_lead(db, stages["Новый лид"], "Ничей")
    assert ids(board(client, admin, unassigned=True)) == [free.id]


def test_cards_sorted_by_last_activity(client, db, admin, stages):
    now = datetime.now(timezone.utc)
    old = add_lead(db, stages["Созвон"], "Старый", updated_at=now - timedelta(days=3))
    new = add_lead(db, stages["Созвон"], "Новый", updated_at=now)
    order = ids(board(client, admin))
    assert order.index(new.id) < order.index(old.id)


def test_card_carries_scheduled_meeting(client, db, admin, stages, lead):
    card = next(c for c in board(client, admin)["leads"] if c["id"] == lead.id)
    assert card["scheduled_meeting"] is None
    change_lead_stage(db, lead, stages["Встреча"].id, extra_data={"meeting_date": "2026-12-01", "meeting_time": "12:00"})
    db.commit()
    card = next(c for c in board(client, admin)["leads"] if c["id"] == lead.id)
    assert card["scheduled_meeting"]["meeting_date"].startswith("2026-12-01T06:00")
    assert card["scheduled_meeting"]["closer_id"] == lead.closer_id


def test_free_column_endpoints_are_gone(client, admin):
    r = client.post("/api/lead-board/columns", json={"name": "x"}, headers=auth_headers(admin))
    assert r.status_code in (404, 405)


def test_unauthenticated_requests_are_rejected(client):
    assert client.get("/api/lead-board").status_code == 401


def test_invalid_date_filter_is_rejected(client, admin):
    assert client.get("/api/lead-board?date_from=not-a-date", headers=auth_headers(admin)).status_code == 422


def test_list_toggles_match_board(client, db, admin, staff, stages, lead):
    from app.models import LeadTask

    now = datetime.now(timezone.utc)
    late = add_lead(db, stages["Созвон"], "Просрочен", setter=staff)
    future = add_lead(db, stages["Созвон"], "Будущий", setter=staff)
    bare = add_lead(db, stages["Созвон"], "Без задачи")
    won = add_lead(db, stages["Оплачено"], "Оплатил")
    db.add_all([
        LeadTask(lead_id=late.id, kind="call", due_at=now - timedelta(hours=2), status="open"),
        LeadTask(lead_id=future.id, kind="call", due_at=now + timedelta(days=2), status="open"),
    ])
    db.commit()

    def listed(**params):
        r = client.get("/api/leads", params={**params, "limit": 100}, headers=auth_headers(admin))
        assert r.status_code == 200, r.text
        return {i["id"] for i in r.json()["items"]}

    for params in (
        {"overdue": True}, {"no_task": True}, {"unassigned": True},
        {"mine": True}, {"show_closed": False}, {"show_closed": True},
    ):
        # The board hides closed leads by default, so compare with the flag stated explicitly.
        params = {"show_closed": False, **params}
        assert listed(**params) == set(ids(board(client, admin, **params))), params
    assert listed(overdue=True) == {late.id}
    assert bare.id in listed(no_task=True) and late.id not in listed(no_task=True)
    assert won.id in listed() and won.id not in listed(show_closed=False)
