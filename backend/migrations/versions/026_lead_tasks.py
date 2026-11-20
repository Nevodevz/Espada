"""Lead tasks; move the old «следующее действие» (next_action_*) into tasks.

Revision ID: 026
Revises: 025

Rules (spec 2026-11-20 §5.1):
- only open leads (status=active, stage kind not won/lost) get a task;
- no date → no task, the text is appended to the lead comment;
- past date → due today 10:00 Asia/Bishkek, with a note about the original date
  (otherwise everyone starts with a wall of long-overdue tasks);
- kind = call when the text mentions «звон», else other;
- assignee = setter, else closer, else none.
The legacy columns stay (read by nobody); downgrade drops only the new table.
"""
from datetime import datetime, timedelta, timezone

from alembic import op
import sqlalchemy as sa

revision = "026"
down_revision = "025"
branch_labels = None
depends_on = None

BISHKEK = timezone(timedelta(hours=6))
REASON = "Не выходит на связь"


def upgrade() -> None:
    op.create_table(
        "lead_tasks",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("lead_id", sa.Integer(), sa.ForeignKey("leads.id", ondelete="CASCADE"), nullable=False),
        sa.Column("kind", sa.String(16), nullable=False, server_default="call"),
        sa.Column("due_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("assignee_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("created_by", sa.Integer(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("comment", sa.Text(), nullable=False, server_default=""),
        sa.Column("status", sa.String(16), nullable=False, server_default="open"),
        sa.Column("result", sa.String(16), nullable=True),
        sa.Column("result_note", sa.Text(), nullable=False, server_default=""),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("completed_by", sa.Integer(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index("ix_lead_tasks_lead_id", "lead_tasks", ["lead_id"])
    op.create_index("ix_lead_tasks_due_at", "lead_tasks", ["due_at"])
    op.create_index("ix_lead_tasks_status", "lead_tasks", ["status"])
    op.create_index("ix_lead_tasks_assignee_id", "lead_tasks", ["assignee_id"])
    op.create_index("ix_lead_tasks_lead_status", "lead_tasks", ["lead_id", "status"])
    op.create_index("ix_lead_tasks_assignee_status_due", "lead_tasks", ["assignee_id", "status", "due_at"])

    bind = op.get_bind()
    if not bind.execute(sa.text("SELECT 1 FROM reject_reasons WHERE name = :n"), {"n": REASON}).first():
        bind.execute(sa.text("INSERT INTO reject_reasons (name, is_active) VALUES (:n, true)"), {"n": REASON})

    now = datetime.now(timezone.utc)
    today_10 = datetime.now(BISHKEK).replace(hour=10, minute=0, second=0, microsecond=0).astimezone(timezone.utc)
    rows = bind.execute(sa.text("""
        SELECT l.id, l.next_action_type, l.next_action_at, l.setter_id, l.closer_id, l.comment
        FROM leads l LEFT JOIN lead_stages s ON s.id = l.stage_id
        WHERE l.status = 'active'
          AND (s.id IS NULL OR s.kind NOT IN ('won', 'lost'))
          AND (coalesce(l.next_action_type, '') <> '' OR l.next_action_at IS NOT NULL)
    """)).fetchall()
    tasks = sa.table(
        "lead_tasks", sa.column("lead_id"), sa.column("kind"), sa.column("due_at"),
        sa.column("assignee_id"), sa.column("comment"), sa.column("status"),
    )
    for lead_id, action, at, setter_id, closer_id, comment in rows:
        action = (action or "").strip()
        if at is None:
            extra = f"Было запланировано: {action}"
            new_comment = f"{comment}\n{extra}" if comment else extra
            bind.execute(sa.text("UPDATE leads SET comment = :c WHERE id = :i"), {"c": new_comment, "i": lead_id})
            continue
        at = at if at.tzinfo else at.replace(tzinfo=timezone.utc)
        text = action
        due = at
        if at < now:
            due = today_10
            note = f"перенесено из «следующего действия» от {at.astimezone(BISHKEK).strftime('%d.%m')}"
            text = f"{action} ({note})" if action else note
        bind.execute(tasks.insert().values(
            lead_id=lead_id, kind="call" if "звон" in action.lower() else "other", due_at=due,
            assignee_id=setter_id or closer_id, comment=text, status="open",
        ))


def downgrade() -> None:
    op.drop_table("lead_tasks")
