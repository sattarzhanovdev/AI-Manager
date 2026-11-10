from django.db import migrations


def apply(apps, editor):
    if editor.connection.vendor != "postgresql":
        return
    with editor.connection.cursor() as c:
        c.execute("ALTER TABLE core_invitation ENABLE ROW LEVEL SECURITY")
        c.execute("ALTER TABLE core_invitation FORCE ROW LEVEL SECURITY")
        condition = "company_id = NULLIF(current_setting('app.company_id',true),'')::uuid OR current_setting('app.platform_admin',true) = 'true'"
        c.execute(
            f"CREATE POLICY tenant_isolation ON core_invitation USING ({condition}) WITH CHECK ({condition})"
        )


class Migration(migrations.Migration):
    dependencies = [("core", "0004_invitation")]
    operations = [migrations.RunPython(apply)]
