"""Sales head settings for Telegram meeting reminders."""
import re
from datetime import datetime, timezone
from typing import Callable, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.deps import get_current_user
from app.models import TelegramSettings, User
from app.services.sales_access import is_sales_head
from app.services.telegram.client import TelegramClient, TelegramError

router = APIRouter(prefix="/api/sales-hub/telegram", tags=["telegram"])

USERNAME_RE = re.compile(r"^[A-Za-z0-9_]{5,32}$")
TEST_TEXT = "✅ Тест: напоминания о встречах будут приходить сюда"


def get_telegram_client_factory() -> Callable[[str], TelegramClient]:
    return lambda token: TelegramClient(token)


def require_sales_head(user: User = Depends(get_current_user)) -> User:
    if not is_sales_head(user):
        raise HTTPException(403, "Только для руководителя продаж")
    return user


def _cfg(db: Session) -> TelegramSettings:
    cfg = db.get(TelegramSettings, 1)
    if cfg is None:
        cfg = TelegramSettings(id=1)
        db.add(cfg)
        db.flush()
    return cfg


def _view(db: Session, cfg: TelegramSettings) -> dict:
    closers = db.scalars(
        select(User).where(User.is_closer.is_(True), User.is_active.is_(True)).order_by(User.name)
    ).all()
    return {
        "enabled": bool(cfg.enabled),
        "token_tail": cfg.bot_token[-4:] if cfg.bot_token else "",
        "bot_username": cfg.bot_username,
        "chat_id": cfg.chat_id,
        "chat_title": cfg.chat_title,
        "last_error": cfg.last_error,
        "last_error_at": cfg.last_error_at,
        "closers": [
            {"id": u.id, "name": u.name, "telegram_username": u.telegram_username or ""}
            for u in closers
        ],
    }


class TokenIn(BaseModel):
    token: str


class SettingsIn(BaseModel):
    enabled: Optional[bool] = None
    chat_id: Optional[str] = None
    chat_title: Optional[str] = None


class CloserIn(BaseModel):
    telegram_username: str = ""


@router.get("")
def get_settings(db: Session = Depends(get_db), _: User = Depends(require_sales_head)):
    cfg = _cfg(db)
    db.commit()
    return _view(db, cfg)


@router.put("/token")
def save_token(
    body: TokenIn,
    db: Session = Depends(get_db),
    _: User = Depends(require_sales_head),
    factory: Callable[[str], TelegramClient] = Depends(get_telegram_client_factory),
):
    token = body.token.strip()
    try:
        username = factory(token).get_me()
    except TelegramError as e:
        raise HTTPException(422, str(e))
    cfg = _cfg(db)
    if token != cfg.bot_token:
        cfg.chat_id = ""
        cfg.chat_title = ""
    cfg.bot_token = token
    cfg.bot_username = username
    cfg.updated_at = datetime.now(timezone.utc)
    db.commit()
    return _view(db, cfg)


@router.post("/groups")
def find_groups(
    db: Session = Depends(get_db),
    _: User = Depends(require_sales_head),
    factory: Callable[[str], TelegramClient] = Depends(get_telegram_client_factory),
):
    cfg = _cfg(db)
    if not cfg.bot_token:
        raise HTTPException(422, "Сначала сохраните токен бота")
    try:
        return factory(cfg.bot_token).find_groups()
    except TelegramError as e:
        raise HTTPException(422, str(e))


@router.put("")
def update_settings(
    body: SettingsIn,
    db: Session = Depends(get_db),
    _: User = Depends(require_sales_head),
):
    cfg = _cfg(db)
    if body.chat_id is not None:
        cfg.chat_id = body.chat_id
    if body.chat_title is not None:
        cfg.chat_title = body.chat_title
    if body.enabled is not None:
        if body.enabled and not (cfg.bot_token and cfg.chat_id):
            db.rollback()
            raise HTTPException(422, "Сначала подключите бота и выберите группу")
        cfg.enabled = body.enabled
    cfg.updated_at = datetime.now(timezone.utc)
    db.commit()
    return _view(db, cfg)


@router.post("/test")
def send_test(
    db: Session = Depends(get_db),
    _: User = Depends(require_sales_head),
    factory: Callable[[str], TelegramClient] = Depends(get_telegram_client_factory),
):
    cfg = _cfg(db)
    if not (cfg.bot_token and cfg.chat_id):
        raise HTTPException(422, "Сначала подключите бота и выберите группу")
    try:
        factory(cfg.bot_token).send_message(cfg.chat_id, TEST_TEXT)
    except TelegramError as e:
        raise HTTPException(422, str(e))
    return {"ok": True}


@router.put("/closers/{user_id}")
def set_closer_username(
    user_id: int,
    body: CloserIn,
    db: Session = Depends(get_db),
    _: User = Depends(require_sales_head),
):
    user = db.get(User, user_id)
    if user is None or not user.is_closer:
        raise HTTPException(404, "Клоузер не найден")
    name = re.sub(r"\s+", "", body.telegram_username).lstrip("@")
    if name and not USERNAME_RE.match(name):
        raise HTTPException(422, "Ник Telegram: 5–32 латинских букв, цифр или _")
    user.telegram_username = name
    db.commit()
    return {"id": user.id, "telegram_username": name}
