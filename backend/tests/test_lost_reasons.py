"""Required loss reason and the «Причины отказа» stats."""
from datetime import date, datetime, timezone

import pytest

from app.models import Department, Lead, LeadStageHistory, LeadStatus, RejectReason
from app.services.sales_metrics import lost_reasons
from tests.conftest import auth_headers

D1, D2 = date(2026, 11, 1), date(2026, 11, 30)
WHEN = datetime(2026, 11, 10, 6, 0, tzinfo=timezone.utc)


@pytest.fixture()
def reason(db):
    r = RejectReason(name="Не выходит на связь")
    db.add(r)
    db.commit()
    return r


@pytest.fixture()
def sales(db, staff):
    dept = Department(name="Отдел продаж", slug="sales", kind="sales", members=[staff])
    db.add(dept)
    db.commit()
    return dept


def to_lost(client, admin, lead, stages, **extra):
    return client.patch(f"/api/leads/{lead.id}/stage", headers=auth_headers(admin),
                        json={"to_stage_id": stages["Минус"].id, "extra_data": extra})


def test_lost_without_reason_rejected(client, db, admin, lead, stages):
    before = lead.stage_id
    r = to_lost(client, admin, lead, stages)
    assert r.status_code == 422 and "причину отказа" in r.json()["detail"]
    db.refresh(lead)
    assert lead.stage_id == before


def test_lost_with_inactive_reason_rejected(client, db, admin, lead, stages, reason):
    reason.is_active = False
    db.commit()
    assert to_lost(client, admin, lead, stages, reject_reason_id=reason.id).status_code == 422


def test_lost_with_reason_ok(client, db, admin, lead, stages, reason):
    assert to_lost(client, admin, lead, stages, reject_reason_id=reason.id).status_code == 200
    db.refresh(lead)
    assert lead.stage_id == stages["Минус"].id and lead.reject_reason_id == reason.id


def test_no_answer_suggestion_path_still_works(client, db, admin, staff, lead, stages, reason, sales):
    for _ in range(5):
        tid = client.post(f"/api/leads/{lead.id}/tasks", headers=auth_headers(staff),
                          json={"kind": "call", "due_at": "2030-01-01T00:00:00+00:00", "comment": ""}).json()["id"]
        out = client.post(f"/api/lead-tasks/{tid}/complete", json={"result": "no_answer"},
                          headers=auth_headers(staff)).json()
    assert out["suggest_lost"] is True
    r = to_lost(client, admin, lead, stages, reject_reason_id=reason.id)
    assert r.status_code == 200, r.text


def mk_lost(db, stages, setter, reason, name="Л"):
    l = Lead(client_name=name, phone="+996 700 111111", status=LeadStatus.active,
             stage_id=stages["Минус"].id, setter_id=setter.id if setter else None,
             reject_reason_id=reason.id if reason else None)
    db.add(l)
    db.flush()
    db.add(LeadStageHistory(lead_id=l.id, from_stage_id=None, to_stage_id=stages["Минус"].id, created_at=WHEN))
    db.commit()
    return l


def test_lost_reasons_counts_and_pct(db, stages, staff, other_staff, reason):
    other = RejectReason(name="Дорого")
    db.add(other)
    db.commit()
    mk_lost(db, stages, staff, reason)
    mk_lost(db, stages, staff, reason)
    mk_lost(db, stages, other_staff, reason)
    mk_lost(db, stages, staff, other)
    rows = lost_reasons(db, D1, D2)
    top = rows[0]
    assert top["reason_id"] == reason.id and top["count"] == 3 and top["pct"] == 75.0
    assert {(u["user_id"], u["count"]) for u in top["by_user"]} == {(staff.id, 2), (other_staff.id, 1)}
    assert rows[1]["name"] == "Дорого" and rows[1]["pct"] == 25.0


def test_lost_reasons_without_reason_row(db, stages, staff):
    mk_lost(db, stages, staff, None)
    rows = lost_reasons(db, D1, D2)
    assert rows == [{"reason_id": None, "name": "Без причины", "count": 1, "pct": 100.0,
                     "by_user": [{"user_id": staff.id, "name": staff.name, "count": 1}]}]


def test_lost_reasons_period_filter(db, stages, staff, reason):
    mk_lost(db, stages, staff, reason)
    assert lost_reasons(db, date(2026, 12, 1), date(2026, 12, 31)) == []


def test_lost_reasons_staff_only_own(client, db, stages, staff, other_staff, reason, sales):
    mk_lost(db, stages, staff, reason)
    mk_lost(db, stages, other_staff, reason)
    r = client.get("/api/sales-hub/metrics?date_from=2026-11-01&date_to=2026-11-30", headers=auth_headers(staff))
    assert r.status_code == 200, r.text
    rows = r.json()["lost_reasons"]
    assert len(rows) == 1 and rows[0]["count"] == 1 and rows[0]["by_user"][0]["user_id"] == staff.id


# ── Final review: no way into «Минус» around the stage endpoint ───
@pytest.mark.parametrize("stage_name", ["Минус", "Оплачено"])
def test_create_lead_on_closed_stage_rejected(client, admin, stages, stage_name):
    r = client.post("/api/leads", headers=auth_headers(admin),
                    json={"client_name": "Новый", "phone": "+996 700 909090",
                          "stage_id": stages[stage_name].id})
    assert r.status_code == 422
    assert "Нельзя создать лид сразу в этом этапе" in r.json()["detail"]


def test_create_lead_on_generic_stage_ok(client, admin, stages):
    r = client.post("/api/leads", headers=auth_headers(admin),
                    json={"client_name": "Новый", "phone": "+996 700 909091",
                          "stage_id": stages["Созвон"].id})
    assert r.status_code in (200, 201), r.text
    assert r.json()["stage_id"] == stages["Созвон"].id


@pytest.mark.parametrize("stage_name", ["Минус", "Оплачено", "Встреча"])
def test_patch_lead_cannot_jump_to_special_stage(client, db, admin, lead, stages, stage_name):
    before = lead.stage_id
    r = client.patch(f"/api/leads/{lead.id}", headers=auth_headers(admin),
                     json={"stage_id": stages[stage_name].id})
    assert r.status_code == 422
    assert "Этап меняется через перевод этапа" in r.json()["detail"]
    db.refresh(lead)
    assert lead.stage_id == before


def test_patch_lead_same_or_generic_stage_ok(client, db, admin, lead, stages):
    r = client.patch(f"/api/leads/{lead.id}", headers=auth_headers(admin),
                     json={"stage_id": lead.stage_id, "comment": "x"})
    assert r.status_code == 200, r.text
    r = client.patch(f"/api/leads/{lead.id}", headers=auth_headers(admin),
                     json={"stage_id": stages["Созвон"].id})
    assert r.status_code == 200, r.text


@pytest.mark.parametrize("garbage", ["abc", [1], {"x": 1}])
def test_lost_with_garbage_reason_is_422(client, db, admin, lead, stages, garbage):
    r = to_lost(client, admin, lead, stages, reject_reason_id=garbage)
    assert r.status_code == 422
    assert "причину отказа" in r.json()["detail"]
