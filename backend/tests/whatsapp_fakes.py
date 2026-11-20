"""In-memory WhatsApp provider for API tests."""
from app.services.whatsapp.provider import ProviderError, SendResult


class FakeProvider:
    def __init__(self):
        self.webhook_url = None
        self.current_state = "close"
        self.sent = []
        self.fail_with: str | None = None
        self._n = 0

    def ensure_instance(self, webhook_url: str) -> None:
        self.webhook_url = webhook_url

    def connect(self) -> dict:
        self.current_state = "connecting"
        return {"state": "connecting", "qr_base64": "data:image/png;base64,QR", "pairing_code": "AB12CD34"}

    def state(self) -> str:
        return self.current_state

    def logout(self) -> None:
        self.current_state = "close"

    def _send(self, record) -> SendResult:
        if self.fail_with:
            raise ProviderError(self.fail_with)
        self._n += 1
        self.sent.append(record)
        return SendResult(external_id=f"OUT{self._n}")

    def send_text(self, phone, text):
        return self._send(("text", phone, text))

    def send_media(self, phone, data, mime, file_name, caption):
        return self._send(("media", phone, mime, file_name, caption, len(data)))
