"""Telegram meeting reminders: user handle, bot settings, sent-log.

Revision ID: 027
Revises: 026
"""
from alembic import op
import sqlalchemy as sa

revision = "027"
down_revision = "026"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("users", sa.Column("telegram_username", sa.String(64), nullable=False, server_default=""))
    op.create_table(
        "telegram_settings",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("enabled", sa.Boolean, nullable=False, server_default=sa.false()),
        sa.Column("bot_token", sa.String(100), nullable=False, server_default=""),
        sa.Column("bot_username", sa.String(64), nullable=False, server_default=""),
        sa.Column("chat_id", sa.String(32), nullable=False, server_default=""),
        sa.Column("chat_title", sa.String(200), nullable=False, server_default=""),
        sa.Column("last_error", sa.Text, nullable=False, server_default=""),
        sa.Column("last_error_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_table(
        "telegram_sent",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("key", sa.String(120), nullable=False, unique=True),
        sa.Column("sent_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )


def downgrade() -> None:
    op.drop_table("telegram_sent")
    op.drop_table("telegram_settings")
    op.drop_column("users", "telegram_username")
