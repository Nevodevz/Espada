"""Provider-neutral types for the WhatsApp transport (Evolution today, swappable later)."""
from dataclasses import dataclass
from datetime import datetime
from typing import Protocol


@dataclass(frozen=True)
class InboundMessage:
    """A message seen on the number: from a client, or sent from the phone itself (`from_me`)."""
    external_id: str
    remote_jid: str
    phone: str
    from_me: bool
    push_name: str
    kind: str              # text | image | document | audio | video | other
    body: str
    media_b64: str | None
    media_mime: str
    media_name: str
    sent_at: datetime


@dataclass(frozen=True)
class StatusUpdate:
    external_id: str
    status: str            # pending | sent | delivered | read | failed


@dataclass(frozen=True)
class ConnectionUpdate:
    state: str             # open | connecting | close | refused


@dataclass(frozen=True)
class SendResult:
    external_id: str


class ProviderError(Exception):
    """The provider could not do what was asked (unreachable, rejected, not connected)."""


class WhatsAppProvider(Protocol):
    def ensure_instance(self, webhook_url: str) -> None: ...
    def connect(self) -> dict: ...
    def state(self) -> str: ...
    def logout(self) -> None: ...
    def send_text(self, phone: str, text: str) -> SendResult: ...
    def send_media(self, phone: str, data: bytes, mime: str, file_name: str, caption: str) -> SendResult: ...
