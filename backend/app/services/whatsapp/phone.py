"""Phone numbers in one canonical form: digits only, Kyrgyz local numbers with 996."""
import re

_NON_DIGITS = re.compile(r"\D+")


def normalize_phone(raw: str | None) -> str:
    """`+996 700 123 456`, `0700 123 456` and `700123456` all become `996700123456`."""
    digits = _NON_DIGITS.sub("", raw or "")
    if len(digits) == 10 and digits.startswith("0"):
        return "996" + digits[1:]
    if len(digits) == 9:
        return "996" + digits
    return digits


def jid_to_phone(jid: str) -> str | None:
    """Phone of a personal chat JID; groups, broadcasts and @lid ids have none."""
    user, _, server = (jid or "").partition("@")
    if server != "s.whatsapp.net" or not user:
        return None
    return normalize_phone(user.split(":")[0])
