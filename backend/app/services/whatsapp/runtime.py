"""Provider wiring. Tests override `get_provider` through FastAPI dependency_overrides."""
import asyncio
import logging
from functools import lru_cache

from app.core.config import settings
from app.services.whatsapp.evolution import EvolutionProvider
from app.services.whatsapp.provider import WhatsAppProvider

log = logging.getLogger(__name__)

STATE_POLL_SECONDS = 60
CATCHUP_EVERY_SECONDS = 300
CATCHUP_STARTUP_HOURS = 24   # after a restart: everything Evolution kept for the last day
CATCHUP_WINDOW_HOURS = 2     # periodic: overlapping window, dedup makes repeats free


@lru_cache(maxsize=1)
def _evolution(url: str, key: str, instance: str) -> EvolutionProvider:
    return EvolutionProvider(url, key, instance)


def whatsapp_configured() -> bool:
    """compose always sets EVOLUTION_URL; WhatsApp counts as set up only once the key and secret exist."""
    return bool(settings.EVOLUTION_URL and settings.EVOLUTION_API_KEY and settings.WHATSAPP_WEBHOOK_SECRET)


def get_provider() -> WhatsAppProvider | None:
    """The configured provider, or None while WhatsApp is not set up."""
    if not (settings.EVOLUTION_URL and settings.EVOLUTION_API_KEY):
        return None
    return _evolution(settings.EVOLUTION_URL, settings.EVOLUTION_API_KEY, settings.WHATSAPP_INSTANCE)


def webhook_url() -> str:
    return f"{settings.WHATSAPP_WEBHOOK_BASE.rstrip('/')}/api/whatsapp/webhook/{settings.WHATSAPP_WEBHOOK_SECRET}"


async def poll_state_forever(session_factory) -> None:
    """Backstop for missed connection.update webhooks: refresh the stored state every minute."""
    from app.services.whatsapp.inbound import set_state

    while True:
        await asyncio.sleep(STATE_POLL_SECONDS)
        provider = get_provider()
        if provider is None:
            continue
        try:
            state = await asyncio.to_thread(provider.state)
        except Exception as exc:  # provider down = the number is effectively disconnected
            log.warning("whatsapp: state check failed: %s", exc)
            state = "close"
        db = session_factory()
        try:
            set_state(db, state)
            db.commit()
        except Exception:
            log.exception("whatsapp: could not store state")
            db.rollback()
        finally:
            db.close()


async def catch_up_forever(session_factory) -> None:
    """Store messages whose webhooks never arrived: once at startup, then every few minutes."""
    from datetime import datetime, timedelta, timezone

    from app.services.whatsapp.catchup import catch_up

    hours = CATCHUP_STARTUP_HOURS
    await asyncio.sleep(10)  # let the app finish starting
    while True:
        provider = get_provider()
        if provider is not None:
            since = datetime.now(timezone.utc) - timedelta(hours=hours)
            db = session_factory()
            try:
                await asyncio.to_thread(_catch_up_once, db, provider, since, catch_up)
                hours = CATCHUP_WINDOW_HOURS
            except Exception as exc:  # provider down: try again next round with the same window
                log.warning("whatsapp: catch-up failed: %s", exc)
                db.rollback()
            finally:
                db.close()
        await asyncio.sleep(CATCHUP_EVERY_SECONDS)


def _catch_up_once(db, provider, since, catch_up) -> None:
    catch_up(db, provider, since)
    db.commit()
