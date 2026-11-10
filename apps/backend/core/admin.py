from django.contrib import admin
from django.db import transaction
from . import models as m


# Django admin is the internal platform console, limited to superusers.
class PlatformAdmin(admin.ModelAdmin):
    list_per_page = 50

    def has_module_permission(self, request):
        return request.user.is_superuser

    def has_view_permission(self, request, obj=None):
        return request.user.is_superuser

    def has_change_permission(self, request, obj=None):
        return request.user.is_superuser

    def has_add_permission(self, request):
        return request.user.is_superuser

    def has_delete_permission(self, request, obj=None):
        return request.user.is_superuser


class ReadonlyAdmin(PlatformAdmin):
    def has_change_permission(self, request, obj=None):
        return False

    def has_add_permission(self, request):
        return False

    def has_delete_permission(self, request, obj=None):
        return False


for model in [
    m.Company,
    m.Membership,
    m.Branch,
    m.Resource,
    m.Ticket,
    m.Subscription,
    m.Invoice,
    m.Moderation,
    m.Integration,
]:
    admin.site.register(model, PlatformAdmin)
for model in [m.Audit, m.Questionnaire, m.Outbox]:
    admin.site.register(model, ReadonlyAdmin)

# The platform console also requires TOTP. Enrol superusers with enrol_mfa.
import pyotp
from django import forms
from django.contrib.admin.forms import AdminAuthenticationForm
from django.utils import timezone
from .auth import cipher


class MFAAdminForm(AdminAuthenticationForm):
    otp = forms.CharField(label="Код 2FA", max_length=6)

    @transaction.atomic
    def clean(self):
        data = super().clean()
        user = self.get_user()
        if not user:
            return data
        device = (
            m.MFADevice.objects.select_for_update()
            .filter(user=user, confirmed=True)
            .first()
        )
        counter = int(timezone.now().timestamp()) // 30
        if (
            not device
            or device.last_counter >= counter
            or not pyotp.TOTP(
                cipher().decrypt(device.encrypted_secret.encode()).decode()
            ).verify(data.get("otp", ""))
        ):
            raise forms.ValidationError(
                "Неверный код 2FA. Настройка — через команду enrol_mfa."
            )
        device.last_counter = counter
        device.save(update_fields=["last_counter"])
        self.request.session["admin_mfa"] = True
        return data


admin.site.login_form = MFAAdminForm
_original_has_permission = admin.site.has_permission
admin.site.has_permission = lambda request: (
    _original_has_permission(request)
    and request.user.is_superuser
    and request.session.get("admin_mfa", False)
)


def record_admin_change(self, request, obj, message):
    company_id = (
        obj.pk if isinstance(obj, m.Company) else getattr(obj, "company_id", None)
    )
    if company_id:
        m.Audit.objects.create(
            company_id=company_id,
            actor_name=f"Платформа: {request.user.username}",
            action="platform.change",
            entity=f"{obj._meta.label}:{obj.pk}",
            detail=str(message)[:2000],
        )
    return super(PlatformAdmin, self).log_change(request, obj, message)


PlatformAdmin.log_change = record_admin_change
