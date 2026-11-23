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
