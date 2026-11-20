"""Catch-up: messages missed while the backend was down are pulled from Evolution."""
from datetime import datetime, timedelta, timezone

import pytest

from app.core.config import settings
from app.main import app
from app.models import Lead, LeadSource, WhatsAppChat, WhatsAppMessage
from app.services.whatsapp import inbound
from app.services.whatsapp.catchup import catch_up
from app.services.whatsapp.provider import InboundMessage, ProviderError
from app.services.whatsapp.runtime import get_provider
from tests.conftest import auth_headers
from tests.whatsapp_fakes import FakeProvider

PHONE = "996703588048"
T0 = datetime(2026, 11, 20, 9, 0, tzinfo=timezone.utc)


def msg(ext, body="Привет", kind="text", mime="", at=T0, from_me=False):
    return InboundMessage(
        external_id=ext, remote_jid=f"{PHONE}@s.whatsapp.net", phone=PHONE, from_me=from_me,
        push_name="Бектур", kind=kind, body=body, media_b64=None, media_mime=mime, media_name="", sent_at=at,
    )


@pytest.fixture(autouse=True)
def media_root(tmp_path, monkeypatch):
    monkeypatch.setattr(settings, "WHATSAPP_MEDIA_ROOT", str(tmp_path / "wa"))


@pytest.fixture()
def wa_source(db):
    db.add(LeadSource(name="WhatsApp", position=0))
    db.commit()


class CatchupProvider(FakeProvider):
    def __init__(self, recent, media=None, media_error=False):
        super().__init__()
        self.recent, self.media, self.media_error = recent, media or {}, media_error
        self.since = None

    def recent_messages(self, since, limit=2000):
        self.since = since
        return list(self.recent)

    def media_base64(self, external_id):
        if self.media_error:
            raise ProviderError("media gone")
        return self.media.get(external_id)


def test_adds_only_missing_messages(db, stages, wa_source):
    inbound.handle_events(db, [msg("A")])
    db.commit()
    p = CatchupProvider([msg("A"), msg("B", body="Вы тут?", at=T0 + timedelta(minutes=1))])
    added = catch_up(db, p, since=T0 - timedelta(hours=2))
    db.commit()
    assert added == 1
    assert [m.external_id for m in db.query(WhatsAppMessage).order_by(WhatsAppMessage.id)] == ["A", "B"]
    assert db.query(Lead).count() == 1 and db.query(WhatsAppChat).one().unread_count == 2


def test_missed_first_message_creates_lead(db, stages, wa_source):
    added = catch_up(db, CatchupProvider([msg("A")]), since=T0 - timedelta(hours=1))
    db.commit()
    assert added == 1 and db.query(Lead).one().client_name == "Бектур"


def test_media_downloaded_for_missed_image(db, stages, wa_source):
    p = CatchupProvider([msg("IMG", body="", kind="image", mime="image/jpeg")], media={"IMG": "aGVsbG8="})
    catch_up(db, p, since=T0)
    db.commit()
    m = db.query(WhatsAppMessage).one()
    assert inbound.media_abspath(m.media_path).read_bytes() == b"hello"


def test_media_failure_keeps_message(db, stages, wa_source):
    p = CatchupProvider([msg("IMG", body="подпись", kind="image", mime="image/jpeg")], media_error=True)
    assert catch_up(db, p, since=T0) == 1
    db.commit()
    m = db.query(WhatsAppMessage).one()
    assert m.body == "подпись" and m.media_path == ""


def test_second_run_adds_nothing(db, stages, wa_source):
    p = CatchupProvider([msg("A"), msg("B", at=T0 + timedelta(minutes=1))])
    assert catch_up(db, p, since=T0) == 2
    db.commit()
    assert catch_up(db, p, since=T0) == 0


def test_manual_catch_up_endpoint(client, db, stages, admin, staff, wa_source):
    p = CatchupProvider([msg("A")])
    app.dependency_overrides[get_provider] = lambda: p
    try:
        assert client.post("/api/whatsapp/catch-up", headers=auth_headers(staff)).status_code == 403
        r = client.post("/api/whatsapp/catch-up?hours=6", headers=auth_headers(admin))
    finally:
        app.dependency_overrides.pop(get_provider, None)
    assert r.status_code == 200 and r.json() == {"added": 1}
    window = datetime.now(timezone.utc) - p.since
    assert abs(window - timedelta(hours=6)) < timedelta(minutes=1)
