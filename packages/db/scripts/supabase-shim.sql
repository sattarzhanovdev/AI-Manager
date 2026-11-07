-- Минимальная имитация окружения Supabase для проверки миграций на обычном Postgres 15+/16
-- (без Docker). Используется только скриптом scripts/check-migrations.sh, в облако не применяется.
-- Повторяет: роли API, схему auth (users, uid(), jwt(), role()), Vault, pgmq, pg_cron, публикацию Realtime.

do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin noinherit; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin noinherit; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin noinherit bypassrls; end if;
  if not exists (select 1 from pg_roles where rolname = 'supabase_auth_admin') then create role supabase_auth_admin nologin noinherit; end if;
end $$;

grant usage on schema public to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;

create schema if not exists auth;
grant usage on schema auth to anon, authenticated, service_role;
create table if not exists auth.users (
  id uuid primary key default gen_random_uuid(),
  email text unique,
  encrypted_password text,
  raw_user_meta_data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create or replace function auth.jwt() returns jsonb language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claim', true), ''), nullif(current_setting('request.jwt.claims', true), ''))::jsonb
$$;
create or replace function auth.uid() returns uuid language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claim.sub', true), ''), auth.jwt() ->> 'sub')::uuid
$$;
create or replace function auth.role() returns text language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claim.role', true), ''), auth.jwt() ->> 'role')
$$;
grant execute on all functions in schema auth to anon, authenticated, service_role;

create schema if not exists vault;
create or replace function vault.create_secret(p_secret text, p_name text) returns uuid language sql as $$ select gen_random_uuid() $$;

-- pgmq: только интерфейс, который вызывают миграции и RPC
create schema if not exists pgmq;
create table if not exists pgmq.shim_messages (id bigserial primary key, queue text not null, message jsonb, vt timestamptz default now());
create or replace function pgmq.create(queue_name text) returns void language sql as $$ select $$;
create or replace function pgmq.send(queue_name text, msg jsonb) returns setof bigint language sql as $$
  insert into pgmq.shim_messages (queue, message) values (queue_name, msg) returning id
$$;
create or replace function pgmq.set_vt(queue_name text, msg_id bigint, vt integer) returns void language sql as $$ select $$;

create schema if not exists cron;
create or replace function cron.schedule(job_name text, schedule text, command text) returns bigint language sql as $$ select 1::bigint $$;

do $$ begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then create publication supabase_realtime; end if;
end $$;

-- Роль, под которой PostgREST подключается к базе (как в Supabase)
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'authenticator') then create role authenticator login password 'authenticator' noinherit; end if;
end $$;
grant anon, authenticated, service_role to authenticator;
