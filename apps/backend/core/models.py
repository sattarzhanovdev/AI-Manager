import uuid
from django.conf import settings
from django.db import models
from django.db.models import Q, F
from django.utils import timezone


def choices(s):
    return [(x, x) for x in s.split()]


class UUIDModel(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    created_at = models.DateTimeField(default=timezone.now, editable=False)

    class Meta:
        abstract = True


class Company(UUIDModel):
    name = models.CharField(max_length=160)
    sphere = models.CharField(
        max_length=24,
        default="other",
        choices=choices("autoservice salon clinic dental service polyclinic other"),
    )
    timezone = models.CharField(max_length=64, default="Asia/Bishkek")
    currency = models.CharField(
        max_length=3, default="KGS", choices=choices("KGS KZT RUB USD")
    )
    ai_mode = models.CharField(
        max_length=20, default="off", choices=choices("on leads_only all_human off")
    )
    status = models.CharField(
        max_length=20,
        default="onboarding",
        choices=choices("onboarding moderation active suspended closed"),
    )
    next_lead_number = models.PositiveIntegerField(default=1)


class TenantModel(UUIDModel):
    company = models.ForeignKey(Company, on_delete=models.CASCADE)

    class Meta:
        abstract = True
        indexes = [models.Index(fields=["company", "created_at"])]


class Membership(TenantModel):
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE)
    role = models.CharField(
        max_length=20, choices=choices("owner admin staff accountant")
    )
    permissions = models.JSONField(default=dict)
    branch_ids = models.JSONField(default=list)
    transfer_phone = models.CharField(max_length=20, blank=True)
    disabled_at = models.DateTimeField(null=True, blank=True)

    class Meta(TenantModel.Meta):
        constraints = [
            models.UniqueConstraint(
                fields=["company", "user"], name="unique_membership"
            )
        ]


class AccessSession(UUIDModel):
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE)
    token_hash = models.CharField(max_length=64, unique=True)
    expires_at = models.DateTimeField()
    revoked_at = models.DateTimeField(null=True)
    mfa_verified = models.BooleanField(default=False)


class MFADevice(models.Model):
    user = models.OneToOneField(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, primary_key=True
    )
    encrypted_secret = models.TextField()
    confirmed = models.BooleanField(default=False)
    last_counter = models.BigIntegerField(default=-1)


class Branch(TenantModel):
    name = models.CharField(max_length=160)
    address = models.CharField(max_length=500, blank=True)
    landmarks = models.CharField(max_length=500, blank=True)
    hours = models.JSONField(default=dict)
    phones = models.JSONField(default=list)


class Contact(TenantModel):
    phone = models.CharField(max_length=20, null=True, blank=True)
    name = models.CharField(max_length=100, blank=True)
    channels = models.JSONField(default=list)
    tags = models.JSONField(default=list)
    notes = models.TextField(blank=True)
    last_seen_at = models.DateTimeField(default=timezone.now)
    interactions_count = models.PositiveIntegerField(default=0)

    class Meta(TenantModel.Meta):
        constraints = [
            models.UniqueConstraint(
                fields=["company", "phone"],
                condition=Q(phone__isnull=False),
                name="contact_phone_company",
            )
        ]


class Lead(TenantModel):
    number = models.PositiveIntegerField()
    source = models.CharField(
        max_length=10, default="manual", choices=choices("manual chat call demo")
    )
    source_id = models.UUIDField(null=True, blank=True)
    channel = models.CharField(max_length=24, blank=True)
    type = models.CharField(
        max_length=24,
        choices=choices(
            "booking consultation order complaint reschedule callback other"
        ),
    )
    title = models.CharField(max_length=200)
    status = models.CharField(
        max_length=20,
        default="new",
        choices=choices("new in_progress waiting won lost"),
    )
    priority = models.CharField(
        max_length=10, default="normal", choices=choices("normal urgent")
    )
    tags = models.JSONField(default=list)
    contact = models.ForeignKey(
        Contact, null=True, blank=True, on_delete=models.SET_NULL
    )
    assignee = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL
    )
    branch = models.ForeignKey(Branch, null=True, blank=True, on_delete=models.SET_NULL)
    due_at = models.DateTimeField(null=True, blank=True)
    closed_at = models.DateTimeField(null=True, blank=True)
    lost_reason = models.CharField(max_length=300, blank=True)
    payload = models.JSONField(default=dict)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta(TenantModel.Meta):
        constraints = [
            models.UniqueConstraint(
                fields=["company", "number"], name="lead_number_company"
            )
        ]


class LeadEvent(TenantModel):
    lead = models.ForeignKey(Lead, on_delete=models.CASCADE, related_name="events")
    actor = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, on_delete=models.SET_NULL
    )
    actor_kind = models.CharField(max_length=10, default="user")
    action = models.CharField(max_length=20)
    comment = models.TextField(blank=True)
    before = models.JSONField(null=True)
    after = models.JSONField(null=True)


class Service(TenantModel):
    name = models.CharField(max_length=120)
    synonyms = models.JSONField(default=list)
    description = models.TextField(blank=True)
    price_type = models.CharField(
        max_length=24, choices=choices("exact range after_inspection")
    )
    price_min = models.PositiveBigIntegerField(null=True, blank=True)
    price_max = models.PositiveBigIntegerField(null=True, blank=True)
    currency = models.CharField(max_length=3, default="KGS")
    duration_min = models.PositiveIntegerField(null=True, blank=True)
    staff_ids = models.JSONField(default=list)
    branch_ids = models.JSONField(default=list)
    active = models.BooleanField(default=True)

    class Meta(TenantModel.Meta):
        constraints = [
            models.CheckConstraint(
                condition=(
                    Q(
                        price_type="after_inspection",
                        price_min__isnull=True,
                        price_max__isnull=True,
                    )
                    | Q(
                        price_type="exact",
                        price_min__isnull=False,
                        price_max__isnull=True,
                    )
                    | Q(
                        price_type="range",
                        price_min__isnull=False,
                        price_max__isnull=False,
                        price_max__gte=F("price_min"),
                    )
                ),
                name="valid_service_price",
            )
        ]


class Staff(TenantModel):
    name = models.CharField(max_length=100)
    specialties = models.JSONField(default=list)
    service_ids = models.JSONField(default=list)
    branch = models.ForeignKey(Branch, null=True, blank=True, on_delete=models.SET_NULL)
    hours = models.JSONField(default=dict)
    languages = models.JSONField(default=list)
    transfer_phone = models.CharField(max_length=20, blank=True)
    bookable = models.BooleanField(default=True)


class Faq(TenantModel):
    question = models.CharField(max_length=500)
    synonyms = models.JSONField(default=list)
    short_answer = models.CharField(max_length=2000)
    long_answer = models.TextField(blank=True)
    source = models.CharField(max_length=200, default="manual")
    active = models.BooleanField(default=True)


class Questionnaire(TenantModel):
    version = models.PositiveIntegerField()
    status = models.CharField(max_length=12, default="draft")
    fields = models.JSONField(default=dict)
    snapshot = models.JSONField(default=dict)
    completeness = models.PositiveIntegerField(default=0)
    published_at = models.DateTimeField(null=True)

    class Meta(TenantModel.Meta):
        constraints = [
            models.UniqueConstraint(
                fields=["company", "version"], name="kb_version_company"
            ),
            models.UniqueConstraint(
                fields=["company"], condition=Q(status="draft"), name="one_kb_draft"
            ),
        ]


class Unanswered(TenantModel):
    text = models.CharField(max_length=1000)
    count = models.PositiveIntegerField(default=1)
    last_seen_at = models.DateTimeField(default=timezone.now)
    resolved = models.BooleanField(default=False)


class Assistant(TenantModel):
    settings = models.JSONField(default=dict)

    class Meta(TenantModel.Meta):
        constraints = [
            models.UniqueConstraint(fields=["company"], name="one_assistant")
        ]


class PhoneNumber(TenantModel):
    e164 = models.CharField(max_length=20, unique=True)
    branch = models.ForeignKey(Branch, null=True, on_delete=models.SET_NULL)
    kind = models.CharField(max_length=20, default="forwarding")
    receive = models.CharField(max_length=20, default="always")
    no_answer_seconds = models.PositiveIntegerField(default=20)
    lines = models.PositiveIntegerField(default=1)


class Call(TenantModel):
    number = models.ForeignKey(PhoneNumber, null=True, on_delete=models.SET_NULL)
    contact = models.ForeignKey(Contact, null=True, on_delete=models.SET_NULL)
    assignee = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, on_delete=models.SET_NULL
    )
    caller = models.CharField(max_length=20)
    started_at = models.DateTimeField(default=timezone.now)
    ended_at = models.DateTimeField(null=True)
    duration_s = models.PositiveIntegerField(default=0)
    billed_seconds = models.PositiveIntegerField(default=0)
    type = models.CharField(max_length=24, blank=True)
    outcome = models.CharField(max_length=20, default="no_result")
    summary = models.TextField(blank=True)
    rating = models.SmallIntegerField(null=True)
    rating_reason = models.CharField(max_length=200, blank=True)
    flags = models.JSONField(default=list)
    transferred = models.BooleanField(default=False)
    callback_done_at = models.DateTimeField(null=True)
    kb_version = models.PositiveIntegerField(null=True)
    prompt_version = models.PositiveIntegerField(default=1)
    tariff_version = models.PositiveIntegerField(default=1)
    cost_minor = models.PositiveBigIntegerField(default=0)
    turns = models.JSONField(default=list)
    tool_calls = models.JSONField(default=list)
    external_id = models.CharField(max_length=200, null=True)

    class Meta(TenantModel.Meta):
        constraints = [
            models.UniqueConstraint(
                fields=["company", "external_id"], name="call_external_company"
            )
        ]


class Conversation(TenantModel):
    contact = models.ForeignKey(Contact, null=True, on_delete=models.SET_NULL)
    channel = models.CharField(
        max_length=20,
        default="widget",
        choices=choices("widget telegram whatsapp instagram facebook"),
    )
    external_id = models.CharField(max_length=200, blank=True)
    state = models.CharField(
        max_length=12, default="ai", choices=choices("ai draft operator closed")
    )
    assignee = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, on_delete=models.SET_NULL
    )
    window_expires_at = models.DateTimeField(null=True)
    last_message_at = models.DateTimeField(default=timezone.now)
    last_message = models.TextField(blank=True)
    unread = models.PositiveIntegerField(default=0)
    needs_human = models.BooleanField(default=False)
    tags = models.JSONField(default=list)
    dialog_state = models.JSONField(default=dict)


class Message(TenantModel):
    conversation = models.ForeignKey(
        Conversation, on_delete=models.CASCADE, related_name="messages"
    )
    direction = models.CharField(max_length=3)
    author = models.CharField(max_length=12)
    author_id = models.CharField(max_length=40, blank=True)
    body = models.TextField(blank=True)
    attachments = models.JSONField(default=list)
    transcript = models.TextField(blank=True)
    status = models.CharField(max_length=12, default="queued")
    external_id = models.CharField(max_length=200, null=True)

    class Meta(TenantModel.Meta):
        constraints = [
            models.UniqueConstraint(
                fields=["company", "external_id"], name="message_external_company"
            )
        ]


class Resource(TenantModel):
    name = models.CharField(max_length=100)
    kind = models.CharField(max_length=20, default="staff")
    branch = models.ForeignKey(Branch, null=True, blank=True, on_delete=models.SET_NULL)
    staff = models.ForeignKey(Staff, null=True, blank=True, on_delete=models.SET_NULL)


class Appointment(TenantModel):
    resource = models.ForeignKey(Resource, on_delete=models.PROTECT)
    service = models.ForeignKey(
        Service, null=True, blank=True, on_delete=models.SET_NULL
    )
    contact = models.ForeignKey(
        Contact, null=True, blank=True, on_delete=models.SET_NULL
    )
    starts_at = models.DateTimeField()
    ends_at = models.DateTimeField()
    status = models.CharField(
        max_length=12,
        default="booked",
        choices=choices("held booked cancelled done no_show blocked"),
    )
    created_by_ai = models.BooleanField(default=False)
    lead = models.ForeignKey(Lead, null=True, blank=True, on_delete=models.SET_NULL)
    note = models.CharField(max_length=500, blank=True)

    class Meta(TenantModel.Meta):
        constraints = [
            models.CheckConstraint(
                condition=Q(ends_at__gt=F("starts_at")),
                name="positive_appointment_duration",
            )
        ]
        indexes = TenantModel.Meta.indexes + [
            models.Index(fields=["company", "resource", "starts_at"])
        ]


class Ticket(TenantModel):
    doctor = models.CharField(max_length=100)
    specialty = models.CharField(max_length=100)
    starts_at = models.DateTimeField()
    opens_at = models.DateTimeField()
    status = models.CharField(
        max_length=12,
        default="closed",
        choices=choices("closed open offered taken cancelled"),
    )
    contact_name = models.CharField(max_length=100, blank=True)
    contact_phone = models.CharField(max_length=20, blank=True)


class Waitlist(TenantModel):
    scope = models.CharField(max_length=100)
    contact_name = models.CharField(max_length=100)
    contact_phone = models.CharField(max_length=20)
    position = models.PositiveIntegerField()
    status = models.CharField(max_length=12, default="waiting")
    ticket = models.ForeignKey(Ticket, null=True, on_delete=models.SET_NULL)
    offered_at = models.DateTimeField(null=True)
    expires_at = models.DateTimeField(null=True)

    class Meta(TenantModel.Meta):
        constraints = [
            models.UniqueConstraint(
                fields=["company", "scope", "contact_phone"],
                condition=Q(status__in=["waiting", "offered"]),
                name="unique_active_waitlist",
            )
        ]


class Subscription(TenantModel):
    plan = models.JSONField(default=dict)
    period_start = models.DateTimeField(default=timezone.now)
    period_end = models.DateTimeField()
    minutes_total = models.PositiveIntegerField(default=0)
    dialogs_total = models.PositiveIntegerField(default=0)
    lines_total = models.PositiveIntegerField(default=1)
    overage_policy = models.CharField(max_length=12, default="stop_ai")
    overage_cap_minor = models.PositiveBigIntegerField(null=True)
    paid = models.BooleanField(default=False)


class Invoice(TenantModel):
    number = models.CharField(max_length=40)
    period_start = models.DateTimeField()
    period_end = models.DateTimeField()
    amount_minor = models.PositiveBigIntegerField()
    currency = models.CharField(max_length=3, default="KGS")
    status = models.CharField(
        max_length=12,
        default="issued",
        choices=choices("draft issued paid overdue void"),
    )


class Notification(TenantModel):
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, on_delete=models.CASCADE
    )
    kind = models.CharField(max_length=30)
    title = models.CharField(max_length=200)
    body = models.TextField(blank=True)
    href = models.CharField(max_length=300, blank=True)
    read_at = models.DateTimeField(null=True)


class Audit(TenantModel):
    actor_name = models.CharField(max_length=150)
    action = models.CharField(max_length=50)
    entity = models.CharField(max_length=100)
    detail = models.TextField(blank=True)
    before = models.JSONField(null=True)
    after = models.JSONField(null=True)
    ip = models.GenericIPAddressField(null=True)


class Outbox(TenantModel):
    kind = models.CharField(max_length=30)
    payload = models.JSONField(default=dict)
    status = models.CharField(max_length=12, default="pending")
    attempts = models.PositiveIntegerField(default=0)
    available_at = models.DateTimeField(default=timezone.now)
    last_error = models.CharField(max_length=100, blank=True)
    idempotency_key = models.CharField(max_length=200, unique=True)


class Preference(TenantModel):
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE)
    kind = models.CharField(max_length=30)
    channels = models.JSONField(default=list)

    class Meta(TenantModel.Meta):
        constraints = [
            models.UniqueConstraint(
                fields=["company", "user", "kind"], name="preference_unique"
            )
        ]


class Integration(TenantModel):
    key = models.CharField(max_length=40)
    group = models.CharField(max_length=20, default="channels")
    status = models.CharField(max_length=20, default="not_connected")
    errors24h = models.PositiveIntegerField(default=0)
    phase = models.CharField(max_length=3, default="1b")


class Moderation(TenantModel):
    status = models.CharField(max_length=20, default="queued")
    reason = models.TextField(blank=True)
    decided_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, on_delete=models.SET_NULL
    )


class Invitation(TenantModel):
    email = models.EmailField()
    role = models.CharField(max_length=20, choices=choices("admin staff accountant"))
    token_hash = models.CharField(max_length=64, unique=True)
    expires_at = models.DateTimeField()
    accepted_at = models.DateTimeField(null=True)


class RealtimeEvent(models.Model):
    id = models.BigAutoField(primary_key=True)
    company = models.ForeignKey(Company, on_delete=models.CASCADE)
    created_at = models.DateTimeField(default=timezone.now)
    payload = models.JSONField(default=dict)

    class Meta:
        indexes = [models.Index(fields=["company", "id"])]
