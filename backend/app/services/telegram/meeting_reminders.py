"""Telegram meeting reminders: morning digest and a reminder 90 minutes before each meeting."""
import asyncio
import logging
from datetime import date, datetime, timedelta, timezone
from html import escape
from typing import Callable

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.config import settings
from app.models import Meeting, MeetingStatus, TelegramSent, TelegramSettings, User
from app.services.telegram.client import TelegramClient, TelegramError

log = logging.getLogger(__name__)

DIGEST_HOUR = 10
REMIND_BEFORE = timedelta(minutes=90)
TICK_SECONDS = 60
LOCAL_TZ = timezone(timedelta(hours=6))  # Bishkek, no DST


def _utc(dt: datetime) -> datetime:
    return dt.replace(tzinfo=timezone.utc) if dt.tzinfo is None else dt.astimezone(timezone.utc)


def _local(dt: datetime) -> datetime:
    return _utc(dt).astimezone(LOCAL_TZ)


def mention(user: User | None) -> str:
    if user is None:
        return "не назначен"
    nick = (user.telegram_username or "").strip().lstrip("@")
    return f"@{escape(nick)}" if nick else escape(user.name or "не назначен")


def _setter_name(user: User | None) -> str:
    return escape(user.name) if user and user.name else "не назначен"


def _link(meeting: Meeting) -> str:
    base = settings.FRONTEND_URL.rstrip("/")
    path = f"/leads/{meeting.lead_id}" if meeting.lead_id else "/sales/meetings"
    return f'<a href="{base}{path}">Открыть лида</a>'


def _who(meeting: Meeting) -> str:
    parts = [escape(meeting.client_name or "")]
    if meeting.client_phone:
        parts.append(escape(meeting.client_phone))
    return " · ".join(parts)


def digest_text(meetings: list[Meeting], day: date) -> str:
    lines = [f"📅 Встречи на сегодня, {day:%d.%m} — {len(meetings)}", ""]
    for m in sorted(meetings, key=lambda x: _utc(x.meeting_date)):
        lines.append(f"{_local(m.meeting_date):%H:%M} · {_who(m)} · клоузер {mention(m.closer)}")
        tail = []
        if m.address:
            tail.append(escape(m.address))
        tail.append(f"сеттер {_setter_name(m.setter)}")
        lines.append("       " + " · ".join(tail))
    return "\n".join(lines)


def reminder_text(meeting: Meeting) -> str:
    lines = [f"⏰ Через 1,5 часа встреча — {_local(meeting.meeting_date):%H:%M}", _who(meeting)]
    if meeting.address:
        lines.append(f"Адрес: {escape(meeting.address)}")
    lines.append(f"Клоузер {mention(meeting.closer)} · сеттер {_setter_name(meeting.setter)}")
    lines.append(f"{_link(meeting)} →")
    return "\n".join(lines)


def _deliver(db: Session, cfg: TelegramSettings, client: TelegramClient, key: str, text: str) -> None:
    db.add(TelegramSent(key=key))
    try:
        db.commit()
    except IntegrityError:  # another process already sent it
        db.rollback()
        return
    try:
        client.send_message(cfg.chat_id, text)
    except TelegramError as exc:
        db.query(TelegramSent).filter(TelegramSent.key == key).delete()
        cfg.last_error = str(exc)
        cfg.last_error_at = datetime.now(timezone.utc)
        db.commit()
        return
    if cfg.last_error:
        cfg.last_error = ""
        cfg.last_error_at = None
        db.commit()


def run_due(db: Session, client_factory: Callable[[str], TelegramClient], now: datetime) -> None:
    cfg = db.get(TelegramSettings, 1)
    if cfg is None or not cfg.enabled or not cfg.bot_token or not cfg.chat_id:
        return
    now = _utc(now)
    client = client_factory(cfg.bot_token)
    scheduled = select(Meeting).where(Meeting.status == MeetingStatus.scheduled)

    local_now = now.astimezone(LOCAL_TZ)
    key = f"digest:{local_now:%Y-%m-%d}"
    if local_now.hour >= DIGEST_HOUR and db.query(TelegramSent.id).filter_by(key=key).first() is None:
        start = local_now.replace(hour=0, minute=0, second=0, microsecond=0).astimezone(timezone.utc)
        today = db.scalars(
            scheduled.where(Meeting.meeting_date >= start, Meeting.meeting_date < start + timedelta(days=1))
            .order_by(Meeting.meeting_date)
        ).all()
        if today:
            _deliver(db, cfg, client, key, digest_text(list(today), local_now.date()))

    upcoming = db.scalars(
        scheduled.where(Meeting.meeting_date > now, Meeting.meeting_date <= now + REMIND_BEFORE)
        .order_by(Meeting.meeting_date)
    ).all()
    for m in upcoming:
        when = _utc(m.meeting_date)
        if not (when - REMIND_BEFORE <= now < when):
            continue
        key = f"meeting:{m.id}:{when.isoformat()}"
        if db.query(TelegramSent.id).filter_by(key=key).first() is not None:
            continue
        _deliver(db, cfg, client, key, reminder_text(m))


def _tick(session_factory) -> None:
    db = session_factory()
    try:
        run_due(db, TelegramClient, datetime.now(timezone.utc))
    finally:
        db.close()


async def telegram_forever(session_factory) -> None:
    while True:
        try:
            await asyncio.to_thread(_tick, session_factory)
        except Exception:
            log.exception("telegram: reminder tick failed")
        await asyncio.sleep(TICK_SECONDS)
