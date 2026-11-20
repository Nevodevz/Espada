"""Evolution API v2.3.7 adapter (self-hosted WhatsApp gateway built on Baileys).

Field names come from the v2.3.7 sources (docs were unreachable): auth header
`apikey`, webhook envelope `{event, instance, data, ...}`, event names in
lower-case dot form. 2.4.x requires a licence — keep the image pinned to 2.3.7.
"""
import base64
from datetime import datetime, timedelta, timezone

import httpx

from app.services.whatsapp.phone import jid_to_phone
from app.services.whatsapp.provider import (
    ConnectionUpdate, InboundMessage, ProviderError, SendResult, StatusUpdate,
)

WEBHOOK_EVENTS = ["MESSAGES_UPSERT", "MESSAGES_UPDATE", "CONNECTION_UPDATE", "QRCODE_UPDATED"]

_STATUS = {
    "PENDING": "pending", "SERVER_ACK": "sent", "DELIVERY_ACK": "delivered",
    "READ": "read", "PLAYED": "read", "ERROR": "failed",
}
# Baileys message field → our message kind.
_MEDIA = {
    "imageMessage": "image", "videoMessage": "video", "audioMessage": "audio",
    "documentMessage": "document", "stickerMessage": "image",
}


def mediatype_for(mime: str) -> str:
    for prefix in ("image", "video", "audio"):
        if mime.startswith(prefix + "/"):
            return prefix
    return "document"


def _personal_jid(key: dict) -> str | None:
    jid = key.get("remoteJid") or ""
    if jid.endswith("@lid"):
        jid = key.get("remoteJidAlt") or ""
    return jid if jid_to_phone(jid) else None


def _parse_upsert(data: dict) -> InboundMessage | None:
    key = data.get("key") or {}
    jid = _personal_jid(key)
    if not jid or not key.get("id"):
        return None
    message = data.get("message") or {}
    kind, body, mime, name = "text", "", "", ""
    if isinstance(message.get("conversation"), str) and message["conversation"]:
        body = message["conversation"]
    else:
        for field, media_kind in _MEDIA.items():
            content = message.get(field)
            if isinstance(content, dict):
                kind = media_kind
                body = content.get("caption") or ""
                mime = content.get("mimetype") or ""
                name = content.get("fileName") or ""
                break
        else:
            return None  # reactions, protocol messages, polls…
    try:
        sent_at = datetime.fromtimestamp(int(data.get("messageTimestamp")), tz=timezone.utc)
    except (TypeError, ValueError):
        sent_at = datetime.now(timezone.utc)
    b64 = message.get("base64") if kind != "text" else None
    return InboundMessage(
        external_id=str(key["id"]), remote_jid=jid, phone=jid_to_phone(jid) or "",
        from_me=bool(key.get("fromMe")), push_name=(data.get("pushName") or "")[:200],
        kind=kind, body=body, media_b64=b64 or None, media_mime=mime, media_name=name, sent_at=sent_at,
    )


def parse_webhook(payload) -> list:
    """Translate one Evolution webhook into provider-neutral events; unknown input → []."""
    if not isinstance(payload, dict):
        return []
    event = payload.get("event")
    data = payload.get("data")
    if not isinstance(data, dict):
        return []
    if event == "messages.upsert":
        msg = _parse_upsert(data)
        return [msg] if msg else []
    if event == "messages.update":
        status = _STATUS.get(data.get("status") or "")
        if status and data.get("keyId"):
            return [StatusUpdate(external_id=str(data["keyId"]), status=status)]
        return []
    if event == "connection.update" and data.get("state"):
        return [ConnectionUpdate(state=str(data["state"]))]
    return []


class EvolutionProvider:
    def __init__(self, base_url: str, api_key: str, instance: str, client: httpx.Client | None = None):
        self.instance = instance
        self._client = client or httpx.Client(base_url=base_url.rstrip("/"), timeout=20.0)
        self._headers = {"apikey": api_key}

    def _call(self, method: str, path: str, json: dict | None = None, allow_404: bool = False) -> dict | None:
        try:
            response = self._client.request(method, path, json=json, headers=self._headers)
        except httpx.HTTPError as exc:
            raise ProviderError(f"Evolution API недоступен: {exc}") from exc
        if allow_404 and response.status_code == 404:
            return None
        if response.status_code >= 400:
            raise ProviderError(f"Evolution API ответил {response.status_code}: {response.text[:300]}")
        try:
            return response.json()
        except ValueError:
            return {}

    @staticmethod
    def _webhook(url: str) -> dict:
        return {"enabled": True, "url": url, "events": WEBHOOK_EVENTS, "byEvents": False, "base64": True}

    def ensure_instance(self, webhook_url: str) -> None:
        exists = self._call("GET", f"/instance/connectionState/{self.instance}", allow_404=True)
        if exists is None:
            self._call("POST", "/instance/create", json={
                "instanceName": self.instance, "integration": "WHATSAPP-BAILEYS", "qrcode": True,
                "groupsIgnore": True, "webhook": self._webhook(webhook_url),
            })
        else:
            self._call("POST", f"/webhook/set/{self.instance}", json={"webhook": self._webhook(webhook_url)})

    def connect(self) -> dict:
        data = self._call("GET", f"/instance/connect/{self.instance}") or {}
        if (data.get("instance") or {}).get("state") == "open":
            return {"state": "open", "qr_base64": None, "pairing_code": None}
        return {"state": "connecting", "qr_base64": data.get("base64"), "pairing_code": data.get("pairingCode")}

    def state(self) -> str:
        data = self._call("GET", f"/instance/connectionState/{self.instance}", allow_404=True)
        if data is None:
            return "close"
        return (data.get("instance") or {}).get("state") or "unknown"

    def logout(self) -> None:
        self._call("DELETE", f"/instance/logout/{self.instance}")

    @staticmethod
    def _result(data: dict | None) -> SendResult:
        key_id = ((data or {}).get("key") or {}).get("id")
        if not key_id:
            raise ProviderError("Evolution API не вернул идентификатор сообщения")
        return SendResult(external_id=str(key_id))

    def send_text(self, phone: str, text: str) -> SendResult:
        return self._result(self._call(
            "POST", f"/message/sendText/{self.instance}", json={"number": phone, "text": text},
        ))

    def recent_messages(self, since: datetime, limit: int = 2000) -> list[InboundMessage]:
        """Messages Evolution stored since `since` (oldest first) — for catching up missed webhooks.

        `findMessages` records have the same shape as messages.upsert data, minus base64 media.
        """
        until = datetime.now(timezone.utc) + timedelta(minutes=5)
        where = {"messageTimestamp": {"gte": since.astimezone(timezone.utc).isoformat(), "lte": until.isoformat()}}
        out: list[InboundMessage] = []
        page, pages, fetched = 1, 1, 0
        while page <= pages and fetched < limit:
            data = self._call("POST", f"/chat/findMessages/{self.instance}",
                              json={"where": where, "page": page, "offset": 100}) or {}
            block = data.get("messages") or {}
            records = block.get("records") or []
            pages = int(block.get("pages") or 1)
            fetched += len(records)
            for record in records:
                msg = _parse_upsert(record) if isinstance(record, dict) else None
                if msg:
                    out.append(msg)
            if not records:
                break
            page += 1
        return sorted(out, key=lambda m: m.sent_at)

    def media_base64(self, external_id: str) -> str | None:
        data = self._call("POST", f"/chat/getBase64FromMediaMessage/{self.instance}",
                          json={"message": {"key": {"id": external_id}}}) or {}
        return data.get("base64") or None

    def send_media(self, phone: str, data: bytes, mime: str, file_name: str, caption: str) -> SendResult:
        return self._result(self._call("POST", f"/message/sendMedia/{self.instance}", json={
            "number": phone, "mediatype": mediatype_for(mime), "mimetype": mime, "caption": caption,
            "media": base64.b64encode(data).decode("ascii"), "fileName": file_name,
        }))
