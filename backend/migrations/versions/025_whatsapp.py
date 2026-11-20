"""WhatsApp chats, messages, connection state; canonical phone digits on leads.

Revision ID: 025
Revises: 024
"""
import re

from alembic import op
import sqlalchemy as sa

revision = "025"
down_revision = "024"
branch_labels = None
depends_on = None

_NON_DIGITS = re.compile(r"\D+")


def _normalize(raw):
    # Copy of app.services.whatsapp.phone.normalize_phone — migrations never import app code.
    digits = _NON_DIGITS.sub("", raw or "")
    if len(digits) == 10 and digits.startswith("0"):
        return "996" + digits[1:]
    if len(digits) == 9:
        return "996" + digits
    return digits


def upgrade() -> None:
    op.add_column("leads", sa.Column("phone_digits", sa.String(32), nullable=False, server_default=""))
    op.add_column("leads", sa.Column("whatsapp_digits", sa.String(32), nullable=False, server_default=""))
    op.create_index("ix_leads_phone_digits", "leads", ["phone_digits"])
    op.create_index("ix_leads_whatsapp_digits", "leads", ["whatsapp_digits"])

    bind = op.get_bind()
    leads = sa.table("leads", sa.column("id"), sa.column("phone"), sa.column("whatsapp"),
                     sa.column("phone_digits"), sa.column("whatsapp_digits"))
    for row in bind.execute(sa.select(leads.c.id, leads.c.phone, leads.c.whatsapp)).fetchall():
        bind.execute(
            leads.update().where(leads.c.id == row.id)
            .values(phone_digits=_normalize(row.phone), whatsapp_digits=_normalize(row.whatsapp))
        )

    op.create_table(
        "whatsapp_chats",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("remote_jid", sa.String(64), nullable=False, unique=True),
        sa.Column("phone", sa.String(32), nullable=False, server_default=""),
        sa.Column("lead_id", sa.Integer(), sa.ForeignKey("leads.id", ondelete="SET NULL"), nullable=True),
        sa.Column("created_lead_id", sa.Integer(), sa.ForeignKey("leads.id", ondelete="SET NULL"), nullable=True),
        sa.Column("push_name", sa.String(200), nullable=False, server_default=""),
        sa.Column("last_message_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("unread_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("is_ignored", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index("ix_whatsapp_chats_phone", "whatsapp_chats", ["phone"])
    op.create_index("ix_whatsapp_chats_lead_id", "whatsapp_chats", ["lead_id"])

    op.create_table(
        "whatsapp_messages",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("chat_id", sa.Integer(), sa.ForeignKey("whatsapp_chats.id", ondelete="CASCADE"), nullable=False),
        sa.Column("external_id", sa.String(128), nullable=True, unique=True),
        sa.Column("direction", sa.String(3), nullable=False),
        sa.Column("sender_user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("kind", sa.String(16), nullable=False, server_default="text"),
        sa.Column("body", sa.Text(), nullable=False, server_default=""),
        sa.Column("media_path", sa.String(500), nullable=False, server_default=""),
        sa.Column("media_mime", sa.String(120), nullable=False, server_default=""),
        sa.Column("media_name", sa.String(255), nullable=False, server_default=""),
        sa.Column("status", sa.String(16), nullable=False, server_default="received"),
        sa.Column("error", sa.String(500), nullable=False, server_default=""),
        sa.Column("sent_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index("ix_whatsapp_messages_chat_id", "whatsapp_messages", ["chat_id"])
    op.create_index("ix_whatsapp_messages_sent_at", "whatsapp_messages", ["sent_at"])

    op.create_table(
        "whatsapp_state",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("state", sa.String(16), nullable=False, server_default="unknown"),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
    )


def downgrade() -> None:
    op.drop_table("whatsapp_state")
    op.drop_index("ix_whatsapp_messages_sent_at", table_name="whatsapp_messages")
    op.drop_index("ix_whatsapp_messages_chat_id", table_name="whatsapp_messages")
    op.drop_table("whatsapp_messages")
    op.drop_index("ix_whatsapp_chats_lead_id", table_name="whatsapp_chats")
    op.drop_index("ix_whatsapp_chats_phone", table_name="whatsapp_chats")
    op.drop_table("whatsapp_chats")
    op.drop_index("ix_leads_whatsapp_digits", table_name="leads")
    op.drop_index("ix_leads_phone_digits", table_name="leads")
    op.drop_column("leads", "whatsapp_digits")
    op.drop_column("leads", "phone_digits")
