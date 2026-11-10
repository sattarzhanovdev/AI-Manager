import base64, hashlib, secrets
from datetime import timedelta
from cryptography.fernet import Fernet
from django.conf import settings
from django.utils import timezone
from rest_framework.authentication import BaseAuthentication, get_authorization_header
from rest_framework.exceptions import AuthenticationFailed
from .models import AccessSession, Membership


def digest(token):
    return hashlib.sha256(token.encode()).hexdigest()


def cipher():
    return Fernet(
        base64.urlsafe_b64encode(hashlib.sha256(settings.SECRET_KEY.encode()).digest())
    )


def issue_session(user, verified=False):
    token = secrets.token_urlsafe(48)
    AccessSession.objects.create(
        user=user,
        token_hash=digest(token),
        expires_at=timezone.now() + timedelta(hours=12),
        mfa_verified=verified,
    )
    return token


class BearerAuthentication(BaseAuthentication):
    def authenticate_header(self, request):
        return "Bearer"

    def authenticate(self, request):
        parts = get_authorization_header(request).split()
        if not parts:
            return None
        if len(parts) != 2 or parts[0].lower() != b"bearer":
            raise AuthenticationFailed("Неверный формат авторизации.")
        try:
            session = AccessSession.objects.select_related("user").get(
                token_hash=digest(parts[1].decode()),
                revoked_at=None,
                expires_at__gt=timezone.now(),
                user__is_active=True,
            )
        except (AccessSession.DoesNotExist, UnicodeError):
            raise AuthenticationFailed("Сессия истекла. Войдите снова.")
        from django.db import connection

        if connection.vendor == "postgresql":
            with connection.cursor() as cursor:
                cursor.execute(
                    "SELECT set_config('app.user_id', %s, true)", [str(session.user_id)]
                )
        privileged = (
            session.user.is_staff
            or Membership.objects.filter(
                user=session.user, role="owner", disabled_at=None
            ).exists()
        )
        if privileged and not session.mfa_verified:
            raise AuthenticationFailed("Требуется двухфакторная аутентификация.")
        return session.user, session
