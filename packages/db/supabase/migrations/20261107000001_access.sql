-- Группа «Доступ»: компании, филиалы, профили, членство, приглашения, аудит.
create extension if not exists pgcrypto;
create extension if not exists vector;
create extension if not exists pg_trgm;

create schema if not exists private;

create type public.member_role as enum ('owner', 'admin', 'staff', 'accountant');
create type public.company_status as enum ('onboarding', 'moderation', 'active', 'suspended', 'closed');
create type public.ai_mode as enum ('on', 'leads_only', 'all_human', 'off');

-- updated_at для всех таблиц
create or replace function private.touch_updated_at() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end $$;

-- Единая точка: RLS + индекс + политики + триггер для таблицы с company_id.
-- p_write_roles — кто может писать; читать могут все участники компании.
create or replace function private.apply_tenant_rls(p_table text, p_write_roles text[] default array['owner','admin'])
returns void language plpgsql set search_path = '' as $$
begin
  execute format('alter table public.%I enable row level security', p_table);
  execute format('create index if not exists %I on public.%I (company_id, created_at desc)', p_table || '_company_created_idx', p_table);
  execute format('create policy %I on public.%I for select using (public.is_member(company_id))', p_table || '_select', p_table);
  execute format('create policy %I on public.%I for insert with check (public.has_role(company_id, %L::text[]))', p_table || '_insert', p_table, p_write_roles);
  execute format('create policy %I on public.%I for update using (public.has_role(company_id, %L::text[])) with check (public.has_role(company_id, %L::text[]))', p_table || '_update', p_table, p_write_roles, p_write_roles);
  execute format('create policy %I on public.%I for delete using (public.has_role(company_id, array[''owner'',''admin'']))', p_table || '_delete', p_table);
  execute format('create trigger %I before update on public.%I for each row execute function private.touch_updated_at()', p_table || '_touch', p_table);
end $$;

create table public.plans (
  id uuid primary key default gen_random_uuid(),
  key text not null unique,
  name text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.plan_versions (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references public.plans(id),
  version int not null,
  limits jsonb not null,            -- {"minutes":1000,"ai_dialogs":2000,"lines":2,"modes":["leads","consult"]}
  prices jsonb not null,            -- {"KGS":{"amount_minor":990000,"overage_minute_minor":1500}}
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (plan_id, version)
);

create table public.companies (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  name_stress text,
  sphere text not null check (sphere in ('autoservice','salon','clinic','dental','service','polyclinic','other')),
  timezone text not null default 'Asia/Bishkek',
  locale text not null default 'ru',
  currency char(3) not null default 'KGS',
  status public.company_status not null default 'onboarding',
  ai_mode public.ai_mode not null default 'off',
  plan_version_id uuid references public.plan_versions(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text,
  phone text check (phone is null or phone ~ '^\+[1-9][0-9]{6,14}$'),
  email text,
  locale text not null default 'ru',
  platform_role text check (platform_role in ('superadmin','support','sales')),
  telegram_chat_id bigint,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.memberships (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role public.member_role not null,
  permissions jsonb not null default '{}'::jsonb,  -- {"edit_questionnaire":true,"integrations":false}
  branch_ids uuid[] not null default '{}',
  transfer_phone text,
  disabled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, user_id)
);

-- Функции доступа читают компании и роли из JWT (custom access token hook), без подзапросов на строку.
create or replace function public.is_member(p_company_id uuid) returns boolean
language sql stable set search_path = '' as $$
  select coalesce((auth.jwt() -> 'companies') ? p_company_id::text, false)
      or coalesce(auth.jwt() ->> 'platform_role' in ('superadmin','support'), false)
$$;

create or replace function public.has_role(p_company_id uuid, p_roles text[]) returns boolean
language sql stable set search_path = '' as $$
  select coalesce((auth.jwt() -> 'companies' ->> p_company_id::text) = any (p_roles), false)
      or coalesce(auth.jwt() ->> 'platform_role' = 'superadmin', false)
$$;

create or replace function public.custom_access_token_hook(event jsonb) returns jsonb
language plpgsql stable set search_path = '' as $$
declare
  v_claims jsonb := event -> 'claims';
  v_companies jsonb;
  v_platform text;
begin
  select coalesce(jsonb_object_agg(m.company_id::text, m.role::text), '{}'::jsonb)
    into v_companies
    from public.memberships m
   where m.user_id = (event ->> 'user_id')::uuid and m.disabled_at is null;
  select p.platform_role into v_platform from public.profiles p where p.id = (event ->> 'user_id')::uuid;
  v_claims := jsonb_set(v_claims, '{companies}', v_companies);
  if v_platform is not null then
    v_claims := jsonb_set(v_claims, '{platform_role}', to_jsonb(v_platform));
  end if;
  return jsonb_set(event, '{claims}', v_claims);
end $$;
grant usage on schema public to supabase_auth_admin;
grant execute on function public.custom_access_token_hook to supabase_auth_admin;
grant select on public.memberships, public.profiles to supabase_auth_admin;
revoke execute on function public.custom_access_token_hook from authenticated, anon, public;

create table public.branches (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  name text not null,
  address text not null,
  landmarks text,
  directions text,
  hours jsonb not null default '{}'::jsonb,       -- {"mon":[["09:00","19:00"]],...}
  holidays jsonb not null default '[]'::jsonb,
  phones text[] not null default '{}',
  timezone text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.invitations (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  contact text not null,              -- email или телефон E.164
  role public.member_role not null,
  token_hash text not null unique,
  invited_by uuid references auth.users(id),
  expires_at timestamptz not null default now() + interval '7 days',
  accepted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.audit_log (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references public.companies(id) on delete cascade,
  actor_id uuid references auth.users(id),
  actor_kind text not null default 'user' check (actor_kind in ('user','ai','system','support')),
  action text not null,
  entity text not null,
  entity_id uuid,
  before jsonb,
  after jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- companies: читают участники, меняет только собственник
alter table public.companies enable row level security;
create policy companies_select on public.companies for select using (public.is_member(id));
create policy companies_update on public.companies for update
  using (public.has_role(id, array['owner'])) with check (public.has_role(id, array['owner']));
create trigger companies_touch before update on public.companies for each row execute function private.touch_updated_at();

alter table public.profiles enable row level security;
create policy profiles_self on public.profiles for all using (id = auth.uid()) with check (id = auth.uid());
create policy profiles_colleagues on public.profiles for select using (
  exists (select 1 from public.memberships m where m.user_id = profiles.id and public.is_member(m.company_id)));

alter table public.plans enable row level security;
alter table public.plan_versions enable row level security;
create policy plans_read on public.plans for select using (true);
create policy plan_versions_read on public.plan_versions for select using (published_at is not null);

select private.apply_tenant_rls('memberships', array['owner']);
select private.apply_tenant_rls('branches', array['owner','admin']);
select private.apply_tenant_rls('invitations', array['owner']);

-- Аудит пишется только через security definer функции; читать — собственнику
alter table public.audit_log enable row level security;
create index audit_log_company_created_idx on public.audit_log (company_id, created_at desc);
create policy audit_log_select on public.audit_log for select using (public.has_role(company_id, array['owner']));

create or replace function public.write_audit(p_company_id uuid, p_action text, p_entity text, p_entity_id uuid, p_before jsonb, p_after jsonb)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_member(p_company_id) then raise exception 'forbidden' using errcode = '42501'; end if;
  insert into public.audit_log (company_id, actor_id, action, entity, entity_id, before, after)
  values (p_company_id, auth.uid(), p_action, p_entity, p_entity_id, p_before, p_after);
end $$;
