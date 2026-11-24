"""Duplicate leads are matched by phone digits (phone or whatsapp), active leads only."""
from app.models import Lead, LeadStatus
from app.services.leads import find_duplicate_lead
from tests.conftest import auth_headers


def _mk(db, stages, staff, **kw):
    l = Lead(client_name=kw.pop("client_name", "Другой"), stage_id=stages["Новый лид"].id,
             setter_id=staff.id, status=kw.pop("status", LeadStatus.active), **kw)
    db.add(l)
    db.commit()
    return l


def test_duplicate_by_digits(db, lead):
    # fixture lead has "+996 700 000001"
    assert find_duplicate_lead(db, ["0700 000 001"]).id == lead.id
    assert find_duplicate_lead(db, ["700000001"]).id == lead.id
    assert find_duplicate_lead(db, ["0700 000 002"]) is None
    assert find_duplicate_lead(db, ["", "  "]) is None


def test_duplicate_matches_whatsapp_field(db, stages, staff):
    l = _mk(db, stages, staff, phone="", whatsapp="+996 555 111222")
    assert find_duplicate_lead(db, ["0555 111 222"]).id == l.id
    assert find_duplicate_lead(db, ["", "0555111222"]).id == l.id


def test_archived_lead_not_duplicate(db, stages, staff):
    _mk(db, stages, staff, phone="+996 555 999000", status=LeadStatus.archived)
    assert find_duplicate_lead(db, ["0555 999 000"]) is None


def test_exclude_self(db, lead):
    assert find_duplicate_lead(db, [lead.phone], exclude_id=lead.id) is None
    assert find_duplicate_lead(db, [lead.phone], exclude_id=lead.id + 100).id == lead.id


def test_create_returns_409_with_existing(client, staff, lead):
    r = client.post("/api/leads", json={"client_name": "Новый", "phone": "0700 000 001"},
                    headers=auth_headers(staff))
    assert r.status_code == 409
    d = r.json()["detail"]
    assert d["existing"] == {"id": lead.id, "client_name": "Клиент", "stage_id": lead.stage_id}
    r = client.post("/api/leads", json={"client_name": "Новый", "whatsapp": "996700000001"},
                    headers=auth_headers(staff))
    assert r.status_code == 409
    r = client.post("/api/leads", json={"client_name": "Новый", "phone": "0700 000 001", "force": True},
                    headers=auth_headers(staff))
    assert r.status_code == 201, r.text


def test_duplicates_endpoint(client, staff, lead):
    h = auth_headers(staff)
    r = client.get("/api/leads/duplicates", params={"phone": "0700000001"}, headers=h)
    assert r.status_code == 200
    assert r.json()["existing"]["id"] == lead.id
    r = client.get("/api/leads/duplicates", params={"phone": "0700000001", "exclude_id": lead.id}, headers=h)
    assert r.json() == {"existing": None}
    r = client.get("/api/leads/duplicates", params={"phone": ""}, headers=h)
    assert r.json() == {"existing": None}
