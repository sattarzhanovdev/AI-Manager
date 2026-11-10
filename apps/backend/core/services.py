import json, math, uuid
from datetime import timedelta
from pathlib import Path
from django.db import transaction
from django.db.models import Sum, Q
from django.utils import timezone
from rest_framework.exceptions import ValidationError, PermissionDenied, NotFound
from . import models as m
from .serializers import serialize, serializer_for, phone

BLOCKS = json.loads((Path(__file__).parent / "questionnaire.json").read_text())
DEFAULT_ASSISTANT = dict(
    voice="ru-female-1",
    speed=1,
    name="Ассистент",
    greeting="Здравствуйте! Я AI-ассистент. Звонок записывается. Чем помочь?",
    farewell="Спасибо за обращение!",
    mode="leads",
    pronunciation=[],
    handoffRules="",
    handoffQueue=[],
    handoffTimeoutS=20,
    noAnswerPhrase="Передам вашу просьбу администратору.",
    maxCallMinutes=10,
    onLimit="leads_only",
)
DEFAULT_PLAN = dict(
    key="start",
    name="Не назначен",
    priceMinor=0,
    currency="KGS",
    minutes=0,
    aiDialogs=0,
    lines=0,
    modes=["leads", "consult"],
)


def audit(ctx, action, entity, before=None, after=None):
    m.Audit.objects.create(
        company=ctx.company,
        actor_name=ctx.user.get_full_name() or ctx.user.email,
        action=action,
        entity=str(entity),
        before=before,
        after=after,
        ip=ctx.META.get("REMOTE_ADDR"),
    )


def demand(ctx, action):
    role = ctx.member.role
    allowed = {
        "ops": ["owner", "admin", "staff"],
        "kb": ["owner"],
        "publish": ["owner"],
        "ai": ["owner", "admin"],
        "team": ["owner"],
        "billing": ["owner", "accountant"],
        "owner": ["owner"],
    }
    if (
        action == "kb"
        and role == "admin"
        and ctx.member.permissions.get("edit_questionnaire")
    ):
        return
    if role not in allowed[action]:
        raise PermissionDenied("Недостаточно прав.")


def rows(ctx, model):
    qs = model.objects.filter(company=ctx.company)
    if model in [
        m.Lead,
        m.Call,
        m.Conversation,
        m.Contact,
        m.Appointment,
        m.Resource,
        m.Ticket,
        m.Waitlist,
        m.Message,
    ]:
        demand(ctx, "ops")
    if ctx.member.role == "staff":
        if model in [m.Lead, m.Call, m.Conversation]:
            qs = qs.filter(assignee=ctx.user)
        if model is m.Contact:
            qs = qs.filter(
                Q(lead__assignee=ctx.user)
                | Q(conversation__assignee=ctx.user)
                | Q(call__assignee=ctx.user)
            ).distinct()
        if model is m.Message:
            qs = qs.filter(conversation__assignee=ctx.user)
    return qs


def obj(ctx, model, id, lock=False):
    qs = rows(ctx, model)
    if lock:
        qs = qs.select_for_update()
    try:
        uuid.UUID(str(id))
        return qs.get(pk=id)
    except (model.DoesNotExist, ValueError):
        raise NotFound("Объект не найден.")


def save(ctx, model, data, instance=None, readonly=()):
    s = serializer_for(model, readonly)(
        instance,
        data=data,
        partial=instance is not None,
        context={"company": ctx.company},
    )
    s.is_valid(raise_exception=True)
    return s.save(company=ctx.company)


def draft(company):
    return m.Questionnaire.objects.get_or_create(
        company=company, status="draft", defaults={"version": 1}
    )[0]


def kb_state(ctx):
    q = draft(ctx.company)
    tables = {
        key: serialize(model.objects.filter(company=ctx.company), True)
        for key, model in [
            ("services", m.Service),
            ("staff", m.Staff),
            ("faq", m.Faq),
            ("branches", m.Branch),
        ]
    }
    count = {
        k: len([x for x in tables[k] if x.get("active", True)])
        for k in ["services", "staff", "faq"]
    }
    score = 0
    weights = {"required": 2, "recommended": 1, "optional": 0.5}
    for b in BLOCKS:
        if b.get("table"):
            progress = min(
                1,
                count[b["table"]] / {"services": 5, "staff": 2, "faq": 10}[b["table"]],
            )
        else:
            total = sum(weights[f["level"]] for f in b["fields"])
            progress = (
                sum(weights[f["level"]] for f in b["fields"] if q.fields.get(f["key"]))
                / total
                if total
                else 0
            )
        score += b["weight"] * progress
    q.completeness = math.floor(score + 0.5)
    versions = list(
        m.Questionnaire.objects.filter(company=ctx.company).order_by("-version")
    )
    published = next((v for v in versions if v.status == "published"), None)
    meta = lambda v: dict(
        version=v.version,
        status=v.status,
        publishedAt=v.published_at.isoformat() if v.published_at else None,
        completeness=v.completeness,
    )
    old = published.fields if published else {}
    return dict(
        draft=meta(q),
        published=meta(published) if published else None,
        versions=[meta(v) for v in versions],
        fields=q.fields,
        fieldSources={k: "manual" for k in q.fields},
        changedSincePublish=[
            k for k in set(q.fields) | set(old) if q.fields.get(k) != old.get(k)
        ],
        unanswered=serialize(
            m.Unanswered.objects.filter(company=ctx.company, resolved=False), True
        ),
        **tables,
    )


def required_missing(state, mode="leads"):
    missing = []
    for b in BLOCKS:
        if b["key"] == "booking" and mode not in ["booking", "semi"]:
            continue
        for f in b["fields"]:
            if (
                f["level"] == "required"
                and not f.get("requiredWhen")
                and not state["fields"].get(f["key"])
            ):
                missing.append(f["key"])
    if not state["services"]:
        missing.append("services")
    if len([x for x in state["faq"] if x["active"]]) < 10:
        missing.append("faq")
    return missing


@transaction.atomic
def publish(ctx, rollback=None):
    demand(ctx, "publish")
    m.Company.objects.select_for_update().get(pk=ctx.company.pk)
    state = kb_state(ctx)
    q = draft(ctx.company)
    q.completeness = state["draft"]["completeness"]
    if rollback is not None:
        old = (
            m.Questionnaire.objects.filter(company=ctx.company, version=rollback)
            .exclude(status="draft")
            .first()
        )
        if not old:
            raise NotFound("Версия не найдена.")
        q.fields = old.fields
        q.snapshot = old.snapshot
        q.completeness = old.completeness
        # Restore editable tables atomically while old snapshots stay immutable.
        for key, model in [
            ("services", m.Service),
            ("staff", m.Staff),
            ("faq", m.Faq),
            ("branches", m.Branch),
        ]:
            for row in old.snapshot.get(key, []):
                existing = model.objects.filter(
                    company=ctx.company, pk=row["id"]
                ).first()
                save(
                    ctx,
                    model,
                    {k: v for k, v in row.items() if k not in ["id", "createdAt"]},
                    existing,
                )
    else:
        missing = required_missing(state, assistant(ctx)["mode"])
        if missing:
            raise ValidationError(
                {
                    "fields": missing,
                    "detail": "Заполните обязательные поля перед публикацией.",
                }
            )
        q.snapshot = {
            k: state[k] for k in ["fields", "services", "staff", "faq", "branches"]
        }
        q.snapshot["services"] = [x for x in state["services"] if x["active"]]
        q.snapshot["faq"] = [x for x in state["faq"] if x["active"]]
    m.Questionnaire.objects.filter(company=ctx.company, status="published").update(
        status="archived"
    )
    q.status = "published"
    q.published_at = timezone.now()
    q.save()
    m.Questionnaire.objects.create(
        company=ctx.company,
        version=q.version + 1,
        fields=q.fields,
        completeness=q.completeness,
    )
    audit(ctx, "kb.rollback" if rollback else "kb.publish", q.version)
    return q.version


def assistant(ctx):
    a, _ = m.Assistant.objects.get_or_create(company=ctx.company)
    return {**DEFAULT_ASSISTANT, **a.settings}


@transaction.atomic
def new_lead(ctx, data, source="manual", source_id=None):
    demand(ctx, "ops")
    company = m.Company.objects.select_for_update().get(pk=ctx.company.pk)
    contact = None
    if data.get("phone"):
        contact, _ = m.Contact.objects.get_or_create(
            company=company,
            phone=phone(data["phone"]),
            defaults={
                "name": data.get("name", ""),
                "channels": ["phone" if source != "chat" else "widget"],
            },
        )
    clean = {
        k: v
        for k, v in data.items()
        if k in ["title", "type", "priority", "payload", "channel"]
    }
    clean.update(
        number=company.next_lead_number,
        source=source,
        sourceId=source_id,
        contactId=str(contact.id) if contact else data.get("contactId"),
        assigneeId=str(ctx.user.pk),
        dueAt=(
            timezone.now()
            + timedelta(minutes=15 if data.get("priority") == "urgent" else 120)
        ).isoformat(),
    )
    lead = save(ctx, m.Lead, clean)
    company.next_lead_number += 1
    company.save(update_fields=["next_lead_number"])
    m.LeadEvent.objects.create(
        company=company, lead=lead, actor=ctx.user, action="created"
    )
    m.Notification.objects.create(
        company=company,
        user=ctx.user,
        kind="lead_new",
        title=lead.title,
        href=f"/app/leads?open={lead.id}",
    )
    # Durable queue; no fake external delivery without a configured provider.
    m.Outbox.objects.create(
        company=company,
        kind="lead_created",
        payload={"leadId": str(lead.id)},
        idempotency_key=f"lead:{lead.id}",
    )
    audit(ctx, "lead.create", lead.id)
    return lead


@transaction.atomic
def update_lead(ctx, id, patch):
    demand(ctx, "ops")
    lead = obj(ctx, m.Lead, id, True)
    if ctx.member.role == "staff" and patch.get("assigneeId") not in [
        None,
        str(ctx.user.pk),
    ]:
        raise PermissionDenied()
    before = serialize(lead)
    if patch.get("status") in ["won", "lost"]:
        patch["closedAt"] = timezone.now().isoformat()
    lead = save(
        ctx,
        m.Lead,
        patch,
        lead,
        readonly=["number", "source", "source_id", "contact", "created_at"],
    )
    m.LeadEvent.objects.create(
        company=ctx.company,
        lead=lead,
        actor=ctx.user,
        action="status" if "status" in patch else "field",
        before=before,
        after=serialize(lead),
    )
    audit(ctx, "lead.update", lead.id, before, serialize(lead))
    return lead


@transaction.atomic
def book(ctx, data, id=None):
    demand(ctx, "ops")
    a = obj(ctx, m.Appointment, id, True) if id else None
    resource_id = data.get("resourceId", str(a.resource_id) if a else None)
    resource = obj(ctx, m.Resource, resource_id, True)
    from django.utils.dateparse import parse_datetime

    start = parse_datetime(data.get("startsAt", ""))
    if not start or timezone.is_naive(start) or start.timestamp() % 900:
        raise ValidationError("Шаг записи — 15 минут, время с часовым поясом.")
    duration = data.get(
        "durationMin", int((a.ends_at - a.starts_at).total_seconds() / 60) if a else 60
    )
    if not isinstance(duration, int) or not 15 <= duration <= 720:
        raise ValidationError("Длительность от 15 до 720 минут.")
    end = start + timedelta(minutes=duration)
    conflicts = m.Appointment.objects.filter(
        company=ctx.company, resource=resource, starts_at__lt=end, ends_at__gt=start
    ).exclude(status__in=["cancelled", "no_show"])
    if a:
        conflicts = conflicts.exclude(pk=a.pk)
    if conflicts.exists():
        raise ValidationError("Время занято. Выберите другой слот.")
    if a and a.status in ["done", "no_show", "cancelled"]:
        raise ValidationError("Эту запись нельзя перенести.")
    contact = a.contact if a else None
    blocked = data.get("block", False)
    if not a and not blocked:
        p = phone(data.get("contactPhone", ""))
        contact, _ = m.Contact.objects.get_or_create(
            company=ctx.company,
            phone=p,
            defaults={"name": data.get("contactName", ""), "channels": ["phone"]},
        )
    clean = dict(
        resourceId=str(resource.id),
        startsAt=start.isoformat(),
        endsAt=end.isoformat(),
        contactId=str(contact.id) if contact else None,
        status="blocked" if blocked else (a.status if a else "booked"),
        note=data.get("note", a.note if a else ""),
    )
    if data.get("serviceId"):
        clean["serviceId"] = data["serviceId"]
    a = save(ctx, m.Appointment, clean, a)
    audit(ctx, "appointment.move" if id else "appointment.create", a.id)
    return a


@transaction.atomic
def offer_next(company, scope):
    m.Company.objects.select_for_update().get(pk=company.pk)
    now = timezone.now()
    m.Ticket.objects.filter(company=company, status="closed", opens_at__lte=now).update(
        status="open"
    )
    ticket = (
        m.Ticket.objects.select_for_update()
        .filter(company=company, specialty=scope, status="open", starts_at__gt=now)
        .order_by("starts_at")
        .first()
    )
    waiting = (
        m.Waitlist.objects.select_for_update()
        .filter(company=company, scope=scope, status="waiting")
        .order_by("position", "created_at")
        .first()
    )
    if not ticket or not waiting:
        return None
    waiting.status = "offered"
    waiting.ticket = ticket
    waiting.offered_at = now
    waiting.expires_at = now + timedelta(minutes=15)
    waiting.save()
    ticket.status = "offered"
    ticket.contact_name = waiting.contact_name
    ticket.contact_phone = waiting.contact_phone
    ticket.save()
    m.Outbox.objects.create(
        company=company,
        kind="waitlist_offer",
        payload={"waitlistId": str(waiting.id), "phone": waiting.contact_phone},
        idempotency_key=f"offer:{waiting.id}:{ticket.id}",
    )
    return waiting


def usage(ctx):
    sub = (
        m.Subscription.objects.filter(
            company=ctx.company, period_end__gt=timezone.now()
        )
        .order_by("-period_start")
        .first()
    )
    if not sub:
        return dict(
            minutesUsed=0,
            minutesTotal=0,
            dialogsUsed=0,
            dialogsTotal=0,
            linesBusy=0,
            linesTotal=0,
            periodStart=timezone.now().isoformat(),
            periodEnd=timezone.now().isoformat(),
            overagePolicy="stop_ai",
            forecast=0,
        )
    secs = (
        m.Call.objects.filter(
            company=ctx.company,
            started_at__gte=sub.period_start,
            started_at__lt=sub.period_end,
        ).aggregate(n=Sum("billed_seconds"))["n"]
        or 0
    )
    # Bill a channel/contact only once in each rolling 24h dialogue window.
    groups = {}
    dialogs = 0
    for c in m.Conversation.objects.filter(
        company=ctx.company,
        created_at__gte=sub.period_start,
        created_at__lt=sub.period_end,
    ).order_by("created_at"):
        key = (c.channel, c.contact_id or c.external_id or str(c.pk))
        if key not in groups or c.created_at - groups[key] >= timedelta(hours=24):
            dialogs += 1
            groups[key] = c.created_at
    return dict(
        minutesUsed=secs / 60,
        minutesTotal=sub.minutes_total,
        dialogsUsed=dialogs,
        dialogsTotal=sub.dialogs_total,
        linesBusy=m.Call.objects.filter(company=ctx.company, ended_at=None).count(),
        linesTotal=sub.lines_total,
        periodStart=sub.period_start.isoformat(),
        periodEnd=sub.period_end.isoformat(),
        overagePolicy=sub.overage_policy,
        overageCapMinor=sub.overage_cap_minor,
        forecast=0,
    )
