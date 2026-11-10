from django.db import migrations


def install(apps, schema_editor):
    if schema_editor.connection.vendor != "postgresql":
        return
    with schema_editor.connection.cursor() as c:
        c.execute("CREATE EXTENSION IF NOT EXISTS btree_gist")
        for model in apps.get_app_config("core").get_models():
            if any(f.name == "company" for f in model._meta.fields):
                table = model._meta.db_table
                c.execute(f'ALTER TABLE "{table}" ENABLE ROW LEVEL SECURITY')
                c.execute(f'ALTER TABLE "{table}" FORCE ROW LEVEL SECURITY')
                using = "company_id = NULLIF(current_setting('app.company_id', true), '')::uuid"
                if model.__name__ == "Membership":
                    using = (
                        "user_id = NULLIF(current_setting('app.user_id', true), '')::bigint OR "
                        + using
                    )
                c.execute(
                    f'CREATE POLICY tenant_isolation ON "{table}" USING ({using}) WITH CHECK ({using})'
                )
        c.execute(
            """ALTER TABLE core_appointment ADD CONSTRAINT no_overlapping_appointments EXCLUDE USING gist (company_id WITH =, resource_id WITH =, tstzrange(starts_at,ends_at,'[)') WITH &&) WHERE (status NOT IN ('cancelled','no_show'))"""
        )
        c.execute(
            """CREATE FUNCTION protect_kb_history() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF OLD.status IN ('published','archived') AND (NEW.fields IS DISTINCT FROM OLD.fields OR NEW.snapshot IS DISTINCT FROM OLD.snapshot OR NEW.version IS DISTINCT FROM OLD.version OR NEW.completeness IS DISTINCT FROM OLD.completeness OR NEW.company_id IS DISTINCT FROM OLD.company_id) THEN RAISE EXCEPTION 'Published knowledge is immutable'; END IF; RETURN NEW; END $$"""
        )
        c.execute(
            "CREATE TRIGGER immutable_kb BEFORE UPDATE ON core_questionnaire FOR EACH ROW EXECUTE FUNCTION protect_kb_history()"
        )
        c.execute(
            """CREATE FUNCTION protect_audit_history() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Audit history is immutable'; END $$"""
        )
        c.execute(
            "CREATE TRIGGER immutable_audit BEFORE UPDATE OR DELETE ON core_audit FOR EACH ROW EXECUTE FUNCTION protect_audit_history()"
        )


class Migration(migrations.Migration):
    dependencies = [("core", "0001_initial")]
    operations = [migrations.RunPython(install)]
