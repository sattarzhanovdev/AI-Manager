from django.db import migrations


def apply(apps, editor):
    if editor.connection.vendor != "postgresql":
        return
    with editor.connection.cursor() as c:
        c.execute("ALTER TABLE core_company ENABLE ROW LEVEL SECURITY")
        c.execute("ALTER TABLE core_company FORCE ROW LEVEL SECURITY")
        condition = "id = NULLIF(current_setting('app.company_id',true),'')::uuid OR current_setting('app.platform_admin',true) = 'true' OR current_user = 'allmanager_worker'"
        c.execute(
            f"CREATE POLICY tenant_isolation ON core_company USING ({condition}) WITH CHECK ({condition})"
        )


class Migration(migrations.Migration):
    dependencies = [("core", "0007_realtime_rls")]
    operations = [migrations.RunPython(apply)]
