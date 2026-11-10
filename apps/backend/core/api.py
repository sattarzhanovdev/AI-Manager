import hashlib, json, re, uuid
from datetime import timedelta
from types import SimpleNamespace
from zoneinfo import ZoneInfo
import pyotp
from django.contrib.auth import authenticate, get_user_model
from django.db import transaction, IntegrityError
from django.db.models import Q, Max
from django.utils import timezone
from rest_framework import serializers, viewsets
from rest_framework.exceptions import NotFound, PermissionDenied, ValidationError
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView, exception_handler as drf_exception_handler
from drf_spectacular.utils import extend_schema, inline_serializer, OpenApiTypes
from . import models as m
from .auth import cipher, digest, issue_session
from .middleware import set_tenant
from .serializers import serialize, serializer_for, phone
from . import services as s


def exception_handler(exc, context):
    from django.core.exceptions import ValidationError as DjangoValidationError

    if isinstance(exc, DjangoValidationError):
        return Response({"detail": "Проверьте формат полей."}, status=400)
    if isinstance(exc, IntegrityError):
        return Response(
            {"detail": "Конфликт данных. Обновите страницу и повторите."}, status=409
        )
    if isinstance(exc, (IndexError, KeyError, TypeError, ValueError)):
        return Response({"detail": "Некорректные параметры запроса."}, status=400)
    return drf_exception_handler(exc, context)


def context(request):
    wanted = request.headers.get("X-Company-ID")
    memberships = m.Membership.objects.filter(
        user=request.user, disabled_at=None
    ).order_by("created_at")
    if wanted:
        try:
            memberships = memberships.filter(company_id=uuid.UUID(wanted))
        except ValueError:
            raise NotFound()
    member = memberships.first()
    if not member:
        raise NotFound("Компания не найдена.")
    set_tenant(member.company_id)
    request.member = member
    request.company = member.company
    return request


class LoginInput(serializers.Serializer):
    email = serializers.EmailField()
    password = serializers.CharField(max_length=200, write_only=True)
    otp = serializers.CharField(max_length=6, required=False, allow_blank=True)


class LoginView(APIView):
    permission_classes = [AllowAny]
    authentication_classes = []

    @extend_schema(
        request=LoginInput,
        responses={
            200: inline_serializer(
                "LoginResponse",
                {
                    "token": serializers.CharField(required=False),
                    "mfaRequired": serializers.BooleanField(required=False),
                    "setupSecret": serializers.CharField(required=False),
                },
            )
        },
    )
    @transaction.atomic
    def post(self, request):
        v = LoginInput(data=request.data)
        v.is_valid(raise_exception=True)
        user = authenticate(
            username=v.validated_data["email"].lower(),
            password=v.validated_data["password"],
        )
        if not user:
            return Response({"detail": "Неверный email или пароль."}, status=401)
        # Set user context before membership RLS. No tenant data is exposed here.
        from django.db import connection

        if connection.vendor == "postgresql":
            with connection.cursor() as c:
                c.execute("SELECT set_config('app.user_id', %s, true)", [str(user.pk)])
        members = m.Membership.objects.filter(user=user, disabled_at=None)
        if not members.exists():
            return Response({"detail": "Нет доступа к компании."}, status=403)
        privileged = user.is_staff or members.filter(role="owner").exists()
        if privileged:
            device = m.MFADevice.objects.select_for_update().filter(user=user).first()
            if not device:
                device = m.MFADevice.objects.create(
                    user=user,
                    encrypted_secret=cipher()
                    .encrypt(pyotp.random_base32().encode())
                    .decode(),
                )
            secret = cipher().decrypt(device.encrypted_secret.encode()).decode()
            otp = v.validated_data.get("otp", "")
            if not otp:
                return Response(
                    {
                        "mfaRequired": True,
                        **(
                            {
                                "setupSecret": secret,
                                "setupUri": pyotp.TOTP(secret).provisioning_uri(
                                    user.email, issuer_name="ALL-менеджер"
                                ),
                            }
                            if not device.confirmed
                            else {}
                        ),
                    }
                )
            counter = int(timezone.now().timestamp()) // 30
            if not pyotp.TOTP(secret).verify(otp) or counter <= device.last_counter:
                return Response(
                    {"detail": "Неверный или уже использованный код 2FA."}, status=400
                )
            device.confirmed = True
            device.last_counter = counter
            device.save()
        token = issue_session(user, privileged)
        member = members.first()
        set_tenant(member.company_id)
        m.Audit.objects.create(
            company_id=member.company_id,
            actor_name=user.email,
            action="auth.login",
            entity="session",
            ip=request.META.get("REMOTE_ADDR"),
        )
        return Response({"token": token})


@extend_schema(responses=OpenApiTypes.OBJECT)
class SessionView(APIView):
    def get(self, request):
        c = context(request)
        return Response(
            dict(
                userId=str(c.user.pk),
                companyId=str(c.company.pk),
                email=c.user.email,
                member=serialize(c.member),
            )
        )

    def delete(self, request):
        request.auth.revoked_at = timezone.now()
        request.auth.save(update_fields=["revoked_at"])
        return Response(status=204)


@extend_schema(responses=OpenApiTypes.OBJECT)
class SessionsView(APIView):
    def get(self, request):
        return Response(
            [
                {
                    "id": str(x.pk),
                    "createdAt": x.created_at,
                    "expiresAt": x.expires_at,
                    "current": x.pk == request.auth.pk,
                }
                for x in m.AccessSession.objects.filter(
                    user=request.user, revoked_at=None, expires_at__gt=timezone.now()
                )
            ]
        )

    def delete(self, request):
        m.AccessSession.objects.filter(user=request.user, revoked_at=None).update(
            revoked_at=timezone.now()
        )
        return Response(status=204)


READ_MODELS = {
    "getCompany": m.Company,
    "getMembers": m.Membership,
    "getBranches": m.Branch,
    "getNumbers": m.PhoneNumber,
    "listCalls": m.Call,
    "listLeads": m.Lead,
    "listContacts": m.Contact,
    "getInvoices": m.Invoice,
    "getIntegrations": m.Integration,
    "getAudit": m.Audit,
    "listConversations": m.Conversation,
    "getNotificationPrefs": m.Preference,
}


def timeline(c, contact):
    items = []
    for lead in s.rows(c, m.Lead).filter(contact=contact):
        items.append(
            dict(
                kind="lead",
                id=str(lead.pk),
                at=lead.created_at.isoformat(),
                title=f"#{lead.number} {lead.title}",
                subtitle=lead.status,
                href=f"/app/leads?open={lead.pk}",
            )
        )
    for call in s.rows(c, m.Call).filter(contact=contact):
        items.append(
            dict(
                kind="call",
                id=str(call.pk),
                at=call.started_at.isoformat(),
                title=call.summary or "Звонок",
                subtitle=call.outcome,
                href=f"/app/calls?open={call.pk}",
            )
        )
    return sorted(items, key=lambda x: x["at"], reverse=True)[:50]


def analytics(c, days):
    s.demand(c, "ops")
    tz = ZoneInfo(c.company.timezone)
    now = timezone.now()
    since = now - timedelta(days=days)
    calls = list(s.rows(c, m.Call).filter(started_at__gte=since))
    leads = list(s.rows(c, m.Lead).filter(created_at__gte=since))
    heat = [[0] * 24 for _ in range(7)]
    for x in calls:
        dt = x.started_at.astimezone(tz)
        heat[dt.weekday()][dt.hour] += 1
    daykey = lambda d: d.astimezone(tz).date().isoformat()
    byday = []
    for i in reversed(range(days)):
        day = daykey(now - timedelta(days=i))
        byday.append(
            dict(
                day=day,
                calls=sum(daykey(x.started_at) == day for x in calls),
                leads=sum(daykey(x.created_at) == day for x in leads),
            )
        )
    transfers = [x for x in calls if x.transferred]
    return dict(
        funnel=[
            {"key": k, "value": v}
            for k, v in [
                ("calls", len(calls)),
                (
                    "target",
                    sum(x.type not in ["spam", "irrelevant", ""] for x in calls),
                ),
                ("leads", len(leads)),
                ("won", sum(x.status == "won" for x in leads)),
            ]
        ],
        heat=heat,
        byDay=byday,
        transfers=dict(
            total=len(transfers),
            share=len(transfers) / len(calls) if calls else 0,
            answered=0,
            reasons={},
        ),
    )


def read(c, name, id=None, days=30):
    if name == "getIntegrations":
        keys = [
            ("telegram_notify", "channels", "1a"),
            ("telegram_channel", "channels", "1b"),
            ("widget", "channels", "1b"),
            ("whatsapp", "channels", "2"),
            ("instagram", "channels", "2"),
            ("bitrix24", "crm", "2"),
            ("amocrm", "crm", "2"),
            ("google_calendar", "calendars", "2"),
            ("yclients", "calendars", "3"),
            ("google_sheets", "sheets", "2"),
            ("webhooks", "developers", "2"),
            ("api", "developers", "3"),
        ]
        saved = {
            i.key: serialize(i) for i in m.Integration.objects.filter(company=c.company)
        }
        return [
            saved.get(
                key,
                dict(
                    key=key,
                    group=group,
                    phase=phase,
                    status="not_connected" if phase in ["1a", "1b"] else "plan_locked",
                    errors24h=0,
                ),
            )
            for key, group, phase in keys
        ]
    if name in READ_MODELS:
        model = READ_MODELS[name]
        if model is m.Company:
            return serialize(c.company)
        if model is m.Invoice:
            s.demand(c, "billing")
        if model is m.Audit:
            s.demand(c, "owner")
        if model is m.Preference:
            return {
                str(c.user.pk): serialize(
                    model.objects.filter(company=c.company, user=c.user), True
                )
            }
        return serialize(s.rows(c, model).order_by("-created_at"), True)
    if name == "getQuestionnaire":
        if c.member.role not in ["owner", "admin"]:
            raise PermissionDenied()
        return s.kb_state(c)
    if name == "getAssistant":
        if c.member.role not in ["owner", "admin"]:
            raise PermissionDenied()
        return s.assistant(c)
    if name == "getCurrentPlan":
        sub = (
            m.Subscription.objects.filter(company=c.company)
            .order_by("-period_start")
            .first()
        )
        return sub.plan if sub and sub.plan else s.DEFAULT_PLAN
    if name == "getUsage":
        return s.usage(c)
    if name == "getPlans":
        # Prices are assigned by platform staff; do not invent commercial terms.
        return [read(c, "getCurrentPlan")]
    if name == "getNotifications":
        return serialize(
            m.Notification.objects.filter(company=c.company)
            .filter(Q(user=c.user) | Q(user=None))
            .order_by("-created_at")[:100],
            True,
        )
    if name == "getApiKeys":
        return []  # Public developer API is phase 3.
    if name == "getIntegrationLogs":
        return []
    if name == "getSidebarStats":
        q = s.kb_state(c) if c.member.role in ["owner", "admin"] else None
        return dict(
            newUnassignedLeads=m.Lead.objects.filter(
                company=c.company, status="new", assignee=None
            ).count()
            if c.member.role in ["owner", "admin"]
            else 0,
            unansweredCount=len(q["unanswered"]) if q else 0,
            kbLow=bool(q and q["draft"]["completeness"] < 50),
        )
    if name == "getCalendar":
        s.demand(c, "ops")
        return {
            key: serialize(s.rows(c, model).order_by("created_at"), True)
            for key, model in [
                ("resources", m.Resource),
                ("appointments", m.Appointment),
                ("tickets", m.Ticket),
                ("waitlist", m.Waitlist),
                ("services", m.Service),
                ("branches", m.Branch),
            ]
        }
    if name == "getCall":
        call = s.obj(c, m.Call, id)
        return serialize(call)
    if name == "getLead":
        lead = s.obj(c, m.Lead, id)
        return dict(
            lead=serialize(lead),
            events=serialize(lead.events.all().order_by("created_at"), True),
            call=serialize(s.obj(c, m.Call, lead.source_id))
            if lead.source == "call" and lead.source_id
            else None,
            history=timeline(c, lead.contact) if lead.contact else [],
            dialog=serialize(
                s.rows(c, m.Message)
                .filter(conversation_id=lead.source_id)
                .order_by("created_at"),
                True,
            )
            if lead.source == "chat"
            else [],
        )
    if name == "getContact":
        contact = s.obj(c, m.Contact, id)
        return dict(
            contact=serialize(contact),
            timeline=timeline(c, contact),
            leads=serialize(s.rows(c, m.Lead).filter(contact=contact), True),
        )
    if name == "getConversation":
        conv = s.obj(c, m.Conversation, id)
        return dict(
            conversation=serialize(conv),
            messages=serialize(conv.messages.order_by("created_at"), True),
            contact=serialize(conv.contact) if conv.contact else None,
            timeline=timeline(c, conv.contact) if conv.contact else [],
            leads=serialize(s.rows(c, m.Lead).filter(contact=conv.contact), True)
            if conv.contact
            else [],
            otherChats=serialize(
                s.rows(c, m.Conversation)
                .filter(contact=conv.contact)
                .exclude(pk=conv.pk),
                True,
            )
            if conv.contact
            else [],
            quickReplies=[],
            templates=[],
        )
    if name == "getAnalytics":
        return analytics(c, days)
    if name == "getOverview":
        s.demand(c, "ops")
        tz = ZoneInfo(c.company.timezone)
        today = timezone.now().astimezone(tz).date()
        yesterday = today - timedelta(days=1)
        calls = list(s.rows(c, m.Call))
        leads = list(s.rows(c, m.Lead))
        q = s.kb_state(c) if c.member.role != "staff" else None
        tc = [x for x in calls if x.started_at.astimezone(tz).date() == today]
        yc = [x for x in calls if x.started_at.astimezone(tz).date() == yesterday]
        hours = lambda xs: [
            sum(x.started_at.astimezone(tz).hour == h for x in xs) for h in range(24)
        ]
        missed = [x for x in tc if x.outcome == "missed"]
        u = s.usage(c)
        bystatus = {
            key: sum(x.status == key for x in leads)
            for key in ["new", "in_progress", "waiting", "won", "lost"]
        }
        attention = []
        for lead in leads:
            if lead.status in ["won", "lost"]:
                continue
            kind = (
                "complaint"
                if lead.type == "complaint"
                else "urgent"
                if lead.priority == "urgent"
                else "sla"
                if lead.due_at and lead.due_at < timezone.now() and not lead.assignee_id
                else None
            )
            if kind:
                attention.append(
                    dict(
                        id=str(lead.pk),
                        kind=kind,
                        title=lead.title,
                        subtitle=lead.contact.name if lead.contact else "",
                        at=lead.created_at.isoformat(),
                        href=f"/app/leads?open={lead.pk}",
                        leadId=str(lead.pk),
                    )
                )
        for call in calls:
            if call.outcome == "missed" and not call.callback_done_at:
                attention.append(
                    dict(
                        id=str(call.pk),
                        kind="missed",
                        title=call.caller,
                        subtitle="",
                        at=call.started_at.isoformat(),
                        href=f"/app/calls?open={call.pk}",
                        callId=str(call.pk),
                        phone=call.caller,
                    )
                )
        attention.sort(
            key=lambda x: (
                {"complaint": 0, "urgent": 1, "sla": 2, "missed": 3}[x["kind"]],
                x["at"],
            )
        )
        return dict(
            kpi=dict(
                callsToday=len(tc),
                callsYesterday=len(yc),
                callsSpark=hours(tc)[8:22],
                answeredPct=round(100 * (len(tc) - len(missed)) / len(tc))
                if tc
                else 100,
                newLeads=sum(
                    x.status == "new" and x.assignee_id is None for x in leads
                ),
                missed=len(missed),
                missedReason="",
                minutesLeft=max(0, u["minutesTotal"] - u["minutesUsed"]),
                minutesForecast=0,
                minutesTotal=u["minutesTotal"],
                kbIndex=q["draft"]["completeness"] if q else 0,
                unanswered=len(q["unanswered"]) if q else 0,
            ),
            attention=attention[:15],
            hours=dict(today=hours(tc), yesterday=hours(yc)),
            status=dict(
                aiMode=c.company.ai_mode,
                linesBusy=u["linesBusy"],
                linesTotal=u["linesTotal"],
                numbers=read(c, "getNumbers"),
                integrations=read(c, "getIntegrations"),
                lastPublish=q["published"] if q else None,
            ),
            firstWeek=len(calls) < 10,
            leadStats=dict(
                total=len(leads),
                today=sum(x.created_at.astimezone(tz).date() == today for x in leads),
                newUnassigned=sum(
                    x.status == "new" and not x.assignee_id for x in leads
                ),
                processed=bystatus["won"] + bystatus["lost"],
                byStatus=bystatus,
            ),
            recent=[],
        )
    raise NotFound("Неизвестный запрос.")


@extend_schema(responses=OpenApiTypes.OBJECT)
class ReadView(APIView):
    def get(self, request, name):
        c = context(request)
        try:
            days = max(1, min(90, int(request.query_params.get("days", 30))))
        except ValueError:
            raise ValidationError("Некорректный период.")
        return Response(read(c, name, request.query_params.get("id"), days))


class CommandInput(serializers.Serializer):
    args = serializers.ListField(
        child=serializers.JSONField(allow_null=True), max_length=10
    )


class CommandView(APIView):
    @extend_schema(request=CommandInput, responses=OpenApiTypes.OBJECT)
    @transaction.atomic
    def post(self, request, name):
        c = context(request)
        v = CommandInput(data=request.data)
        v.is_valid(raise_exception=True)
        args = v.validated_data["args"]
        if name in [
            "setField",
            "upsertServices",
            "upsertStaff",
            "upsertFaq",
            "deleteRows",
            "bulkPrice",
            "answerUnanswered",
            "publishQuestionnaire",
            "rollbackQuestionnaire",
        ]:
            m.Company.objects.select_for_update().get(pk=c.company.pk)
        result = command(c, name, args)
        return Response(result)


def command(c, name, a):
    if name == "assistantContext":
        if c.member.role not in ["owner", "admin"]:
            raise PermissionDenied()
        published = m.Questionnaire.objects.filter(
            company=c.company, status="published"
        ).first()
        if not published:
            raise ValidationError("Сначала опубликуйте базу знаний.")
        conv = (
            s.obj(c, m.Conversation, a[0], True)
            if a and a[0]
            else m.Conversation.objects.create(
                company=c.company,
                channel="widget",
                external_id=f"test:{c.user.pk}",
                assignee=c.user,
            )
        )
        if conv.state not in ["ai", "draft"]:
            raise ValidationError("Диалог ведёт оператор или он закрыт.")
        return dict(
            conversationId=str(conv.pk),
            state=conv.dialog_state,
            snapshot={
                **published.snapshot,
                "services": [
                    {**x, "staff": x.get("staffIds", [])}
                    for x in published.snapshot.get("services", [])
                ],
            },
            version=published.version,
            revision=conv.last_message_at.isoformat(),
        )
    if name == "assistantCommit":
        if c.member.role not in ["owner", "admin"]:
            raise PermissionDenied()
        data = a[0]
        conv = s.obj(c, m.Conversation, data["conversationId"], True)
        if conv.state not in ["ai", "draft"]:
            raise ValidationError("Диалог перехвачен оператором. Ответ AI отменён.")
        if conv.last_message_at.isoformat() != data.get("revision"):
            raise ValidationError("Диалог уже изменился. Повторите сообщение.")
        reply = data["reply"]
        state = reply["state"]
        prev = conv.dialog_state
        text = reply["text"]
        lead = None
        message = serializers.CharField(min_length=1, max_length=1000).run_validation(
            data["message"]
        )
        fields = state.get("fields", {})
        requested = any(
            t.get("name") == "create_lead" and t.get("status") == "ok"
            for t in reply.get("toolCalls", [])
        )
        reason = (reply.get("handoff") or {}).get("reason") or prev.get("handoffReason")
        if reason and not fields.get("phone"):
            state["handoffReason"] = reason
            text += " Оставьте номер телефона — администратор перезвонит."
        if (
            not prev.get("leadCreated")
            and fields.get("phone")
            and (requested or reason)
        ):
            kind = "callback" if reason else "booking"
            lead = s.new_lead(
                c,
                dict(
                    phone=fields["phone"],
                    name=fields.get("name", ""),
                    title=("Перезвонить" if reason else "Заявка на запись")
                    + ": "
                    + fields.get("service", "уточнить"),
                    type=kind,
                    priority="urgent" if reason else "normal",
                    payload={k: str(v) for k, v in fields.items()},
                ),
                source="chat",
                source_id=conv.pk,
            )
            conv.contact = lead.contact
            state["leadCreated"] = True
            state.pop("handoffReason", None)
            text = f"Готово, заявка №{lead.number} создана. Администратор свяжется с вами и подтвердит время."
        m.Message.objects.create(
            company=c.company,
            conversation=conv,
            direction="in",
            author="client",
            body=message,
            status="delivered",
        )
        m.Message.objects.create(
            company=c.company,
            conversation=conv,
            direction="out",
            author="ai",
            body=text,
            status="sent",
        )
        conv.dialog_state = state
        conv.last_message = text
        conv.last_message_at = timezone.now()
        conv.save()
        return dict(
            conversationId=str(conv.pk),
            text=text,
            engine="offline",
            fallback="no_key",
            tools=[x["name"] for x in reply.get("toolCalls", [])],
            lead=dict(id=str(lead.pk), number=lead.number, title=lead.title)
            if lead
            else None,
            mock=False,
        )
    if name == "createLead":
        if a[0].get("sourceCallId"):
            s.obj(c, m.Call, a[0]["sourceCallId"])
        return serialize(
            s.new_lead(
                c,
                a[0],
                source="call" if a[0].get("sourceCallId") else "manual",
                source_id=a[0].get("sourceCallId"),
            )
        )
    if name == "updateLead":
        return serialize(s.update_lead(c, *a))
    if name == "bulkUpdateLeads":
        if len(a[0]) > 500:
            raise ValidationError("Не более 500 записей.")
        for id in a[0]:
            s.update_lead(c, id, a[1])
        return len(a[0])
    if name == "commentLead":
        s.demand(c, "ops")
        lead = s.obj(c, m.Lead, a[0])
        text = serializers.CharField(min_length=1, max_length=2000).run_validation(a[1])
        m.LeadEvent.objects.create(
            company=c.company, lead=lead, actor=c.user, action="comment", comment=text
        )
        return None
    if name in ["createContact", "updateContact"]:
        s.demand(c, "ops")
        if name == "createContact":
            data = a[0]
            p = phone(data["phone"])
            existing = m.Contact.objects.filter(company=c.company, phone=p).first()
            if existing and not s.rows(c, m.Contact).filter(pk=existing.pk).exists():
                raise NotFound()
            return serialize(existing or s.save(c, m.Contact, {**data, "phone": p}))
        return serialize(s.save(c, m.Contact, a[1], s.obj(c, m.Contact, a[0])))
    if name == "mergeContacts":
        s.demand(c, "owner")
        primary = s.obj(c, m.Contact, a[0], True)
        for id in a[1]:
            if id == str(primary.pk):
                continue
            other = s.obj(c, m.Contact, id, True)
            for model in [m.Lead, m.Call, m.Conversation, m.Appointment]:
                model.objects.filter(company=c.company, contact=other).update(
                    contact=primary
                )
            primary.tags = list(set(primary.tags + other.tags))
            primary.channels = list(set(primary.channels + other.channels))
            primary.interactions_count += other.interactions_count
            other.delete()
        primary.save()
        s.audit(c, "contact.merge", primary.pk)
        return None
    if name in ["eraseContact", "eraseByPhone"]:
        s.demand(c, "owner")
        contact = (
            s.obj(c, m.Contact, a[0])
            if name == "eraseContact"
            else m.Contact.objects.filter(company=c.company, phone=phone(a[0])).first()
        )
        if not contact:
            raise NotFound()
        m.Call.objects.filter(company=c.company, contact=contact).update(
            caller="", summary="", turns=[], tool_calls=[]
        )
        m.Lead.objects.filter(company=c.company, contact=contact).update(payload={})
        m.Message.objects.filter(
            company=c.company, conversation__contact=contact
        ).delete()
        m.Conversation.objects.filter(company=c.company, contact=contact).update(
            last_message="", dialog_state={}
        )
        m.Waitlist.objects.filter(
            company=c.company, contact_phone=contact.phone
        ).update(contact_name="", contact_phone="", status="removed")
        m.Ticket.objects.filter(company=c.company, contact_phone=contact.phone).update(
            contact_name="", contact_phone=""
        )
        m.Outbox.objects.filter(
            company=c.company, status__in=["pending", "retry", "unconfigured"]
        ).update(payload={}, status="cancelled")
        m.RealtimeEvent.objects.filter(company=c.company).delete()
        for lead in m.Lead.objects.filter(company=c.company, contact=contact):
            lead.events.update(before=None, after=None, comment="")
        s.audit(c, "contact.erase", contact.pk)
        contact.delete()
        return None
    if name == "setField":
        s.demand(c, "kb")
        field = next(
            (f for b in s.BLOCKS for f in b["fields"] if f["key"] == a[0]), None
        )
        if not field:
            raise ValidationError("Неизвестное поле анкеты.")
        if len(json.dumps(a[1], ensure_ascii=False)) > 10000:
            raise ValidationError("Слишком длинное значение.")
        value = a[1]
        if value not in [None, ""]:
            if field["kind"] == "select" and value not in field.get("options", []):
                raise ValidationError("Выберите значение из списка.")
            if field["kind"] == "hours":
                if not isinstance(value, dict):
                    raise ValidationError("Укажите график по дням.")
                for day, ranges in value.items():
                    if day not in [
                        "mon",
                        "tue",
                        "wed",
                        "thu",
                        "fri",
                        "sat",
                        "sun",
                    ] or not isinstance(ranges, list):
                        raise ValidationError("Неверный график.")
                    for hours in ranges:
                        if (
                            len(hours) != 2
                            or not all(
                                re.fullmatch(r"(?:[01]\d|2[0-3]):[0-5]\d", x)
                                for x in hours
                            )
                            or hours[0] >= hours[1]
                        ):
                            raise ValidationError("Неверный интервал графика.")
            elif field["kind"] in ["text", "textarea"] and not isinstance(value, str):
                raise ValidationError("Введите текст.")
        q = s.draft(c.company)
        if a[1] in [None, ""]:
            q.fields.pop(a[0], None)
        else:
            q.fields[a[0]] = a[1]
        q.save()
        if a[0] in [
            "branch.address",
            "branch.landmarks",
            "branch.hours",
            "branch.phones",
        ]:
            branch = (
                m.Branch.objects.filter(company=c.company)
                .order_by("created_at")
                .first()
            )
            if not branch:
                branch = m.Branch.objects.create(
                    company=c.company, name="Основной филиал"
                )
            key = a[0].split(".")[1]
            normalized = value
            if key == "phones":
                values = (
                    value if isinstance(value, list) else str(value or "").split("\n")
                )
                normalized = [phone(p.strip()) for p in values if p.strip()]
            elif key == "hours":
                normalized = value or {}
            else:
                normalized = value or ""
            setattr(branch, key, normalized)
            branch.save()
        s.audit(c, "kb.field", a[0])
        return {"completeness": s.kb_state(c)["draft"]["completeness"]}
    if name in ["upsertServices", "upsertStaff", "upsertFaq"]:
        s.demand(c, "kb")
        model = {
            "upsertServices": m.Service,
            "upsertStaff": m.Staff,
            "upsertFaq": m.Faq,
        }[name]
        if len(a[0]) > 500:
            raise ValidationError("Не более 500 строк.")
        out = []
        for data in a[0]:
            id = data.get("id")
            instance = s.obj(c, model, id) if id else None
            out.append(serialize(s.save(c, model, data, instance)))
        s.audit(c, "kb.table", model.__name__)
        return out
    if name == "deleteRows":
        s.demand(c, "kb")
        model = {"services": m.Service, "staff": m.Staff, "faq": m.Faq}.get(a[0])
        if not model:
            raise ValidationError("Неизвестная таблица.")
        for id in a[1]:
            s.obj(c, model, id).delete()
        return None
    if name == "bulkPrice":
        s.demand(c, "kb")
        pct = serializers.FloatField(min_value=-100, max_value=1000).run_validation(
            a[1]
        )
        for id in a[0]:
            service = s.obj(c, m.Service, id)
            for key in ["price_min", "price_max"]:
                if getattr(service, key) is not None:
                    setattr(
                        service, key, round(getattr(service, key) * (1 + pct / 100))
                    )
            service.save()
        return None
    if name == "answerUnanswered":
        s.demand(c, "kb")
        uq = s.obj(c, m.Unanswered, a[0])
        s.save(c, m.Faq, dict(question=uq.text, shortAnswer=a[1]))
        uq.resolved = True
        uq.save()
        return None
    if name == "publishQuestionnaire":
        return s.publish(c)
    if name == "rollbackQuestionnaire":
        return s.publish(c, a[0])
    if name == "runQuestionCheck":
        s.demand(c, "kb")
        state = s.kb_state(c)
        return [
            {
                "q": f["label"],
                "ok": bool(state["fields"].get(f["key"])),
                "answer": str(state["fields"].get(f["key"]) or ""),
            }
            for b in s.BLOCKS
            for f in b["fields"]
            if f["level"] == "required"
        ]
    if name == "setAiMode":
        s.demand(c, "ai")
        mode = serializers.ChoiceField(
            choices=["on", "leads_only", "all_human", "off"]
        ).run_validation(a[0])
        if mode in ["on", "leads_only"]:
            state = s.kb_state(c)
            sub = m.Subscription.objects.filter(
                company=c.company, paid=True, period_end__gt=timezone.now()
            ).exists()
            if (
                c.company.status != "active"
                or not sub
                or not state["published"]
                or state["published"]["completeness"] < 70
            ):
                raise ValidationError(
                    "Реальная линия требует оплаты, модерации и опубликованной анкеты от 70%."
                )
        c.company.ai_mode = mode
        c.company.save()
        s.audit(c, "ai.mode", c.company.pk, after={"mode": mode})
        return None
    if name == "updateAssistant":
        s.demand(c, "publish")
        data = a[0]
        allowed = set(s.DEFAULT_ASSISTANT)
        if set(data) - allowed:
            raise ValidationError("Неизвестная настройка.")
        if "greeting" in data and not re.search(
            r"AI|ИИ|виртуальн|искусствен", data["greeting"], re.I
        ):
            raise ValidationError("В приветствии обязательно раскрытие AI.")
        if data.get("mode") in ["booking", "semi"]:
            raise ValidationError(
                "Автоматическая запись для частного бизнеса — фаза 2."
            )
        obj, _ = m.Assistant.objects.get_or_create(company=c.company)
        obj.settings = {**obj.settings, **data}
        obj.save()
        s.audit(c, "assistant.update", obj.pk)
        return None
    if name == "updateCompany":
        s.demand(c, "owner")
        serializer = serializer_for(
            m.Company, ["ai_mode", "status", "next_lead_number"]
        )(c.company, data=a[0], partial=True, context={"company": c.company})
        serializer.is_valid(raise_exception=True)
        serializer.save()
        s.audit(c, "company.update", c.company.pk)
        return None
    if name == "updateNumber":
        s.demand(c, "owner")
        return serialize(
            s.save(
                c,
                m.PhoneNumber,
                a[1],
                s.obj(c, m.PhoneNumber, a[0]),
                readonly=["e164", "lines", "kind"],
            )
        )
    if name in ["updateMember", "disableMember"]:
        s.demand(c, "team")
        member = s.obj(c, m.Membership, a[0], True)
        if member.role == "owner" or member.user_id == c.user.pk:
            raise ValidationError("Собственника нельзя изменить этим действием.")
        if name == "disableMember":
            replacement = a[1] if len(a) > 1 else None
            if (
                replacement
                and not m.Membership.objects.filter(
                    company=c.company, user_id=replacement, disabled_at=None
                ).exists()
            ):
                raise NotFound()
            m.Lead.objects.filter(company=c.company, assignee=member.user).update(
                assignee_id=replacement
            )
            m.Conversation.objects.filter(
                company=c.company, assignee=member.user
            ).update(assignee_id=replacement, state="ai")
            member.disabled_at = timezone.now()
            member.save()
            m.AccessSession.objects.filter(user=member.user, revoked_at=None).update(
                revoked_at=timezone.now()
            )
        else:
            if a[1].get("role") == "owner":
                raise ValidationError("Передача прав требует подтверждения email.")
            s.save(c, m.Membership, a[1], member, readonly=["user"])
        s.audit(c, "team.update", member.pk)
        return None
    if name == "inviteMember":
        import secrets

        s.demand(c, "team")
        data = a[0]
        email = serializers.EmailField().run_validation(data.get("contact")).lower()
        role = serializers.ChoiceField(
            choices=["admin", "staff", "accountant"]
        ).run_validation(data.get("role"))
        token = secrets.token_urlsafe(32)
        inv = m.Invitation.objects.create(
            company=c.company,
            email=email,
            role=role,
            token_hash=digest(token),
            expires_at=timezone.now() + timedelta(days=3),
        )
        url = f"/invite/{c.company.pk}.{token}"
        s.audit(c, "team.invite", inv.pk)
        return {"inviteUrl": url}

    if name == "setOverage":
        s.demand(c, "owner")
        sub = (
            m.Subscription.objects.filter(company=c.company)
            .order_by("-period_start")
            .first()
        )
        if not sub:
            raise ValidationError("Тариф ещё не назначен.")
        sub.overage_policy = serializers.ChoiceField(
            choices=["pay", "stop_ai"]
        ).run_validation(a[0])
        sub.overage_cap_minor = a[1] if len(a) > 1 else None
        sub.full_clean()
        sub.save()
        return None
    if name == "buyMinutes":
        raise ValidationError(
            "Пакет минут подключает суперадминистратор после оплаты счёта."
        )
    if name == "markNotificationsRead":
        qs = m.Notification.objects.filter(company=c.company).filter(
            Q(user=c.user) | Q(user=None)
        )
        if a and a[0]:
            qs = qs.filter(pk__in=a[0])
        qs.update(read_at=timezone.now())
        return None
    if name == "setNotificationPref":
        if str(c.user.pk) != a[0]:
            raise PermissionDenied()
        p, _ = m.Preference.objects.get_or_create(
            company=c.company, user=c.user, kind=a[1]
        )
        ch = serializers.ChoiceField(
            choices=["app", "email", "telegram", "push"]
        ).run_validation(a[2])
        p.channels = list(
            (set(p.channels) | {ch}) if a[3] else (set(p.channels) - {ch})
        )
        p.save()
        return None
    if name in ["rateCall", "markCallback"]:
        s.demand(c, "ops")
        call = s.obj(c, m.Call, a[0])
        if name == "rateCall":
            call.rating = serializers.ChoiceField(choices=[-1, 1]).run_validation(a[1])
            call.rating_reason = (
                serializers.CharField(min_length=2, max_length=200).run_validation(a[2])
                if call.rating == -1
                else ""
            )
        else:
            call.callback_done_at = timezone.now()
        call.save()
        return None
    if name == "createAppointment":
        return serialize(s.book(c, a[0]))
    if name == "moveAppointment":
        return serialize(s.book(c, a[1], a[0]))
    if name == "setAppointmentStatus":
        s.demand(c, "ops")
        appt = s.obj(c, m.Appointment, a[0], True)
        state = serializers.ChoiceField(
            choices=["booked", "cancelled", "done", "no_show"]
        ).run_validation(a[1])
        if appt.status in ["cancelled", "done", "no_show"] and state == "booked":
            raise ValidationError("Создайте новую запись.")
        appt.status = state
        appt.save()
        return serialize(appt)
    if name == "addToWaitlist":
        s.demand(c, "ops")
        data = a[0]
        m.Company.objects.select_for_update().get(pk=c.company.pk)
        pos = (
            m.Waitlist.objects.filter(company=c.company, scope=data["scope"]).aggregate(
                n=Max("position")
            )["n"]
            or 0
        ) + 1
        w = s.save(c, m.Waitlist, {**data, "position": pos})
        s.offer_next(c.company, w.scope)
        return serialize(w)
    if name == "offerToNext":
        s.demand(c, "ops")
        if not s.offer_next(c.company, a[0]):
            raise ValidationError("Нет свободных талонов или ожидающих.")
        return None
    if name == "cancelTicket":
        s.demand(c, "ops")
        t = s.obj(c, m.Ticket, a[0], True)
        if t.status not in ["taken", "offered"]:
            raise ValidationError("Талон не занят.")
        m.Waitlist.objects.filter(company=c.company, ticket=t, status="offered").update(
            status="expired"
        )
        t.status = "open"
        t.contact_name = ""
        t.contact_phone = ""
        t.save()
        s.offer_next(c.company, t.specialty)
        return serialize(t)
    if name == "resolveOffer":
        s.demand(c, "ops")
        w = s.obj(c, m.Waitlist, a[0], True)
        if w.status != "offered" or not w.expires_at or w.expires_at <= timezone.now():
            raise ValidationError("Предложение истекло.")
        w.status = "accepted" if a[1] else "removed"
        w.save()
        if w.ticket:
            w.ticket.status = "taken" if a[1] else "open"
            w.ticket.save()
        if not a[1]:
            s.offer_next(c.company, w.scope)
        return None
    if name in [
        "takeChat",
        "returnToAi",
        "setDraftMode",
        "closeChat",
        "markRead",
        "sendMessage",
        "approveDraft",
        "createLeadFromChat",
    ]:
        return chat_command(c, name, a)
    if name == "simulateClientMessage":
        s.demand(c, "ops")
        data = a[0]
        conv = (
            s.obj(c, m.Conversation, data["conversationId"], True)
            if data.get("conversationId")
            else m.Conversation.objects.create(
                company=c.company, channel=data["channel"], assignee=c.user
            )
        )
        text = serializers.CharField(min_length=1, max_length=1000).run_validation(
            data["body"]
        )
        receive(c, conv, text)
        return serialize(conv)
    if name == "requestExport":
        s.demand(c, "owner")
        s.audit(c, "data.export", c.company.pk)
        return {"url": "/api/backend-export"}
    raise ValidationError(
        "Функция требует внешнего провайдера или относится к следующей фазе MVP."
    )


def receive(c, conv, text):
    m.Message.objects.create(
        company=c.company,
        conversation=conv,
        direction="in",
        author="client",
        body=text,
        status="delivered",
    )
    conv.last_message = text
    conv.last_message_at = timezone.now()
    conv.unread += 1
    conv.window_expires_at = timezone.now() + timedelta(hours=24)
    if conv.state == "closed":
        conv.state = "ai"
    conv.save()
    # Without a configured model route to a human rather than fabricating a response.
    if conv.state in ["ai", "draft"]:
        conv.needs_human = True
        conv.save(update_fields=["needs_human"])
    return conv


def chat_command(c, name, a):
    s.demand(c, "ops")
    conv = s.obj(c, m.Conversation, a[0], True)
    if name == "markRead":
        conv.unread = 0
    elif name == "takeChat":
        conv.state = "operator"
        conv.assignee = c.user
        conv.needs_human = False
        conv.messages.filter(status="draft").delete()
    elif name == "returnToAi":
        conv.state = "ai"
        conv.assignee = None
    elif name == "setDraftMode":
        conv.state = "draft" if a[1] else "ai"
    elif name == "closeChat":
        conv.state = "closed"
        conv.unread = 0
        conv.needs_human = False
    elif name == "createLeadFromChat":
        return serialize(
            s.new_lead(
                c,
                dict(
                    title=a[1],
                    type="booking",
                    contactId=str(conv.contact_id) if conv.contact else None,
                    channel=conv.channel,
                ),
                source="chat",
                source_id=conv.pk,
            )
        )
    elif name in ["sendMessage", "approveDraft"]:
        if conv.channel in ["whatsapp", "instagram", "facebook"] and (
            not conv.window_expires_at or conv.window_expires_at <= timezone.now()
        ):
            raise ValidationError(
                "24-часовое окно закрыто. Подключите одобренные шаблоны провайдера."
            )
        if name == "approveDraft":
            msg = conv.messages.filter(pk=a[1], status="draft").first()
            if not msg:
                raise NotFound("Черновик не найден.")
            text = a[2] if len(a) > 2 and a[2] else msg.body
            msg.delete()
        else:
            text = a[1]["body"]
        text = serializers.CharField(min_length=1, max_length=4000).run_validation(text)
        if conv.channel != "widget":
            raise ValidationError("Отправка недоступна: провайдер канала не настроен.")
        msg = m.Message.objects.create(
            company=c.company,
            conversation=conv,
            direction="out",
            author="operator",
            author_id=str(c.user.pk),
            body=text,
            status="sent",
        )
        conv.state = "operator"
        conv.assignee = c.user
        conv.needs_human = False
        conv.unread = 0
        conv.last_message = text
        conv.last_message_at = timezone.now()
        conv.save()
        return serialize(msg)
    conv.save()
    return serialize(conv)


# Resource-oriented API for operators, integrations and OpenAPI clients.
RESOURCES = {
    "contacts": (m.Contact, "ops", []),
    "leads": (m.Lead, "ops", ["number", "source", "source_id", "closed_at"]),
    "branches": (m.Branch, "owner", []),
    "services": (m.Service, "kb", []),
    "staff": (m.Staff, "kb", []),
    "faq": (m.Faq, "kb", []),
    "resources": (m.Resource, "owner", []),
    "tickets": (m.Ticket, "ops", []),
    "invoices": (m.Invoice, "billing", ["status"]),
    "calls": (
        m.Call,
        "ops",
        [
            "caller",
            "started_at",
            "duration_s",
            "billed_seconds",
            "kb_version",
            "turns",
            "tool_calls",
            "external_id",
        ],
    ),
}


def make_viewset(model, access, readonly):
    class ResourceViewSet(viewsets.ModelViewSet):
        serializer_class = serializer_for(model, readonly)
        queryset = model.objects.none()
        lookup_value_converter = "uuid"
        http_method_names = ["get", "post", "patch", "delete", "head", "options"]

        def get_queryset(self):
            if getattr(self, "swagger_fake_view", False):
                return model.objects.none()
            c = context(self.request)
            s.demand(c, access)
            return s.rows(c, model).order_by("-created_at")

        def get_serializer_context(self):
            return {**super().get_serializer_context(), "company": self.request.company}

        @transaction.atomic
        def create(self, request, *args, **kwargs):
            c = context(request)
            s.demand(c, access)
            if model is m.Call:
                raise PermissionDenied(
                    "Звонки создаются подписанным событием телефонии."
                )
            if model is m.Invoice:
                raise PermissionDenied("Счета создаёт платформа.")
            if model is m.Lead:
                return Response(serialize(s.new_lead(c, request.data)), status=201)
            return super().create(request, *args, **kwargs)

        def perform_create(self, serializer):
            instance = serializer.save(company=self.request.company)
            s.audit(self.request, "create", instance.pk)

        @transaction.atomic
        def partial_update(self, request, *args, **kwargs):
            if model is m.Lead:
                c = context(request)
                return Response(serialize(s.update_lead(c, kwargs["pk"], request.data)))
            return super().partial_update(request, *args, **kwargs)

        def perform_update(self, serializer):
            instance = serializer.save()
            s.audit(self.request, "update", instance.pk)

        def perform_destroy(self, instance):
            s.demand(self.request, "owner")
            if model in [m.Call, m.Invoice]:
                raise PermissionDenied("Удаление запрещено.")
            s.audit(self.request, "delete", instance.pk)
            instance.delete()

    ResourceViewSet.__name__ = model.__name__ + "ViewSet"
    return ResourceViewSet


@extend_schema(responses=OpenApiTypes.OBJECT)
class HealthView(APIView):
    permission_classes = [AllowAny]
    authentication_classes = []

    def get(self, request):
        from django.db import connection

        with connection.cursor() as cursor:
            cursor.execute("SELECT 1")
        return Response({"status": "ok", "providersConfigured": False})


@extend_schema(responses=OpenApiTypes.OBJECT)
class ExportView(APIView):
    def get(self, request):
        c = context(request)
        s.demand(c, "owner")
        s.audit(c, "data.export", c.company.pk)
        payload = {"company": serialize(c.company)}
        for key, model in [
            ("contacts", m.Contact),
            ("leads", m.Lead),
            ("calls", m.Call),
            ("conversations", m.Conversation),
            ("messages", m.Message),
            ("appointments", m.Appointment),
            ("waitlist", m.Waitlist),
            ("questionnaires", m.Questionnaire),
        ]:
            payload[key] = serialize(model.objects.filter(company=c.company), True)
        return Response(
            payload,
            headers={
                "Content-Disposition": 'attachment; filename="all-manager-export.json"'
            },
        )


@extend_schema(request=OpenApiTypes.OBJECT, responses=OpenApiTypes.OBJECT)
class ProviderEventView(APIView):
    """Normalized gateway boundary. Signature binds tenant, event ID and payload."""

    permission_classes = [AllowAny]
    authentication_classes = []

    @transaction.atomic
    def post(self, request):
        import hmac, time
        from django.conf import settings

        secret = settings.WEBHOOK_SECRET
        if not secret:
            return Response({"detail": "provider_not_configured"}, status=503)
        timestamp = request.headers.get("X-Webhook-Timestamp", "")
        signature = request.headers.get("X-Webhook-Signature", "")
        try:
            if abs(time.time() - int(timestamp)) > 300:
                raise ValueError()
        except ValueError:
            raise PermissionDenied("Неверная подпись.")
        raw = request._request.body
        expected = hmac.new(
            secret.encode(), timestamp.encode() + b"." + raw, hashlib.sha256
        ).hexdigest()
        if not hmac.compare_digest(signature, expected):
            raise PermissionDenied("Неверная подпись.")
        data = request.data
        try:
            uuid.UUID(str(data.get("companyId")))
        except ValueError:
            raise NotFound()
        set_tenant(data["companyId"])
        company = m.Company.objects.filter(pk=data.get("companyId")).first()
        if not company:
            raise NotFound()
        set_tenant(company.pk)
        event_id = serializers.CharField(min_length=1, max_length=180).run_validation(
            data.get("eventId")
        )
        job, created = m.Outbox.objects.get_or_create(
            company=company,
            idempotency_key=f"provider:{company.pk}:{event_id}",
            defaults={"kind": "provider_event", "status": "processed"},
        )
        if not created:
            return Response({"duplicate": True})
        kind = data.get("kind")
        if kind == "chat.inbound":
            channel = serializers.ChoiceField(
                choices=["widget", "telegram"]
            ).run_validation(data.get("channel"))
            external = serializers.CharField(
                min_length=1, max_length=200
            ).run_validation(data.get("externalId"))
            m.Company.objects.select_for_update().get(pk=company.pk)
            conv = (
                m.Conversation.objects.filter(
                    company=company, channel=channel, external_id=external
                )
                .exclude(state="closed")
                .order_by("-created_at")
                .first()
            )
            if not conv:
                conv = m.Conversation.objects.create(
                    company=company, channel=channel, external_id=external
                )
            text = serializers.CharField(min_length=1, max_length=4000).run_validation(
                data.get("body")
            )
            # Contacts merge across channels only using a verified E.164 from the gateway.
            if data.get("verifiedPhone"):
                contact, _ = m.Contact.objects.get_or_create(
                    company=company,
                    phone=phone(data["verifiedPhone"]),
                    defaults={"channels": [channel]},
                )
                conv.contact = contact
            receive(SimpleNamespace(company=company), conv, text)
            return Response({"conversationId": str(conv.pk)}, status=201)
        if kind == "call.ended":
            external = serializers.CharField(
                min_length=1, max_length=200
            ).run_validation(data.get("externalId"))
            duration = serializers.IntegerField(
                min_value=0, max_value=86400
            ).run_validation(data.get("durationS"))
            call, created = m.Call.objects.get_or_create(
                company=company,
                external_id=external,
                defaults={
                    "caller": phone(data.get("caller", "")),
                    "duration_s": duration,
                    "billed_seconds": ((duration + 14) // 15) * 15,
                    "ended_at": timezone.now(),
                    "started_at": timezone.now() - timedelta(seconds=duration),
                    "summary": str(data.get("summary", ""))[:5000],
                    "kb_version": data.get("kbVersion"),
                    "outcome": data.get("outcome", "no_result"),
                },
            )
            return Response(
                {"callId": str(call.pk), "duplicate": not created},
                status=201 if created else 200,
            )
        raise ValidationError("Неизвестный тип события.")


class InviteInput(serializers.Serializer):
    token = serializers.CharField(max_length=200)
    password = serializers.CharField(max_length=200, write_only=True)
    name = serializers.CharField(max_length=100)


@extend_schema(request=InviteInput, responses=OpenApiTypes.OBJECT)
class AcceptInvitationView(APIView):
    permission_classes = [AllowAny]
    authentication_classes = []

    @transaction.atomic
    def post(self, request):
        v = InviteInput(data=request.data)
        v.is_valid(raise_exception=True)
        data = v.validated_data
        try:
            company_id, token = data["token"].split(".", 1)
            uuid.UUID(company_id)
        except ValueError:
            raise NotFound()
        set_tenant(company_id)
        inv = (
            m.Invitation.objects.select_for_update()
            .filter(
                company_id=company_id,
                token_hash=digest(token),
                accepted_at=None,
                expires_at__gt=timezone.now(),
            )
            .first()
        )
        if not inv:
            raise NotFound("Приглашение истекло или уже использовано.")
        U = get_user_model()
        if U.objects.filter(username=inv.email).exists():
            raise ValidationError(
                "У вас уже есть аккаунт. Войдите и попросите собственника добавить членство через администратора."
            )
        from django.contrib.auth.password_validation import validate_password
        from django.core.exceptions import ValidationError as DjangoValidationError

        user = U(username=inv.email, email=inv.email, first_name=data["name"])
        try:
            validate_password(data["password"], user)
        except DjangoValidationError as exc:
            raise ValidationError({"detail": " ".join(exc.messages)})
        user.set_password(data["password"])
        user.save()
        m.Membership.objects.create(company_id=company_id, user=user, role=inv.role)
        inv.accepted_at = timezone.now()
        inv.save()
        m.Audit.objects.create(
            company_id=company_id,
            actor_name=inv.email,
            action="team.accept_invite",
            entity=str(inv.pk),
        )
        return Response({"next": "/login"}, status=201)


@extend_schema(responses=OpenApiTypes.OBJECT)
class EventsView(APIView):
    def get(self, request):
        c = context(request)
        qs = m.RealtimeEvent.objects.filter(company=c.company)
        if "after" not in request.query_params:
            return Response(
                {"cursor": qs.aggregate(n=Max("id"))["n"] or 0, "events": []}
            )
        try:
            after = int(request.query_params["after"])
        except ValueError:
            raise ValidationError("Неверный курсор.")
        events = list(qs.filter(id__gt=after).order_by("id")[:100])
        visible = []
        for event in events:
            payload = event.payload
            kind = payload.get("type", "")
            if c.member.role == "accountant" and kind != "notification":
                continue
            if c.member.role == "staff":
                entity = (
                    payload.get("lead")
                    or payload.get("conversation")
                    or payload.get("call")
                )
                if entity and entity.get("assigneeId") != str(c.user.pk):
                    continue
                # Notifications are rechecked against their actual recipient.
                if kind == "message.created" and payload.get("conversation", {}).get(
                    "assigneeId"
                ) != str(c.user.pk):
                    continue
            if kind == "notification":
                if (
                    not m.Notification.objects.filter(
                        company=c.company, pk=payload["notification"]["id"]
                    )
                    .filter(Q(user=None) | Q(user=c.user))
                    .exists()
                ):
                    continue
            visible.append(payload)
        return Response(
            {"cursor": events[-1].id if events else after, "events": visible}
        )
