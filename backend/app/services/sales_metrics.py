"""Automatic sales metrics («Показатели»): replaces the hand-filled setter diary.

Counting rules (see the sales restructure spec):
- touch = unique (employee, lead, Bishkek day) with a call result, an outbound
  WhatsApp message or a manual lead activity;
- booked = meetings by `setter_id`, created in the period, excluding reschedule children;
- held = meetings with status closed|minus|push by `meeting_date`;
- sales = paid deals by `payment_date` (same as analytics).
"""
from datetime import date, datetime, time, timedelta, timezone

from sqlalchemy import func, or_
from sqlalchemy.orm import Session

from app.models import (Deal, Lead, LeadActivity, LeadStage, LeadStageHistory, LeadStatus, Meeting,
                        MeetingStatus, RejectReason, User, WhatsAppChat, WhatsAppMessage)
from app.services.first_touch import (NON_MANUAL_ACTIVITIES, early_stage_ids, first_touch_at,  # noqa: F401
                                      is_early, touch_rows, working_minutes)
from app.services.leads import BISHKEK_TZ

HELD_STATUSES = (MeetingStatus.closed, MeetingStatus.minus, MeetingStatus.push)
CLOSER_STATUSES = ("scheduled", "closed", "minus", "push", "not_held")
# lead_tasks._result_text writes call results as «✅ Дозвонился» / «📵 Недозвон»;
# the activity row has no structured result field, so the prefix is the signal.
CONNECTED_PREFIX = "✅"
NO_ANSWER_PREFIX = "📵"


def aware(value: datetime) -> datetime:
    return value if value.tzinfo else value.replace(tzinfo=timezone.utc)


def bishkek_day(value: datetime) -> date:
    return aware(value).astimezone(BISHKEK_TZ).date()


def period_bounds(date_from: date, date_to: date) -> tuple[datetime, datetime]:
    """[start, end) in UTC for the inclusive Bishkek-day range."""
    start = datetime.combine(date_from, time.min, tzinfo=BISHKEK_TZ).astimezone(timezone.utc)
    end = datetime.combine(date_to + timedelta(days=1), time.min, tzinfo=BISHKEK_TZ).astimezone(timezone.utc)
    return start, end


def latest_deal_by_lead(db: Session, lead_ids: list[int]) -> dict[int, Deal]:
    """Most recent deal per lead, in a single query (avoids N+1 on lists)."""
    if not lead_ids:
        return {}
    rows = (
        db.query(Deal)
        .filter(Deal.lead_id.in_(lead_ids))
        .order_by(Deal.lead_id, Deal.created_at.desc(), Deal.id.desc())
        .all()
    )
    out: dict[int, Deal] = {}
    for d in rows:
        out.setdefault(d.lead_id, d)
    return out


def _lead_scope(q, source_id, service_id):
    if source_id:
        q = q.filter(Lead.source_id == source_id)
    if service_id:
        q = q.filter(Lead.service_id == service_id)
    return q


def totals(db: Session, date_from: date, date_to: date, source_id=None, service_id=None,
           user_id=None) -> dict:
    start, end = period_bounds(date_from, date_to)
    scoped = bool(source_id or service_id)

    leads_q = db.query(Lead).filter(Lead.status == LeadStatus.active,
                                    Lead.created_at >= start, Lead.created_at < end)
    leads_q = _lead_scope(leads_q, source_id, service_id)
    if user_id:
        leads_q = leads_q.filter(or_(Lead.setter_id == user_id, Lead.closer_id == user_id))
    leads = leads_q.all()

    def meetings_q():
        q = db.query(Meeting)
        if scoped:
            q = _lead_scope(q.join(Lead, Lead.id == Meeting.lead_id), source_id, service_id)
        if user_id:
            q = q.filter(or_(Meeting.setter_id == user_id, Meeting.closer_id == user_id))
        return q

    booked = meetings_q().filter(Meeting.parent_id.is_(None), Meeting.setter_id.isnot(None),
                                 Meeting.created_at >= start, Meeting.created_at < end).count()
    held = meetings_q().filter(Meeting.status.in_(HELD_STATUSES),
                               Meeting.meeting_date >= start, Meeting.meeting_date < end).count()

    sales_q = db.query(Deal).filter(Deal.status == "paid",
                                    Deal.payment_date >= date_from, Deal.payment_date <= date_to)
    if scoped:
        sales_q = _lead_scope(sales_q.join(Lead, Lead.id == Deal.lead_id), source_id, service_id)
    if user_id:
        sales_q = sales_q.filter(or_(Deal.setter_id == user_id, Deal.closer_id == user_id))
    sales = sales_q.count()

    # Won leads of the period drive the conversion.
    won_ids = {s.id for s in db.query(LeadStage).filter(LeadStage.is_won == True).all()}  # noqa: E712
    lost_ids = {s.id for s in db.query(LeadStage).filter(LeadStage.is_lost == True).all()}  # noqa: E712
    won = sum(1 for l in leads if l.stage_id in won_ids)
    conversion = round(won / len(leads) * 100, 1) if leads else 0.0

    # Money: latest deal of each still-open lead created in the period.
    open_ids = [l.id for l in leads if l.stage_id not in won_ids and l.stage_id not in lost_ids]
    amount = paid = 0
    for deal in latest_deal_by_lead(db, open_ids).values():
        amount += int(deal.amount or 0)
        paid += int(deal.paid_amount or 0)

    return {
        "leads": len(leads), "meetings_booked": booked, "meetings_held": held, "sales": sales,
        "conversion_pct": conversion, "deals_amount": amount, "paid": paid,
        "remaining": max(amount - paid, 0),
    }


def _touches(db: Session, start: datetime, end: datetime) -> dict[int, int]:
    """user_id -> number of unique (lead, Bishkek day) touches."""
    seen = {(uid, lead_id, bishkek_day(at)) for uid, lead_id, at in touch_rows(db, start=start, end=end)}

    out: dict[int, int] = {}
    for uid, _, _ in seen:
        out[uid] = out.get(uid, 0) + 1
    return out


def _count_by(db: Session, column, *filters) -> dict[int, int]:
    rows = db.query(column, func.count()).filter(column.isnot(None), *filters).group_by(column).all()
    return {uid: n for uid, n in rows}


def _first_touch_stats(db: Session, start: datetime, end: datetime) -> dict[int, tuple[int | None, int]]:
    """setter_id -> (avg working minutes to first touch over touched leads, untouched count),
    for leads created in the period. «Untouched» counts only leads still on an early stage
    (see `early_stage_ids`): a lead moved on to a meeting is not waiting for a touch."""
    leads = (db.query(Lead.id, Lead.setter_id, Lead.created_at, Lead.stage_id)
             .filter(Lead.setter_id.isnot(None), Lead.status == LeadStatus.active,
                     Lead.created_at >= start, Lead.created_at < end).all())
    touched = first_touch_at(db, [lid for lid, _, _, _ in leads])
    early = early_stage_ids(db)
    waits: dict[int, list[int]] = {}
    untouched: dict[int, int] = {}
    for lid, setter, created, stage_id in leads:
        if lid in touched:
            waits.setdefault(setter, []).append(working_minutes(created, touched[lid]))
        elif is_early(stage_id, early):
            untouched[setter] = untouched.get(setter, 0) + 1
    return {u: (round(sum(waits[u]) / len(waits[u])) if u in waits else None, untouched.get(u, 0))
            for u in set(waits) | set(untouched)}


def employee_rows(db: Session, date_from: date, date_to: date) -> dict:
    start, end = period_bounds(date_from, date_to)

    touches = _touches(db, start, end)
    call_filters = (LeadActivity.activity_type == "call_result",
                    LeadActivity.created_at >= start, LeadActivity.created_at < end)
    connected = _count_by(db, LeadActivity.responsible_id, *call_filters,
                          LeadActivity.description.startswith(CONNECTED_PREFIX))
    no_answer = _count_by(db, LeadActivity.responsible_id, *call_filters,
                          LeadActivity.description.startswith(NO_ANSWER_PREFIX))
    booked = _count_by(db, Meeting.setter_id, Meeting.parent_id.is_(None),
                       Meeting.created_at >= start, Meeting.created_at < end)
    held = _count_by(db, Meeting.setter_id, Meeting.status.in_(HELD_STATUSES),
                     Meeting.meeting_date >= start, Meeting.meeting_date < end)

    by_status: dict[int, dict[str, int]] = {}
    for uid, status, n in (
        db.query(Meeting.closer_id, Meeting.status, func.count())
        .filter(Meeting.closer_id.isnot(None), Meeting.meeting_date >= start, Meeting.meeting_date < end)
        .group_by(Meeting.closer_id, Meeting.status).all()
    ):
        key = status.value if hasattr(status, "value") else status
        if key in CLOSER_STATUSES:  # rescheduled is not an outcome
            by_status.setdefault(uid, {k: 0 for k in CLOSER_STATUSES})[key] = n

    sales: dict[int, tuple[int, int]] = {
        uid: (n, int(total or 0))
        for uid, n, total in db.query(Deal.closer_id, func.count(), func.coalesce(func.sum(Deal.paid_amount), 0))
        .filter(Deal.closer_id.isnot(None), Deal.status == "paid",
                Deal.payment_date >= date_from, Deal.payment_date <= date_to)
        .group_by(Deal.closer_id).all()
    }

    first = _first_touch_stats(db, start, end)
    setter_ids = {u for src in (touches, connected, no_answer, booked, held) for u, n in src.items() if n > 0}
    setter_ids |= {u for u, (avg, untouched) in first.items() if untouched > 0 or avg is not None}
    closer_ids = {u for u, d in by_status.items() if any(d.values())} | {u for u, (n, _) in sales.items() if n > 0}
    everyone = setter_ids | closer_ids
    names = {u.id: u.name for u in db.query(User).filter(User.id.in_(everyone)).all()} if everyone else {}

    setters = [
        {"user_id": u, "name": names.get(u, ""), "touches": touches.get(u, 0),
         "calls_connected": connected.get(u, 0), "calls_no_answer": no_answer.get(u, 0),
         "booked": booked.get(u, 0), "held": held.get(u, 0),
         "avg_first_touch_minutes": first.get(u, (None, 0))[0], "untouched": first.get(u, (None, 0))[1]}
        for u in sorted(setter_ids, key=lambda i: names.get(i, ""))
    ]
    closers = [
        {"user_id": u, "name": names.get(u, ""),
         "by_status": by_status.get(u, {k: 0 for k in CLOSER_STATUSES}),
         "sales": sales.get(u, (0, 0))[0], "sales_amount": sales.get(u, (0, 0))[1]}
        for u in sorted(closer_ids, key=lambda i: names.get(i, ""))
    ]
    return {"setters": setters, "closers": closers}


def lost_reasons(db: Session, date_from: date, date_to: date, user_id: int | None = None) -> list[dict]:
    """Leads whose latest stage move (inside the period) went to a lost stage, grouped by reject reason."""
    start, end = period_bounds(date_from, date_to)
    latest = (
        db.query(LeadStageHistory.lead_id, func.max(LeadStageHistory.id).label("hid"))
        .group_by(LeadStageHistory.lead_id).subquery()
    )
    q = (
        db.query(Lead)
        .join(latest, latest.c.lead_id == Lead.id)
        .join(LeadStageHistory, LeadStageHistory.id == latest.c.hid)
        .join(LeadStage, LeadStage.id == LeadStageHistory.to_stage_id)
        .filter(LeadStage.is_lost == True,  # noqa: E712
                LeadStageHistory.created_at >= start, LeadStageHistory.created_at < end)
    )
    if user_id:
        q = q.filter(Lead.setter_id == user_id)
    leads = q.all()
    if not leads:
        return []

    groups: dict[int | None, dict[int | None, int]] = {}
    for l in leads:
        by_user = groups.setdefault(l.reject_reason_id, {})
        by_user[l.setter_id] = by_user.get(l.setter_id, 0) + 1

    reason_names = {r.id: r.name for r in db.query(RejectReason).filter(RejectReason.id.in_([k for k in groups if k]))}
    user_ids = {u for g in groups.values() for u in g if u}
    names = {u.id: u.name for u in db.query(User).filter(User.id.in_(user_ids)).all()} if user_ids else {}

    total = len(leads)
    rows = []
    for rid, by_user in groups.items():
        count = sum(by_user.values())
        rows.append({
            "reason_id": rid,
            "name": reason_names.get(rid, "Без причины") if rid else "Без причины",
            "count": count,
            "pct": round(count / total * 100, 1),
            "by_user": [{"user_id": u, "name": names.get(u, "—"), "count": n}
                        for u, n in sorted(by_user.items(), key=lambda kv: -kv[1])],
        })
    rows.sort(key=lambda r: (-r["count"], r["name"]))
    return rows
