"""Drop the free-form lead board: board columns are now funnel stages.

Revision ID: 024
Revises: 023

Before upgrading production, back up both tables:
    pg_dump -t lead_board_columns -t lead_board_placements
(see DEPLOY.md, «Выкладка части 2»). Leads, stages, history, meetings and
finance are untouched. Downgrade recreates the tables empty.
"""
from alembic import op
import sqlalchemy as sa

revision = "024"
down_revision = "023"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.drop_table("lead_board_placements")
    op.drop_table("lead_board_columns")


def downgrade() -> None:
    # Same shape as 021.upgrade(); data is restored from the pg_dump backup if needed.
    op.create_table(
        "lead_board_columns",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("name", sa.String(120), nullable=False),
        sa.Column("color", sa.String(7), nullable=False, server_default="#4648d4"),
        sa.Column("position", sa.Integer(), nullable=False, server_default="0"),
    )
    op.create_table(
        "lead_board_placements",
        sa.Column("lead_id", sa.Integer(), sa.ForeignKey("leads.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("column_id", sa.Integer(), sa.ForeignKey("lead_board_columns.id", ondelete="SET NULL"), nullable=True),
        sa.Column("position", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("updated_by", sa.Integer(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_lead_board_placements_column_id", "lead_board_placements", ["column_id"])
