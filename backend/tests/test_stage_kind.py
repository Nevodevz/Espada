"""Stage behaviour comes from the stored `kind`, never from the stage name."""
from app.models import LeadStage, Meeting
from app.services.leads import change_lead_stage
from tests.conftest import auth_headers


def test_renamed_meeting_stage_still_creates_meeting(db, lead, stages):
    st = stages["Встреча"]
    st.name = "Презентация"
    db.commit()
    change_lead_stage(db, lead, st.id, extra_data={"meeting_date": "2026-12-01", "meeting_time": "12:00"})
    assert db.query(Meeting).filter_by(lead_id=lead.id).count() == 1


def test_generic_stage_named_like_meeting_needs_no_date(client, admin, lead, stages, db):
    s = LeadStage(name="Встреча-2", position=10, kind="generic")
    db.add(s)
    db.commit()
    r = client.patch(f"/api/leads/{lead.id}/stage", json={"to_stage_id": s.id}, headers=auth_headers(admin))
    assert r.status_code == 200, r.text


def test_setting_kind_syncs_won_lost_flags(client, admin, stages):
    sid = stages["Созвон"].id
    r = client.patch(f"/api/settings/stages/{sid}", json={"kind": "won"}, headers=auth_headers(admin))
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["kind"] == "won" and body["is_won"] is True and body["is_lost"] is False


def test_unknown_kind_is_rejected(client, admin, stages):
    r = client.patch(f"/api/settings/stages/{stages['Созвон'].id}", json={"kind": "demo"}, headers=auth_headers(admin))
    assert r.status_code == 422


def test_stages_list_exposes_kind(client, admin, stages):
    rows = client.get("/api/settings/stages", headers=auth_headers(admin)).json()
    kinds = {s["name"]: s["kind"] for s in rows}
    assert kinds["Встреча"] == "meeting" and kinds["Минус"] == "lost" and kinds["Новый лид"] == "generic"


def test_new_stage_can_be_created_with_kind(client, admin):
    r = client.post("/api/settings/stages", json={"name": "Презентация", "kind": "meeting"}, headers=auth_headers(admin))
    assert r.status_code == 201, r.text
    assert r.json()["kind"] == "meeting"


def test_seed_lookups_store_stage_kinds(monkeypatch, engine):
    from sqlalchemy.orm import sessionmaker
    import app.seed as seed_module

    Session = sessionmaker(bind=engine)
    monkeypatch.setattr(seed_module, "SessionLocal", Session)
    seed_module.seed_lookups()
    s = Session()
    kinds = {st.name: st.kind for st in s.query(LeadStage).all()}
    s.close()
    assert kinds["Встреча"] == "meeting" and kinds["Договор"] == "contract"
    assert kinds["Ожидание оплаты"] == "waiting_payment" and kinds["Оплачено"] == "won"
    assert kinds["Минус"] == "lost" and kinds["Разработка"] == "generic"
