#!/bin/sh
set -eu
# Used by the official Postgres image on first initialization only.
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" --set=runtime_password="$DATABASE_RUNTIME_PASSWORD" --set=worker_password="$DATABASE_WORKER_PASSWORD" <<'SQL'
CREATE ROLE allmanager_runtime LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS PASSWORD :'runtime_password';
CREATE ROLE allmanager_worker LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS PASSWORD :'worker_password';
GRANT allmanager_runtime TO allmanager_worker;
GRANT USAGE ON SCHEMA public TO allmanager_runtime;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO allmanager_runtime;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO allmanager_runtime;
SQL
