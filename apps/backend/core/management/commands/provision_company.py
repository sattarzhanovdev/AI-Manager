import os, secrets
from datetime import timedelta
from django.core.management.base import BaseCommand, CommandError
from django.contrib.auth import get_user_model
from django.db import transaction
from django.utils import timezone
from core import models as m
from core.middleware import set_tenant
from core.services import DEFAULT_PLAN


class Command(BaseCommand):
    help = "Create a company and owner/staff account. Password comes from PROVISION_PASSWORD or is generated once."

    def add_arguments(self, p):
        p.add_argument("--email", required=True)
        p.add_argument("--name", default="Компания")
        p.add_argument("--company-id")
        p.add_argument(
            "--role", choices=["owner", "admin", "staff", "accountant"], default="owner"
        )
        p.add_argument("--sphere", default="other")

    @transaction.atomic
    def handle(self, *args, **o):
        email = o["email"].lower()
        if get_user_model().objects.filter(username=email).exists():
            raise CommandError(
                "Account already exists; use Django admin to change membership."
            )
        password = os.getenv("PROVISION_PASSWORD") or secrets.token_urlsafe(18)
        user = get_user_model().objects.create_user(
            username=email, email=email, password=password
        )
        company = (
            m.Company.objects.get(pk=o["company_id"])
            if o["company_id"]
            else m.Company.objects.create(name=o["name"], sphere=o["sphere"])
        )
        set_tenant(company.pk)
        m.Membership.objects.create(company=company, user=user, role=o["role"])
        m.Questionnaire.objects.get_or_create(
            company=company, status="draft", defaults={"version": 1}
        )
        m.Assistant.objects.get_or_create(company=company)
        if not o["company_id"]:
            m.Branch.objects.create(company=company, name="Основной филиал")
            m.Subscription.objects.create(
                company=company,
                plan=DEFAULT_PLAN,
                period_end=timezone.now() + timedelta(days=30),
            )
        self.stdout.write(f"Company: {company.pk}\nEmail: {email}")
        if not os.getenv("PROVISION_PASSWORD"):
            self.stdout.write(f"One-time generated password: {password}")
        self.stdout.write(
            "Owners must enrol TOTP on first login. This does not enable a real phone line."
        )
