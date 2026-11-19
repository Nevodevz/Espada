"""Closer is an explicit user flag, editable only by admins."""
from tests.conftest import auth_headers


def test_users_list_exposes_is_closer(client, admin, staff):
    r = client.get("/api/users", headers=auth_headers(admin))
    assert r.status_code == 200
    assert all("is_closer" in u for u in r.json())
    assert next(u for u in r.json() if u["id"] == staff.id)["is_closer"] is False


def test_admin_can_toggle_is_closer(client, db, admin, staff):
    r = client.patch(f"/api/users/{staff.id}", json={"is_closer": True}, headers=auth_headers(admin))
    assert r.status_code == 200 and r.json()["is_closer"] is True
    db.refresh(staff)
    assert staff.is_closer is True


def test_staff_cannot_make_self_closer(client, db, staff):
    r = client.patch(
        f"/api/users/{staff.id}", json={"is_closer": True, "name": "Новое"}, headers=auth_headers(staff),
    )
    assert r.status_code == 200
    db.refresh(staff)
    assert staff.is_closer is False and staff.name == "Новое"


def test_admin_creates_user_as_closer(client, admin):
    r = client.post("/api/users", headers=auth_headers(admin), json={
        "name": "Адахан", "email": "adahan@test.kg", "password": "x12345678",
        "position": "Финансы", "is_closer": True,
    })
    assert r.status_code in (200, 201), r.text
    assert r.json()["is_closer"] is True
