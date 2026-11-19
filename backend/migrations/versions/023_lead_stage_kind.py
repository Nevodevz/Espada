"""Store the stage behaviour (`kind`) instead of guessing it from the name.

Revision ID: 023
Revises: 022

Backfill reproduces the former name-based rules in their original priority, so
every existing stage keeps exactly the behaviour it had.
"""
from alembic import op
import sqlalchemy as sa

revision = "023"
down_revision = "022"
branch_labels = None
depends_on = None

# Order matters: the first matching rule wins, as in the old `_stage_kind`.
_RULES = [
    ("lost", "is_lost OR lower(name) LIKE '%минус%'"),
    ("won", "is_won OR lower(name) LIKE '%оплач%'"),
    ("meeting", "lower(name) LIKE '%встреч%'"),
    ("contract", "lower(name) LIKE '%договор%'"),
    ("waiting_payment", "lower(name) LIKE '%ожид%'"),
]


def upgrade() -> None:
    op.add_column(
        "lead_stages",
        sa.Column("kind", sa.String(20), nullable=False, server_default="generic"),
    )
    for kind, condition in _RULES:
        op.execute(f"UPDATE lead_stages SET kind = '{kind}' WHERE kind = 'generic' AND ({condition})")


def downgrade() -> None:
    op.drop_column("lead_stages", "kind")
