import pyotp
from django.core.management.base import BaseCommand, CommandError
from django.contrib.auth import get_user_model
from core.models import MFADevice
from core.auth import cipher


class Command(BaseCommand):
    help = "Initial MFA enrolment for a platform superuser (does not replace an existing device)."

    def add_arguments(self, p):
        p.add_argument("--username", required=True)

    def handle(self, *args, **opts):
        u = get_user_model().objects.get(username=opts["username"], is_superuser=True)
        if MFADevice.objects.filter(user=u).exists():
            raise CommandError("Device already exists. Refusing to reset MFA.")
        secret = pyotp.random_base32()
        MFADevice.objects.create(
            user=u,
            confirmed=True,
            encrypted_secret=cipher().encrypt(secret.encode()).decode(),
        )
        self.stdout.write(
            pyotp.TOTP(secret).provisioning_uri(
                u.email or u.username, issuer_name="ALL-менеджер"
            )
        )
        self.stdout.write(
            "Store this secret in an authenticator app. It will not be shown again."
        )
