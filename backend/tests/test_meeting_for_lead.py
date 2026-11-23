"""POST /api/meetings with a lead: one scheduling path, stage-aware."""
from app.models import Lead, LeadStatus, Meeting
from app.services.leads import change_lead_stage
from tests.conftest import auth_headers


def _body(lead, closer, **kw):
    body = {
        "closer_id": closer.id, "meeting_date": "2026-12-01T06:00:00Z",
        "client_name": lead.client_name, "lead_id": lead.id,
    }
    body.update(kw)
    return body


def _post(client, user, body):
    return client.post("/api/meetings", json=body, headers=auth_headers(user))


def test_meeting_for_early_lead_moves_stage(client, db, staff, other_staff, lead, stages):
    lead.stage_id = stages["Созвон"].id
    db.commit()
    r = _post(client, staff, _body(lead, other_staff, address="Офис", notes="взять договор"))
    assert r.status_code == 201, r.text
    db.refresh(lead)
    assert lead.stage_id == stages["Встреча"].id
    m = db.query(Meeting).filter_by(lead_id=lead.id).one()
    assert m.address == "Офис" and m.notes == "взять договор"
    assert m.meeting_date.replace(tzinfo=None).isoformat() == "2026-12-01T06:00:00"
    assert r.json()["id"] == m.id


def test_meeting_for_contract_lead_keeps_stage(client, db, staff, other_staff, lead, stages):
    r = _post(client, staff, _body(lead, other_staff))
    assert r.status_code == 201, r.text
    db.refresh(lead)
    assert lead.stage_id == stages["Договор"].id
    assert db.query(Meeting).filter_by(lead_id=lead.id).count() == 1


def test_existing_open_meeting_is_rescheduled(client, db, staff, other_staff, lead):
    first = _post(client, staff, _body(lead, other_staff)).json()
    second = _post(client, staff, _body(lead, other_staff, meeting_date="2026-12-05T08:00:00Z"))
    assert second.status_code == 201, second.text
    rows = db.query(Meeting).filter_by(lead_id=lead.id).all()
    assert len(rows) == 1
    assert second.json()["id"] == first["id"]
    assert rows[0].meeting_date.replace(tzinfo=None).isoformat() == "2026-12-05T08:00:00"


def test_closed_lead_rejected(client, db, staff, other_staff, lead, stages):
    lead.stage_id = stages["Минус"].id
    db.commit()
    r = _post(client, staff, _body(lead, other_staff))
    assert r.status_code == 422 and "закрыт" in r.json()["detail"]
    lead.stage_id = stages["Договор"].id
    lead.status = LeadStatus.archived
    db.commit()
    assert _post(client, staff, _body(lead, other_staff)).status_code == 422
    lead.stage_id = stages["Оплачено"].id
    lead.status = LeadStatus.active
    db.commit()
    assert _post(client, staff, _body(lead, other_staff)).status_code == 422
    assert db.query(Meeting).count() == 0


def test_setter_from_payload_then_lead(client, db, staff, other_staff, admin, lead):
    r = _post(client, admin, _body(lead, other_staff, setter_id=other_staff.id))
    assert r.json()["setter_id"] == other_staff.id
    db.query(Meeting).delete()
    db.commit()
    r = _post(client, admin, _body(lead, other_staff))
    assert r.json()["setter_id"] == lead.setter_id == staff.id


def test_stage_transition_fills_lead_closer(db, staff, other_staff, lead, stages):
    lead.closer_id = None
    lead.stage_id = stages["Созвон"].id
    db.commit()
    change_lead_stage(db, lead, stages["Встреча"].id, extra_data={
        "meeting_date": "2026-12-01", "meeting_time": "12:00", "closer_id": other_staff.id,
    })
    db.commit()
    assert lead.closer_id == other_staff.id
    # an already-set closer is never overwritten
    change_lead_stage(db, lead, stages["Созвон"].id)
    change_lead_stage(db, lead, stages["Встреча"].id, extra_data={
        "meeting_date": "2026-12-02", "meeting_time": "12:00", "closer_id": staff.id,
    })
    db.commit()
    assert lead.closer_id == other_staff.id


def test_open_only_filter(client, db, admin, lead, stages):
    def add(name, stage, status=LeadStatus.active):
        db.add(Lead(client_name=name, phone="1", stage_id=stage.id, status=status))

    add("Архив", stages["Созвон"], LeadStatus.archived)
    add("Оплачен", stages["Оплачено"])
    add("Минус", stages["Минус"])
    db.add(Lead(client_name="БезЭтапа", phone="2", status=LeadStatus.active))
    db.commit()
    r = client.get("/api/leads?open_only=true&limit=100", headers=auth_headers(admin))
    names = {i["client_name"] for i in r.json()["items"]}
    assert names == {"Клиент", "БезЭтапа"}


def test_stage_endpoint_ignores_client_meeting_datetime(client, db, admin, lead, other_staff, stages):
    lead.stage_id = stages["Созвон"].id
    db.commit()
    r = client.patch(f"/api/leads/{lead.id}/stage", headers=auth_headers(admin), json={
        "to_stage_id": stages["Встреча"].id,
        "extra_data": {
            "meeting_date": "2026-12-01", "meeting_time": "12:00",
            "closer_id": other_staff.id, "meeting_datetime": "garbage",
        },
    })
    assert r.status_code == 200, r.text
    m = db.query(Meeting).filter_by(lead_id=lead.id).one()
    assert m.meeting_date.replace(tzinfo=None).isoformat() == "2026-12-01T06:00:00"


def test_sub_meeting_with_lead_keeps_parent(client, db, staff, other_staff, lead):
    parent = _post(client, staff, _body(lead, other_staff)).json()
    r = _post(client, staff, _body(lead, other_staff, meeting_date="2026-12-09T06:00:00Z", parent_id=parent["id"]))
    assert r.status_code == 201, r.text
    child = r.json()
    assert child["id"] != parent["id"] and child["parent_id"] == parent["id"]
    assert child["setter_id"] == staff.id
    db.expire_all()
    p = db.get(Meeting, parent["id"])
    assert p.meeting_date.replace(tzinfo=None).isoformat() == "2026-12-01T06:00:00"
    assert db.query(Meeting).filter_by(lead_id=lead.id).count() == 2


def test_sub_meeting_for_closed_lead_allowed(client, db, staff, other_staff, lead, stages):
    parent = _post(client, staff, _body(lead, other_staff)).json()
    lead.stage_id = stages["Оплачено"].id
    db.commit()
    r = _post(client, staff, _body(lead, other_staff, meeting_date="2026-12-09T06:00:00Z", parent_id=parent["id"]))
    assert r.status_code == 201, r.text
    assert r.json()["parent_id"] == parent["id"]
    db.refresh(lead)
    assert lead.stage_id == stages["Оплачено"].id


def test_archived_meeting_stage_ignored(client, db, staff, other_staff, lead, stages):
    from app.models import LeadStage
    # The original «Встреча» (lowest id) is archived; a fresh active meeting stage replaces it.
    stages["Встреча"].is_archived = True
    fresh = LeadStage(name="Встреча 2", position=2, kind="meeting")
    db.add(fresh)
    lead.stage_id = stages["Новый лид"].id
    db.commit()
    r = _post(client, staff, _body(lead, other_staff))
    assert r.status_code == 201, r.text
    db.refresh(lead)
    assert lead.stage_id == fresh.id


def test_stage_transition_error_is_422(client, db, staff, other_staff, lead, stages, monkeypatch):
    from app.routers import meetings as meetings_router
    from app.services.leads import StageTransitionError

    def boom(*a, **kw):
        raise StageTransitionError("нельзя")

    monkeypatch.setattr(meetings_router, "change_lead_stage", boom)
    lead.stage_id = stages["Созвон"].id
    db.commit()
    r = _post(client, staff, _body(lead, other_staff))
    assert r.status_code == 422 and r.json()["detail"] == "нельзя"


def test_founder_can_create_meeting(client, db, other_staff, lead):
    from app.core.security import hash_password
    from app.models import Role, User
    founder = User(name="Основатель", email="f@test.kg", password_hash=hash_password("x"),
                   role=Role.staff, position="Директор", is_founder=True, is_active=True)
    db.add(founder)
    db.commit()
    r = _post(client, founder, _body(lead, other_staff))
    assert r.status_code == 201, r.text
