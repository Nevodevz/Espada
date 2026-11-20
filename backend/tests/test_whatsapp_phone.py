"""Phone normalization: one client, whatever format the number was typed in."""
import pytest

from app.models import Lead, LeadStatus
from app.services.whatsapp.phone import jid_to_phone, normalize_phone


@pytest.mark.parametrize("raw,expected", [
    ("+996 700 123 456", "996700123456"),
    ("0700 123 456", "996700123456"),
    ("700123456", "996700123456"),
    ("8 (701) 234-56-78", "87012345678"),
    ("", ""),
    (None, ""),
])
def test_normalize_phone(raw, expected):
    assert normalize_phone(raw) == expected


@pytest.mark.parametrize("jid,expected", [
    ("996700123456@s.whatsapp.net", "996700123456"),
    ("120363041234@g.us", None),
    ("status@broadcast", None),
    ("12345@lid", None),
])
def test_jid_to_phone(jid, expected):
    assert jid_to_phone(jid) == expected


def test_lead_digits_kept_in_sync(db, stages):
    lead = Lead(client_name="A", phone="0700 123 456", whatsapp="", stage_id=stages["Новый лид"].id,
                status=LeadStatus.active)
    db.add(lead)
    db.commit()
    assert lead.phone_digits == "996700123456" and lead.whatsapp_digits == ""
    lead.whatsapp = "+996 555 000 111"
    db.commit()
    assert lead.whatsapp_digits == "996555000111"
