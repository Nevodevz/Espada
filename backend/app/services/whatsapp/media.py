"""Client files from WhatsApp: stored outside the public MEDIA_ROOT, served only via the API."""
import re
from pathlib import Path

from app.core.config import settings

_UNSAFE = re.compile(r"[^\w.\-]+", re.UNICODE)


def _root() -> Path:
    return Path(settings.WHATSAPP_MEDIA_ROOT).resolve()


def media_abspath(rel: str) -> Path:
    """Absolute path of a stored file; refuses anything that escapes the media root."""
    root = _root()
    path = (root / rel).resolve()
    if path != root and root not in path.parents:
        raise ValueError("path escapes the WhatsApp media root")
    return path


def save_media(chat_id: int, message_id: int, data: bytes, file_name: str) -> str:
    """Write the file and return its path relative to WHATSAPP_MEDIA_ROOT."""
    safe = _UNSAFE.sub("_", file_name or "file").strip("._")[:120] or "file"
    rel = f"whatsapp/{chat_id}/{message_id}_{safe}"
    path = media_abspath(rel)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(data)
    return rel
