"""Backfill SQL of migrations 022/023, run through Alembic against the test DB."""
import importlib.util
from pathlib import Path

from alembic.migration import MigrationContext
from alembic.operations import Operations

from app.core.security import hash_password
from app.models import LeadStage, Role, User


def _migration(name):
    path = Path(__file__).resolve().parents[1] / f"migrations/versions/{name}.py"
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _run(db, fn):
    with Operations.context(MigrationContext.configure(db.connection())):
        fn()
    db.commit()
    db.expire_all()


def test_022_flags_adahan_case_insensitively(db):
    u = User(name="Адахан", email="Adahan@Espada.kg", password_hash=hash_password("x"),
             role=Role.admin, position="Финансы", is_active=True, is_closer=False)
    db.add(u)
    db.commit()
    _run(db, _migration("022_user_is_closer").backfill)
    assert u.is_closer is True


def test_023_syncs_won_lost_flags_with_kind(db):
    # Lower-case names: SQLite's lower() is ASCII-only (PostgreSQL handles «Минус» — checked on PG 16).
    lost_by_name = LeadStage(name="минус", position=0, is_lost=False, kind="generic")
    won_by_name = LeadStage(name="оплачено", position=1, is_won=False, kind="generic")
    meeting = LeadStage(name="встреча", position=2, kind="generic")
    db.add_all([lost_by_name, won_by_name, meeting])
    db.commit()
    _run(db, _migration("023_lead_stage_kind").backfill)
    assert (lost_by_name.kind, lost_by_name.is_lost, lost_by_name.is_won) == ("lost", True, False)
    assert (won_by_name.kind, won_by_name.is_won, won_by_name.is_lost) == ("won", True, False)
    assert (meeting.kind, meeting.is_won, meeting.is_lost) == ("meeting", False, False)
