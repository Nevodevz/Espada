"""Provider wiring. Tests override `get_provider` through FastAPI dependency_overrides."""
import asyncio
import logging
from functools import lru_cache

from app.core.config import settings
from app.services.whatsapp.evolution import EvolutionProvider
from app.services.whatsapp.provider import WhatsAppProvider

log = logging.getLogger(__name__)

STATE_POLL_SECONDS = 60


@lru_cache(maxsize=1)
def _evolution(url: str, key: str, instance: str) -> EvolutionProvider:
    return EvolutionProvider(url, key, instance)


def get_provider() -> WhatsAppProvider | None:
    """The configured provider, or None while WhatsApp is not set up (EVOLUTION_URL empty)."""
    if not settings.EVOLUTION_URL:
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
