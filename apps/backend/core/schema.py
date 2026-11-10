from drf_spectacular.extensions import OpenApiAuthenticationExtension


class BearerScheme(OpenApiAuthenticationExtension):
    target_class = "core.auth.BearerAuthentication"
    name = "BearerAuth"

    def get_security_definition(self, auto_schema):
        return {"type": "http", "scheme": "bearer"}
