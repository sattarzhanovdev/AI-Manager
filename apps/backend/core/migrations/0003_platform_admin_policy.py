from django.db import migrations


def apply(apps, editor):
    if editor.connection.vendor != "postgresql":
        return
    with editor.connection.cursor() as c:
        for model in apps.get_app_config("core").get_models():
            if any(f.name == "company" for f in model._meta.fields):
                condition = "company_id = NULLIF(current_setting('app.company_id',true),'')::uuid OR current_setting('app.platform_admin',true) = 'true'"
                if model.__name__ == "Membership":
                    condition += " OR user_id = NULLIF(current_setting('app.user_id',true),'')::bigint"
                c.execute(
                    f"ALTER POLICY tenant_isolation ON {model._meta.db_table} USING ({condition}) WITH CHECK ({condition})"
                )


class Migration(migrations.Migration):
    dependencies = [("core", "0002_postgres_guards")]
    operations = [migrations.RunPython(apply)]
