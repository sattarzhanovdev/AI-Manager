import os
from django.conf import settings
from django.core.management.base import BaseCommand, CommandError
from django.contrib.auth import get_user_model
from django.db import transaction
from core import models as m
from core.services import BLOCKS, publish
from core.middleware import set_tenant
from types import SimpleNamespace


class Command(BaseCommand):
    help = "Create explicitly labelled LOCAL demo data. Disabled unless DJANGO_DEBUG=1."

    def add_arguments(self, p):
        p.add_argument("--email", default="demo.owner@example.com")

    @transaction.atomic
    def handle(self, *args, **opts):
        if not settings.DEBUG:
            raise CommandError("Demo seed is disabled outside DEBUG.")
        password = os.getenv("PROVISION_PASSWORD")
        if not password:
            raise CommandError("Set PROVISION_PASSWORD for the local demo account.")
        u, created = get_user_model().objects.get_or_create(
            username=opts["email"],
            defaults={
                "email": opts["email"],
                "first_name": "Демо",
                "last_name": "Собственник",
            },
        )
        u.set_password(password)
        u.save()
        member = m.Membership.objects.filter(user=u, disabled_at=None).first()
        if member:
            self.stdout.write(
                "Existing company retained. Password updated; data not overwritten."
            )
            return
        c = m.Company.objects.create(
            name="Демо: автосервис «Мотор»", sphere="autoservice"
        )
        set_tenant(c.pk)
        member = m.Membership.objects.create(company=c, user=u, role="owner")
        fields = {
            f["key"]: ["Пример"] if f["kind"] in ["list", "phones"] else "Пример"
            for b in BLOCKS
            for f in b["fields"]
        }
        hours = {
            day: [["09:00", "19:00"]]
            for day in ["mon", "tue", "wed", "thu", "fri", "sat"]
        }
        fields.update(
            {
                "company.name": c.name,
                "company.name_stress": "мОтор",
                "company.sphere": "autoservice",
                "company.description": "Демонстрационная компания, ремонт и обслуживание авто.",
                "branch.address": "Бишкек, Ахунбаева 120",
                "branch.hours": hours,
                "branch.phones": ["+996555000000"],
                "style.greeting": "Здравствуйте! Автосервис «Мотор», я AI-ассистент. Звонок записывается.",
                "style.languages": ["ru", "ky"],
                "handoff.how": "callback",
                "stop.reply": "Это уточнит администратор.",
                "stop.never_promise": [
                    "Гарантированное лечение",
                    "Точную стоимость после осмотра",
                ],
                "stop.topics": ["Политика", "Медицинские рекомендации"],
            }
        )
        m.Questionnaire.objects.create(company=c, version=1, fields=fields)
        branch = m.Branch.objects.create(
            company=c,
            name="Основной филиал",
            address=fields["branch.address"],
            hours=hours,
            phones=fields["branch.phones"],
        )
        m.Resource.objects.create(company=c, name="Мастер Азамат", branch=branch)
        for name, amount in [
            ("Замена масла", 150000),
            ("Диагностика", 200000),
            ("Замена колодок", 250000),
            ("Шиномонтаж", 120000),
            ("Замена фильтра", 50000),
        ]:
            m.Service.objects.create(
                company=c,
                name=name,
                price_type="exact",
                price_min=amount,
                duration_min=60,
                synonyms=["поменять масло"] if name == "Замена масла" else [],
            )
        for i in range(10):
            m.Faq.objects.create(
                company=c,
                question=f"Демонстрационный вопрос {i + 1}",
                short_answer="Подробности уточнит администратор.",
            )
        ctx = SimpleNamespace(company=c, member=member, user=u, META={})
        publish(ctx)
        m.Assistant.objects.get_or_create(company=c)
        self.stdout.write(
            "Local demo ready. First owner login enrols TOTP. Real phone line stays off."
        )
