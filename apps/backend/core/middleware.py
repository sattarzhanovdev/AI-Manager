from django.db import connection, transaction


class TenantMiddleware:
    """RLS context is transaction-local: never survives connection pooling."""

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        if connection.vendor != "postgresql" or not request.path.startswith(
            ("/api/", "/admin/")
        ):
            return self.get_response(request)
        with transaction.atomic():
            # Default deny. API sets company only after verified membership.
            with connection.cursor() as cursor:
                cursor.execute("SELECT set_config('app.company_id', '', true)")
                cursor.execute(
                    "SELECT set_config('app.platform_admin', %s, true)",
                    [
                        "true"
                        if request.path.startswith("/admin/")
                        and request.user.is_authenticated
                        and request.user.is_superuser
                        and request.session.get("admin_mfa")
                        else "false"
                    ],
                )
            return self.get_response(request)


def set_tenant(company_id):
    if connection.vendor == "postgresql":
        with connection.cursor() as cursor:
            cursor.execute(
                "SELECT set_config('app.company_id', %s, true)", [str(company_id)]
            )
