"""Thin Telegram Bot API client (getMe / getUpdates / sendMessage)."""
import httpx

API = "https://api.telegram.org"


class TelegramError(Exception):
    """Error text is Russian and safe to show to the user."""


class TelegramClient:
    def __init__(self, token: str, http: httpx.Client | None = None):
        self._token = token
        self._http = http or httpx.Client(timeout=15.0)

    def _call(self, method: str, payload: dict | None = None) -> object:
        url = f"{API}/bot{self._token}/{method}"
        try:
            response = self._http.post(url, json=payload or {})
        except httpx.HTTPError as exc:
            raise TelegramError(f"Telegram недоступен: {exc}") from exc
        if response.status_code == 401:
            raise TelegramError("Токен не подошёл")
        try:
            data = response.json()
        except ValueError:
            data = {}
        if not isinstance(data, dict) or not data.get("ok"):
            description = data.get("description") if isinstance(data, dict) else None
            raise TelegramError(description or f"Telegram ответил {response.status_code}")
        return data.get("result")

    def get_me(self) -> str:
        result = self._call("getMe")
        return (result or {}).get("username") or ""

    def find_groups(self) -> list[dict]:
        updates = self._call("getUpdates") or []
        groups: dict[str, str] = {}
        for update in updates:
            for key in ("message", "channel_post", "my_chat_member", "edited_message"):
                chat = (update.get(key) or {}).get("chat") or {}
                if chat.get("type") in ("group", "supergroup") and chat.get("id") is not None:
                    groups.setdefault(str(chat["id"]), chat.get("title") or "")
        return [{"id": cid, "title": title} for cid, title in groups.items()]

    def send_message(self, chat_id: str, text: str) -> None:
        self._call("sendMessage", {
            "chat_id": chat_id, "text": text, "parse_mode": "HTML", "disable_web_page_preview": True,
        })
