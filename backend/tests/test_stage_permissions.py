"""Sales head (not only admin) configures the lead board stages, with service-stage protection."""
import pytest

from app.core.security import hash_password
from app.models import Lead, LeadStatus, Role, User
from tests.conftest import auth_headers


@pytest.fixture()
def head(db) -> User:
    u = User(
        name="РОП", email="head@test.kg", password_hash=hash_password("x"),
        role=Role.staff, position="Руководитель продаж", is_active=True,
    )
    db.add(u)
    db.commit()
    return u


def _pos(client, user, name):
    rows = client.get("/api/settings/stages", headers=auth_headers(user)).json()
    return next(s["position"] for s in rows if s["name"] == name)


def test_head_can_create_rename_reorder_and_archive_generic(client, head, stages):
    h = auth_headers(head)
    r = client.post("/api/settings/stages", json={"name": "Демо"}, headers=h)
    assert r.status_code == 201, r.text
    sid = r.json()["id"]
    r = client.patch(f"/api/settings/stages/{sid}", json={"name": "Демо 2", "color": "#00ff00"}, headers=h)
    assert r.status_code == 200, r.text
    assert r.json()["name"] == "Демо 2"
    r = client.post(f"/api/settings/stages/{sid}/reorder?new_position=0", headers=h)
    assert r.status_code == 200, r.text
    r = client.post(f"/api/settings/stages/{sid}/archive", headers=h)
    assert r.status_code == 200, r.text
    assert r.json()["is_archived"] is True


def test_new_stage_goes_before_won_and_lost(client, head, stages):
    r = client.post("/api/settings/stages", json={"name": "Новый"}, headers=auth_headers(head))
    assert r.status_code == 201, r.text
    new_pos = r.json()["position"]
    assert new_pos < _pos(client, head, "Оплачено")
    assert new_pos < _pos(client, head, "Минус")
    rows = client.get("/api/settings/stages", headers=auth_headers(head)).json()
    assert sorted(s["position"] for s in rows) == list(range(len(rows)))


def test_head_cannot_archive_service_stage(client, head, stages, db):
    r = client.post(f"/api/settings/stages/{stages['Встреча'].id}/archive", headers=auth_headers(head))
    assert r.status_code == 422
    db.refresh(stages["Встреча"])
    assert stages["Встреча"].is_archived is False


def test_head_cannot_change_kind(client, head, stages):
    h = auth_headers(head)
    sid = stages["Созвон"].id
    assert client.patch(f"/api/settings/stages/{sid}", json={"kind": "won"}, headers=h).status_code == 422
    assert client.patch(f"/api/settings/stages/{sid}", json={"is_lost": True}, headers=h).status_code == 422
    assert client.post("/api/settings/stages", json={"name": "X", "kind": "meeting"}, headers=h).status_code == 422


def test_head_can_rename_service_stage(client, head, stages):
    r = client.patch(
        f"/api/settings/stages/{stages['Встреча'].id}",
        json={"name": "Встреча с клиентом", "color": "#ff0000"},
        headers=auth_headers(head),
    )
    assert r.status_code == 200, r.text
    assert r.json()["name"] == "Встреча с клиентом" and r.json()["kind"] == "meeting"


def test_admin_unrestricted(client, admin, stages):
    h = auth_headers(admin)
    r = client.patch(f"/api/settings/stages/{stages['Созвон'].id}", json={"kind": "won"}, headers=h)
    assert r.status_code == 200 and r.json()["kind"] == "won"
    r = client.post(f"/api/settings/stages/{stages['Встреча'].id}/archive", headers=h)
    assert r.status_code == 200 and r.json()["is_archived"] is True


def test_staff_forbidden(client, staff, stages):
    h = auth_headers(staff)
    sid = stages["Созвон"].id
    assert client.post("/api/settings/stages", json={"name": "X"}, headers=h).status_code == 403
    assert client.patch(f"/api/settings/stages/{sid}", json={"name": "Y"}, headers=h).status_code == 403
    assert client.post(f"/api/settings/stages/{sid}/archive", headers=h).status_code == 403
    assert client.post(f"/api/settings/stages/{sid}/reorder?new_position=0", headers=h).status_code == 403


def test_stage_lead_counts(client, admin, stages, lead, db):
    db.add(Lead(
        client_name="Архивный", phone="+996 700 000002", stage_id=stages["Договор"].id,
        status=LeadStatus.archived,
    ))
    db.commit()
    rows = client.get("/api/settings/stages?with_counts=true", headers=auth_headers(admin)).json()
    counts = {s["name"]: s["lead_count"] for s in rows}
    assert counts["Договор"] == 1
    assert counts["Созвон"] == 0
    plain = client.get("/api/settings/stages", headers=auth_headers(admin)).json()
    assert "lead_count" not in plain[0]


def test_create_stage_with_gapped_positions(client, head, stages, db):
    # Gaps, e.g. left behind by manual edits: 0, 5, 10, 20(won), 30(lost)
    for name, pos in (("Новый лид", 0), ("Созвон", 5), ("Встреча", 10), ("Договор", 12),
                      ("Ожидание оплаты", 15), ("Оплачено", 20), ("Минус", 30)):
        stages[name].position = pos
    db.commit()
    r = client.post("/api/settings/stages", json={"name": "Между"}, headers=auth_headers(head))
    assert r.status_code == 201, r.text
    rows = client.get("/api/settings/stages", headers=auth_headers(head)).json()
    assert sorted(s["position"] for s in rows) == list(range(len(rows)))
    names = [s["name"] for s in sorted(rows, key=lambda s: s["position"])]
    assert names.index("Между") == names.index("Оплачено") - 1


def test_head_cannot_touch_is_archived_via_patch(client, head, admin, stages):
    h = auth_headers(head)
    sid = stages["Созвон"].id
    assert client.patch(f"/api/settings/stages/{sid}", json={"is_archived": True}, headers=h).status_code == 422
    # admin archives a service stage; head must not be able to bring it back
    mid = stages["Встреча"].id
    assert client.post(f"/api/settings/stages/{mid}/archive", headers=auth_headers(admin)).status_code == 200
    assert client.patch(f"/api/settings/stages/{mid}", json={"is_archived": False}, headers=h).status_code == 422
    rows = client.get("/api/settings/stages?include_archived=true", headers=h).json()
    assert next(s for s in rows if s["id"] == mid)["is_archived"] is True


def test_archive_prefers_generic_target(client, head, stages, db):
    # First active non-final stage is a service one; generic must still win.
    stages["Новый лид"].position = 3
    stages["Договор"].position = 0
    stages["Созвон"].is_archived = True
    db.commit()
    lead = Lead(client_name="К", phone="+996 700 000009", stage_id=stages["Новый лид"].id,
                status=LeadStatus.active)
    db.add(lead)
    # archive a generic stage whose sibling generic stage is after a service one
    extra = client.post("/api/settings/stages", json={"name": "Доп"}, headers=auth_headers(head)).json()
    lead.stage_id = extra["id"]
    db.commit()
    r = client.post(f"/api/settings/stages/{extra['id']}/archive", headers=auth_headers(head))
    assert r.status_code == 200, r.text
    db.refresh(lead)
    assert lead.stage_id == stages["Новый лид"].id
