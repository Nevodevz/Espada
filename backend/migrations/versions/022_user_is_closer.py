"""Explicit closer flag on users.

Revision ID: 022
Revises: 021

Closers were detected by matching `position` against fixed strings, which left
Adahan out whenever his position differed. Backfill keeps every current closer
and always includes Adahan.
"""
from alembic import op
import sqlalchemy as sa

revision = "022"
down_revision = "021"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "users",
        sa.Column("is_closer", sa.Boolean(), nullable=False, server_default=sa.false()),
    )
    op.execute(
        "UPDATE users SET is_closer = true "
        "WHERE position IN ('Клоузер', 'Финансовый директор') OR email LIKE 'adahan@%'"
    )


def downgrade() -> None:
    op.drop_column("users", "is_closer")
