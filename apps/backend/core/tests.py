from datetime import timedelta
from django.contrib.auth import get_user_model
from django.db import IntegrityError, connection, transaction
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient
from . import models as m
from .auth import issue_session
from .services import BLOCKS
import pyotp


class BusinessAPITests(TestCase):
    def setUp(self):
        U = get_user_model()
        self.owner = U.objects.create_user(
            username="owner@example.com",
            email="owner@example.com",
            password="Strong-pass-9238",
        )
        self.staff = U.objects.create_user(
            username="staff@example.com",
            email="staff@example.com",
            password="Strong-pass-9238",
        )
        self.accountant = U.objects.create_user(
            username="bill@example.com",
            email="bill@example.com",
            password="Strong-pass-9238",
        )
        self.a = m.Company.objects.create(name="A")
        self.b = m.Company.objects.create(name="B")
        self.member = m.Membership.objects.create(
            company=self.a, user=self.owner, role="owner"
        )
        m.Membership.objects.create(company=self.a, user=self.staff, role="staff")
        m.Membership.objects.create(
            company=self.a, user=self.accountant, role="accountant"
        )
        self.client = APIClient()
        self.login(self.owner)
        self.foreign = m.Contact.objects.create(
            company=self.b, phone="+996555000002", name="Secret"
        )
        self.resource = m.Resource.objects.create(company=self.a, name="Врач")
        self.other_resource = m.Resource.objects.create(
            company=self.b, name="Другой врач"
        )

    def login(self, user):
        self.client.credentials(
            HTTP_AUTHORIZATION="Bearer " + issue_session(user, True)
        )

    def cmd(self, name, *args):
        return self.client.post(
            "/api/v1/commands/" + name + "/", {"args": list(args)}, format="json"
        )

    def read(self, name, **params):
        return self.client.get("/api/v1/read/" + name + "/", params)

    def complete_kb(self):
        fields = {
            f["key"]: ["test"] if f["kind"] in ["list", "phones"] else "test"
            for b in BLOCKS
            for f in b["fields"]
        }
        fields.update(
            {
                "company.name": "Тест",
                "company.sphere": "clinic",
                "style.greeting": "Здравствуйте, я AI-ассистент, звонок записывается.",
            }
        )
        q = m.Questionnaire.objects.create(company=self.a, version=1, fields=fields)
        m.Service.objects.create(
            company=self.a, name="Приём", price_type="exact", price_min=10000
        )
        for i in range(10):
            m.Faq.objects.create(
                company=self.a, question=f"Вопрос {i}", short_answer="Ответ"
            )
        return q

    def test_authentication_required_and_revocation(self):
        self.client.credentials()
        self.assertEqual(self.read("getCompany").status_code, 401)
        token = issue_session(self.owner, True)
        self.client.credentials(HTTP_AUTHORIZATION="Bearer " + token)
        self.assertEqual(self.client.delete("/api/v1/auth/session/").status_code, 204)
        self.assertEqual(self.read("getCompany").status_code, 401)

    def test_cross_tenant_reads_are_404(self):
        for endpoint in ["getContact"]:
            self.assertEqual(
                self.read(endpoint, id=str(self.foreign.pk)).status_code, 404
            )
        self.assertEqual(
            self.client.get(f"/api/v1/contacts/{self.foreign.pk}/").status_code, 404
        )
        self.assertNotIn("Secret", str(self.read("listContacts").data))

    def test_selecting_foreign_company_is_404(self):
        self.client.credentials(
            HTTP_AUTHORIZATION="Bearer " + issue_session(self.owner, True),
            HTTP_X_COMPANY_ID=str(self.b.pk),
        )
        self.assertEqual(self.read("getCompany").status_code, 404)

    def test_cross_tenant_fk_rejected(self):
        r = self.client.post(
            "/api/v1/resources/",
            {
                "name": "Invalid",
                "branchId": str(
                    m.Branch.objects.create(company=self.b, name="Secret").pk
                ),
            },
            format="json",
        )
        self.assertEqual(r.status_code, 400)

    def test_staff_only_own_and_accountant_has_no_crm(self):
        lead = m.Lead.objects.create(
            company=self.a, number=1, type="other", title="Owned", assignee=self.owner
        )
        self.login(self.staff)
        self.assertEqual(self.read("listLeads").data, [])
        self.assertEqual(
            self.cmd("updateLead", str(lead.pk), {"status": "won"}).status_code, 404
        )
        self.login(self.accountant)
        self.assertEqual(self.read("listLeads").status_code, 403)
        self.assertEqual(self.cmd("updateAssistant", {"name": "hack"}).status_code, 403)

    def test_create_lead_deduplicates_contacts_and_logs(self):
        for i in range(2):
            r = self.cmd(
                "createLead",
                {
                    "title": "Запись к врачу",
                    "type": "booking",
                    "phone": "+996555123456",
                    "name": "Клиент",
                },
            )
            self.assertEqual(r.status_code, 200, r.data)
            self.assertEqual(r.data["number"], i + 1)
        self.assertEqual(m.Contact.objects.filter(company=self.a).count(), 1)
        self.assertEqual(m.Outbox.objects.filter(company=self.a).count(), 2)
        self.assertEqual(m.LeadEvent.objects.filter(company=self.a).count(), 2)
        self.assertEqual(self.read("getLead", id=r.data["id"]).status_code, 200)

    def test_phone_and_loss_validation(self):
        self.assertEqual(self.cmd("createContact", {"phone": "123"}).status_code, 400)
        lead = self.cmd(
            "createLead", {"title": "Заявка", "type": "other", "phone": "+996555123456"}
        ).data
        self.assertEqual(
            self.cmd("updateLead", lead["id"], {"status": "lost"}).status_code, 400
        )
        self.assertEqual(
            self.cmd(
                "updateLead", lead["id"], {"status": "lost", "lostReason": "Дорого"}
            ).status_code,
            200,
        )

    def test_staff_cannot_assign_to_another_user(self):
        self.login(self.staff)
        r = self.cmd(
            "createLead", {"title": "Запись", "type": "other", "phone": "+996555123456"}
        )
        self.assertEqual(
            self.cmd(
                "updateLead", r.data["id"], {"assigneeId": str(self.owner.pk)}
            ).status_code,
            403,
        )

    def test_price_after_inspection_has_no_numeric_price(self):
        r = self.cmd(
            "upsertServices",
            [{"name": "Осмотр", "priceType": "after_inspection", "priceMin": 100}],
        )
        self.assertEqual(r.status_code, 400)
        r = self.cmd(
            "upsertServices", [{"name": "Осмотр", "priceType": "after_inspection"}]
        )
        self.assertEqual(r.status_code, 200, r.data)
        self.assertIsNone(r.data[0]["priceMin"])

    def test_kb_publication_snapshot_is_immutable_and_rollback_versions(self):
        q = self.complete_kb()
        r = self.cmd("publishQuestionnaire")
        self.assertEqual(r.status_code, 200, r.data)
        self.assertEqual(r.data, 1)
        before = m.Questionnaire.objects.get(pk=q.pk).snapshot
        self.assertEqual(
            self.cmd("setField", "company.name", "Новое имя").status_code, 200
        )
        self.assertEqual(m.Questionnaire.objects.get(pk=q.pk).snapshot, before)
        self.assertEqual(self.cmd("publishQuestionnaire").data, 2)
        self.assertEqual(self.cmd("rollbackQuestionnaire", 1).data, 3)
        state = self.read("getQuestionnaire").data
        self.assertEqual(state["draft"]["version"], 4)
        self.assertEqual(state["fields"]["company.name"], "Тест")

    def test_incomplete_kb_cannot_publish_and_admin_cannot_publish(self):
        self.assertEqual(self.cmd("publishQuestionnaire").status_code, 400)
        self.member.role = "admin"
        self.member.save()
        self.assertEqual(self.cmd("publishQuestionnaire").status_code, 403)

    def test_ai_disclosure_and_activation_gate(self):
        self.assertEqual(
            self.cmd(
                "updateAssistant", {"greeting": "Я живой администратор"}
            ).status_code,
            400,
        )
        self.assertEqual(self.cmd("setAiMode", "on").status_code, 400)
        self.assertEqual(self.cmd("setAiMode", "off").status_code, 200)

    def test_appointments_reject_overlap_and_foreign_resource(self):
        start = (timezone.now() + timedelta(days=2)).replace(
            hour=10, minute=0, second=0, microsecond=0
        )
        data = dict(
            resourceId=str(self.resource.pk),
            startsAt=start.isoformat(),
            durationMin=60,
            contactPhone="+996555123456",
        )
        r = self.cmd("createAppointment", data)
        self.assertEqual(r.status_code, 200, r.data)
        self.assertEqual(self.cmd("createAppointment", data).status_code, 400)
        self.assertEqual(
            self.cmd(
                "createAppointment", {**data, "resourceId": str(self.other_resource.pk)}
            ).status_code,
            404,
        )
        self.assertEqual(
            self.cmd("setAppointmentStatus", r.data["id"], "cancelled").status_code, 200
        )
        self.assertEqual(self.cmd("createAppointment", data).status_code, 200)

    def test_waitlist_fifo_offer_expiry_and_accept(self):
        now = timezone.now()
        ticket = m.Ticket.objects.create(
            company=self.a,
            doctor="Врач",
            specialty="Терапевт",
            starts_at=now + timedelta(days=1),
            opens_at=now - timedelta(hours=1),
        )
        r = self.cmd(
            "addToWaitlist",
            {
                "scope": "Терапевт",
                "contactName": "Первый",
                "contactPhone": "+996555000010",
            },
        )
        self.assertEqual(r.status_code, 200, r.data)
        w = m.Waitlist.objects.get(company=self.a)
        self.assertEqual(w.status, "offered")
        self.cmd(
            "addToWaitlist",
            {
                "scope": "Терапевт",
                "contactName": "Второй",
                "contactPhone": "+996555000011",
            },
        )
        self.assertEqual(self.cmd("resolveOffer", str(w.pk), False).status_code, 200)
        nextw = m.Waitlist.objects.get(contact_name="Второй")
        self.assertEqual(nextw.status, "offered")
        self.assertEqual(self.cmd("resolveOffer", str(nextw.pk), True).status_code, 200)
        ticket.refresh_from_db()
        self.assertEqual(ticket.status, "taken")

    def test_waitlist_duplicates_rejected(self):
        data = {
            "scope": "Врач",
            "contactName": "Клиент",
            "contactPhone": "+996555000010",
        }
        self.assertEqual(self.cmd("addToWaitlist", data).status_code, 200)
        self.assertEqual(self.cmd("addToWaitlist", data).status_code, 409)

    def test_takeover_cancels_drafts_and_blocks_ai_commit(self):
        self.complete_kb()
        self.cmd("publishQuestionnaire")
        ctx = self.cmd("assistantContext", None).data
        conv = m.Conversation.objects.get(pk=ctx["conversationId"])
        m.Message.objects.create(
            company=self.a,
            conversation=conv,
            author="ai",
            direction="out",
            status="draft",
            body="Черновик",
        )
        self.assertEqual(self.cmd("takeChat", str(conv.pk)).status_code, 200)
        self.assertFalse(conv.messages.filter(status="draft").exists())
        self.assertEqual(
            self.cmd(
                "assistantCommit",
                {
                    "conversationId": str(conv.pk),
                    "revision": ctx["revision"],
                    "message": "test",
                    "reply": {},
                },
            ).status_code,
            400,
        )

    def test_chat_outside_meta_window_and_unconfigured_channel(self):
        conv = m.Conversation.objects.create(
            company=self.a,
            channel="whatsapp",
            window_expires_at=timezone.now() - timedelta(hours=1),
        )
        self.assertEqual(
            self.cmd(
                "sendMessage", str(conv.pk), {"body": "Ответ", "template": "fake"}
            ).status_code,
            400,
        )
        conv.window_expires_at = timezone.now() + timedelta(hours=1)
        conv.save()
        self.assertEqual(
            self.cmd("sendMessage", str(conv.pk), {"body": "Ответ"}).status_code, 400
        )
        self.assertEqual(conv.messages.count(), 0)

    def test_widget_message_saved_and_takes_over(self):
        conv = m.Conversation.objects.create(company=self.a)
        r = self.cmd("sendMessage", str(conv.pk), {"body": "Здравствуйте"})
        self.assertEqual(r.status_code, 200, r.data)
        self.assertEqual(r.data["status"], "sent")
        conv.refresh_from_db()
        self.assertEqual(conv.state, "operator")

    def test_minute_billing_rounding_and_usage(self):
        now = timezone.now()
        m.Subscription.objects.create(
            company=self.a,
            period_start=now - timedelta(days=1),
            period_end=now + timedelta(days=20),
            minutes_total=100,
        )
        m.Call.objects.create(
            company=self.a, caller="+996555123456", billed_seconds=15, ended_at=now
        )
        m.Call.objects.create(
            company=self.a, caller="+996555123456", billed_seconds=30, ended_at=now
        )
        self.assertEqual(self.read("getUsage").data["minutesUsed"], 0.75)

    def test_owner_mfa_enrolment_and_replay_rejection(self):
        self.client.credentials()
        r = self.client.post(
            "/api/v1/auth/login/",
            {"email": self.owner.email, "password": "Strong-pass-9238"},
            format="json",
        )
        self.assertEqual(r.status_code, 200)
        self.assertTrue(r.data["mfaRequired"])
        self.assertNotIn("token", r.data)
        otp = pyotp.TOTP(r.data["setupSecret"]).now()
        payload = {
            "email": self.owner.email,
            "password": "Strong-pass-9238",
            "otp": otp,
        }
        r = self.client.post("/api/v1/auth/login/", payload, format="json")
        self.assertIn("token", r.data)
        r = self.client.post("/api/v1/auth/login/", payload, format="json")
        self.assertEqual(r.status_code, 400)

    def test_disabling_members_revokes_sessions(self):
        member = m.Membership.objects.get(user=self.staff, company=self.a)
        token = issue_session(self.staff, True)
        self.assertEqual(
            self.cmd("disableMember", str(member.pk), None).status_code, 200
        )
        self.client.credentials(HTTP_AUTHORIZATION="Bearer " + token)
        self.assertEqual(self.read("getCompany").status_code, 401)

    def test_erase_contact_removes_transcript_and_messages(self):
        contact = m.Contact.objects.create(
            company=self.a, phone="+996555123456", name="Client"
        )
        call = m.Call.objects.create(
            company=self.a,
            contact=contact,
            caller=contact.phone,
            turns=[{"text": "PII"}],
            summary="PII",
        )
        conv = m.Conversation.objects.create(
            company=self.a, contact=contact, last_message="PII"
        )
        m.Message.objects.create(
            company=self.a,
            conversation=conv,
            direction="in",
            author="client",
            body="PII",
        )
        self.assertEqual(self.cmd("eraseContact", str(contact.pk)).status_code, 200)
        call.refresh_from_db()
        self.assertEqual(call.turns, [])
        self.assertEqual(call.summary, "")
        self.assertEqual(m.Message.objects.count(), 0)

    def test_analytics_and_overview_real_counts(self):
        self.cmd(
            "createLead", {"title": "Запись", "type": "other", "phone": "+996555123456"}
        )
        r = self.read("getOverview")
        self.assertEqual(r.status_code, 200, r.data)
        self.assertEqual(r.data["leadStats"]["total"], 1)
        self.assertEqual(self.read("getAnalytics").data["funnel"][2]["value"], 1)


from unittest import skipUnless


@skipUnless(
    connection.vendor == "postgresql", "PostgreSQL RLS and database constraints"
)
class PostgreSQLGuardTests(TestCase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        with connection.cursor() as c:
            c.execute(
                "DO $$ BEGIN IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='allmanager_rls_test') THEN CREATE ROLE allmanager_rls_test NOLOGIN NOSUPERUSER NOBYPASSRLS; END IF; END $$"
            )
            c.execute("GRANT USAGE ON SCHEMA public TO allmanager_rls_test")
            c.execute(
                "GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO allmanager_rls_test"
            )
            c.execute(
                "GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO allmanager_rls_test"
            )

    def test_rls_denies_reads_and_writes_without_matching_context(self):
        a = m.Company.objects.create(name="Tenant A")
        b = m.Company.objects.create(name="Tenant B")
        m.Contact.objects.create(company=a, phone="+996555000001")
        m.Contact.objects.create(company=b, phone="+996555000002")
        with connection.cursor() as c:
            c.execute("SET LOCAL ROLE allmanager_rls_test")
            c.execute("SELECT set_config('app.company_id','',true)")
            c.execute("SELECT count(*) FROM core_contact")
            self.assertEqual(c.fetchone()[0], 0)
            c.execute("SELECT count(*) FROM core_company")
            self.assertEqual(c.fetchone()[0], 0)
            c.execute("SELECT set_config('app.company_id',%s,true)", [str(a.pk)])
            c.execute("SELECT phone FROM core_contact")
            self.assertEqual(c.fetchall(), [("+996555000001",)])
            with self.assertRaises(Exception), transaction.atomic():
                c.execute("UPDATE core_contact SET company_id=%s", [str(b.pk)])
            c.execute("RESET ROLE")

    def test_published_kb_and_audit_are_immutable_in_database(self):
        company = m.Company.objects.create(name="A")
        q = m.Questionnaire.objects.create(
            company=company, version=1, status="published", fields={"name": "before"}
        )
        log = m.Audit.objects.create(
            company=company, actor_name="owner", action="test", entity="1"
        )
        with self.assertRaises(Exception), transaction.atomic():
            m.Questionnaire.objects.filter(pk=q.pk).update(fields={"name": "after"})
        with self.assertRaises(Exception), transaction.atomic():
            m.Audit.objects.filter(pk=log.pk).update(action="fake")
        with self.assertRaises(Exception), transaction.atomic():
            m.Audit.objects.filter(pk=log.pk).delete()

    def test_http_api_operates_with_non_bypass_role(self):
        company = m.Company.objects.create(name="Protected company")
        user = get_user_model().objects.create_user(username="runtime@example.com")
        m.Membership.objects.create(company=company, user=user, role="owner")
        client = APIClient()
        client.credentials(HTTP_AUTHORIZATION="Bearer " + issue_session(user, True))
        with connection.cursor() as cursor:
            cursor.execute("SET LOCAL ROLE allmanager_rls_test")
            try:
                response = client.get("/api/v1/read/getCompany/")
                self.assertEqual(response.status_code, 200, response.data)
                self.assertEqual(response.data["id"], str(company.pk))
            finally:
                cursor.execute("RESET ROLE")

    def test_db_exclusion_guards_direct_overlapping_inserts(self):
        company = m.Company.objects.create(name="A")
        resource = m.Resource.objects.create(company=company, name="Room")
        start = timezone.now()
        m.Appointment.objects.create(
            company=company,
            resource=resource,
            starts_at=start,
            ends_at=start + timedelta(hours=1),
        )
        with self.assertRaises(IntegrityError), transaction.atomic():
            m.Appointment.objects.create(
                company=company,
                resource=resource,
                starts_at=start + timedelta(minutes=30),
                ends_at=start + timedelta(hours=2),
            )


class ProviderAndInviteTests(TestCase):
    setUp = BusinessAPITests.setUp
    login = BusinessAPITests.login
    cmd = BusinessAPITests.cmd
    read = BusinessAPITests.read

    def test_invitation_is_one_time_and_does_not_send_fake_email(self):
        r = self.cmd(
            "inviteMember", {"contact": "new.staff@example.com", "role": "staff"}
        )
        self.assertEqual(r.status_code, 200, r.data)
        token = r.data["inviteUrl"].split("/invite/")[1]
        anonymous = APIClient()
        payload = {
            "token": token,
            "password": "Unique-pass-9128",
            "name": "Новый сотрудник",
        }
        r = anonymous.post("/api/v1/auth/accept-invite/", payload, format="json")
        self.assertEqual(r.status_code, 201, r.data)
        self.assertEqual(
            anonymous.post(
                "/api/v1/auth/accept-invite/", payload, format="json"
            ).status_code,
            404,
        )
        self.assertTrue(
            m.Membership.objects.filter(
                company=self.a, user__email="new.staff@example.com", role="staff"
            ).exists()
        )

    def test_provider_event_signature_idempotency_and_fifteen_second_rounding(self):
        import json, hmac, hashlib, time
        from django.test import override_settings

        data = {
            "companyId": str(self.a.pk),
            "eventId": "evt-1",
            "kind": "call.ended",
            "externalId": "call-1",
            "caller": "+996555123456",
            "durationS": 16,
        }
        raw = json.dumps(data).encode()
        ts = str(int(time.time()))
        sig = hmac.new(
            b"local-test-secret", ts.encode() + b"." + raw, hashlib.sha256
        ).hexdigest()
        with override_settings(WEBHOOK_SECRET="local-test-secret"):
            self.assertEqual(
                self.client.post(
                    "/api/v1/provider-events/", raw, content_type="application/json"
                ).status_code,
                403,
            )
            for expected in [201, 200]:
                r = self.client.post(
                    "/api/v1/provider-events/",
                    raw,
                    content_type="application/json",
                    HTTP_X_WEBHOOK_TIMESTAMP=ts,
                    HTTP_X_WEBHOOK_SIGNATURE=sig,
                )
                self.assertEqual(r.status_code, expected, r.data)
        self.assertEqual(m.Call.objects.filter(company=self.a).count(), 1)
        self.assertEqual(m.Call.objects.get(company=self.a).billed_seconds, 30)

    def test_events_do_not_leak_other_assignees_or_tenants(self):
        self.cmd(
            "createLead",
            {"title": "Секрет собственника", "type": "other", "phone": "+996555123456"},
        )
        self.login(self.staff)
        r = self.client.get("/api/v1/events/?after=0")
        self.assertEqual(r.status_code, 200, r.data)
        self.assertNotIn("Секрет собственника", str(r.data))

    def test_unconfigured_outbox_never_claims_delivery(self):
        from .tasks import deliver_outbox

        job = m.Outbox.objects.create(
            company=self.a,
            kind="waitlist_offer",
            idempotency_key="test-no-provider",
            payload={"phone": "+996555123456"},
        )
        deliver_outbox()
        job.refresh_from_db()
        self.assertEqual(job.status, "unconfigured")
