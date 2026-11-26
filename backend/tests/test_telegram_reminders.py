from datetime import datetime, timedelta, timezone

import pytest

from app.core.security import hash_password
from app.models import Lead, Meeting, MeetingStatus, Role, TelegramSent, TelegramSettings, User
from app.services.telegram.client import TelegramError
from app.services.telegram.meeting_reminders import run_due

BISHKEK = timezone(timedelta(hours=6))


def local(h, m=0, day=26):
    return datetime(2026, 11, day, h, m, tzinfo=BISHKEK).astimezone(timezone.utc)


class FakeClient:
    def __init__(self, sent, fail=None):
        self.sent, self.fail = sent, fail

    def send_message(self, chat_id, text):
        if self.fail:
            raise self.fail
        self.sent.append((chat_id, text))


@pytest.fixture()
def tg(db):
    s = TelegramSettings(id=1, enabled=True, bot_token="t", chat_id="-1")
    db.add(s)
    db.commit()
    return s


def user(db, name, nick=""):
    u = User(name=name, email=f"{name}@t.kg", password_hash=hash_password("x"),
             role=Role.admin, telegram_username=nick)
    db.add(u)
    db.commit()
    return u


def meeting(db, when, closer=None, setter=None, **kw):
    kw.setdefault("client_name", "Айбек Т.")
    kw.setdefault("client_phone", "+996 700 111 111")
    m = Meeting(meeting_date=when, closer_id=closer.id if closer else None,
                setter_id=setter.id if setter else None, **kw)
    db.add(m)
    db.commit()
    return m


def tick(db, now, sent, fail=None):
    run_due(db, lambda token: FakeClient(sent, fail), now)


def test_digest_sent_once_after_ten(db, tg):
    meeting(db, local(15, 30), client_name="Второй")
    meeting(db, local(13), client_name="Первый")
    sent = []
    tick(db, local(9, 59), sent)
    assert sent == []
    tick(db, local(10), sent)
    assert len(sent) == 1
    text = sent[0][1]
    assert sent[0][0] == "-1"
    assert "Встречи на сегодня, 26.11 — 2" in text
    assert text.index("Первый") < text.index("Второй")
    tick(db, local(10, 1), sent)
    assert len(sent) == 1


def test_digest_late_start_and_empty_day(db, tg):
    sent = []
    tick(db, local(12), sent)
    assert sent == []
    meeting(db, local(18))
    tick(db, local(12), sent)
    assert len(sent) == 1


def test_digest_skips_other_days_and_statuses(db, tg):
    meeting(db, local(0, 30, day=27))
    meeting(db, local(16), status=MeetingStatus.closed)
    sent = []
    tick(db, local(10), sent)
    assert sent == []


def test_reminder_window(db, tg):
    meeting(db, local(11))
    db.add(TelegramSent(key="digest:2026-11-26"))
    db.commit()
    sent = []
    tick(db, local(9, 29), sent)
    assert sent == []
    tick(db, local(9, 30), sent)
    assert len(sent) == 1 and "Через 1,5 часа встреча — 11:00" in sent[0][1]
    tick(db, local(9, 31), sent)
    assert len(sent) == 1


def test_reminder_immediate_and_started(db, tg):
    db.add(TelegramSent(key="digest:2026-11-26"))
    meeting(db, local(10, 20))
    sent = []
    tick(db, local(10), sent)
    assert len(sent) == 1
    started = meeting(db, local(9, 0), client_name="Начавшаяся")
    tick(db, local(10), sent)
    assert len(sent) == 1


def test_rescheduled_meeting_reminded_again(db, tg):
    db.add(TelegramSent(key="digest:2026-11-26"))
    m = meeting(db, local(11))
    sent = []
    tick(db, local(9, 30), sent)
    assert len(sent) == 1
    m.meeting_date = local(14)
    db.commit()
    tick(db, local(12, 30), sent)
    assert len(sent) == 2 and "14:00" in sent[1][1]


def test_mentions_and_escaping(db, tg):
    db.add(TelegramSent(key="digest:2026-11-26"))
    closer = user(db, "Адахан", "adahan")
    setter = user(db, "Нурай")
    lead = Lead(client_name="L", phone="1")
    db.add(lead)
    db.commit()
    meeting(db, local(11), closer=closer, setter=setter, client_name="ООО <Нур> & Co",
            address="ул. Киевская 95", lead_id=lead.id)
    sent = []
    tick(db, local(9, 30), sent)
    text = sent[0][1]
    assert "@adahan" in text and "сеттер Нурай" in text and "@Нурай" not in text
    assert "ООО &lt;Нур&gt; &amp; Co" in text
    assert "Адрес: ул. Киевская 95" in text
    assert f'<a href="http://localhost:3000/leads/{lead.id}">' in text


def test_closer_without_nick_and_no_lead_link(db, tg):
    db.add(TelegramSent(key="digest:2026-11-26"))
    closer = user(db, "Адахан")
    meeting(db, local(11), closer=closer)
    sent = []
    tick(db, local(9, 30), sent)
    text = sent[0][1]
    assert "Клоузер Адахан" in text and "@Адахан" not in text
    assert "/sales/meetings" in text
    assert "Адрес:" not in text


def test_send_failure_records_error_and_retries(db, tg):
    db.add(TelegramSent(key="digest:2026-11-26"))
    meeting(db, local(11))
    sent = []
    tick(db, local(9, 30), sent, fail=TelegramError("Бот не в группе"))
    db.refresh(tg)
    assert tg.last_error == "Бот не в группе" and tg.last_error_at is not None
    assert db.query(TelegramSent).filter(TelegramSent.key.like("meeting:%")).count() == 0
    tick(db, local(9, 31), sent)
    db.refresh(tg)
    assert len(sent) == 1 and tg.last_error == ""


def test_disabled_or_unconfigured_sends_nothing(db, tg):
    meeting(db, local(11))
    sent = []
    tg.enabled = False
    db.commit()
    tick(db, local(10), sent)
    tg.enabled, tg.chat_id = True, ""
    db.commit()
    tick(db, local(10), sent)
    assert sent == []
