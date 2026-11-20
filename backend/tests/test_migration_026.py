"""Migration 026 helper: when moved past-due tasks become due."""
import importlib.util
from datetime import datetime, timedelta, timezone
from pathlib import Path

BISHKEK = timezone(timedelta(hours=6))


def _migration():
    path = Path(__file__).resolve().parents[1] / "migrations/versions/026_lead_tasks.py"
    spec = importlib.util.spec_from_file_location("m026", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_moved_due_is_ten_am_when_deploying_early():
    now = datetime(2026, 11, 21, 8, 0, tzinfo=BISHKEK)
    assert _migration().moved_due(now) == datetime(2026, 11, 21, 10, 0, tzinfo=BISHKEK)


def test_moved_due_is_in_an_hour_when_deploying_late():
    """Deploying at 15:00 must not make every moved task overdue at once."""
    now = datetime(2026, 11, 21, 15, 0, tzinfo=BISHKEK)
    assert _migration().moved_due(now) == now + timedelta(hours=1)
