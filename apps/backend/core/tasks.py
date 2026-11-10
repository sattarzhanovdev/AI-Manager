from datetime import timedelta
from celery import shared_task
from django.conf import settings
from django.db import transaction
from django.utils import timezone
from . import models as m
from .middleware import set_tenant
from .services import offer_next


@shared_task
def expire_offers():
    # The dedicated allmanager_worker role can list companies; tenant data still requires set_tenant.
    for company in m.Company.objects.iterator():
        with transaction.atomic():
            set_tenant(company.pk)
            m.Ticket.objects.filter(
                company=company, status="closed", opens_at__lte=timezone.now()
            ).update(status="open")
            scopes = set()
            for w in m.Waitlist.objects.select_for_update().filter(
                company=company, status="offered", expires_at__lte=timezone.now()
            ):
                w.status = "expired"
                w.save(update_fields=["status"])
                scopes.add(w.scope)
                if w.ticket:
                    w.ticket.status = "open"
                    w.ticket.contact_name = ""
                    w.ticket.contact_phone = ""
                    w.ticket.save()
            for scope in scopes:
                offer_next(company, scope)


@shared_task
def deliver_outbox():
    for company in m.Company.objects.iterator():
        with transaction.atomic():
            set_tenant(company.pk)
            for job in m.Outbox.objects.select_for_update(skip_locked=True).filter(
                company=company,
                status__in=["pending", "retry", "unconfigured"],
                available_at__lte=timezone.now(),
            )[:100]:
                if job.kind != "email" or settings.EMAIL_BACKEND.endswith(
                    "locmem.EmailBackend"
                ):
                    job.status = "unconfigured"
                    job.last_error = "provider_not_configured"
                    job.available_at = timezone.now() + timedelta(minutes=5)
                    job.save()
                    continue
                try:
                    # Stable Message-ID permits provider-side de-duplication. SMTP is at-least-once.
                    from django.core.mail import EmailMessage

                    EmailMessage(
                        subject=job.payload["subject"],
                        body=job.payload["body"],
                        to=[job.payload["to"]],
                        headers={"Message-ID": f"<{job.id}@allmanager>"},
                    ).send(fail_silently=False)
                    job.status = "sent"
                    job.last_error = ""
                except Exception:
                    job.attempts += 1
                    job.status = "dead" if job.attempts >= 10 else "retry"
                    job.last_error = "delivery_failed"
                    job.available_at = timezone.now() + timedelta(
                        seconds=min(86400, 2**job.attempts * 5)
                    )
                job.save()
