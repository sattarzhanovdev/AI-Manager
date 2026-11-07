-- Группа «Платформа»: интеграции, вебхуки, ключи, уведомления, модерация, eval, инциденты
create table public.integrations (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  key text not null,
  status text not null default 'connected' check (status in ('connected','error','reconnect','disabled')),
  config jsonb not null default '{}'::jsonb,
  credentials_ref text,           -- секрет в Vault, сам токен в таблице не хранится
  last_sync_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, key)
);

create table public.integration_logs (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  integration_id uuid not null references public.integrations(id) on delete cascade,
  direction text not null check (direction in ('in','out')),
  event text not null,
  status text not null check (status in ('ok','error','retrying','dead')),
  ms int,
  error text,
  attempt int not null default 1,
  payload_ref jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.webhook_endpoints (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  url text not null check (url ~ '^https://'),
  events text[] not null,
  secret_ref text not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.api_keys (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  name text not null,
  prefix text not null,
  key_hash text not null unique,
  scopes text[] not null,
  last_used_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  user_id uuid references auth.users(id) on delete cascade,
  kind text not null check (kind in ('lead_new','lead_urgent','complaint','call_missed','chat_takeover','limit_80','limit_100','integration_error','payment_due','kb_published')),
  title text not null,
  body text,
  entity text,
  entity_id uuid,
  read_at timestamptz,
  repeat_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.notification_prefs (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null,
  channels text[] not null default '{app,telegram}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, user_id, kind)
);

create table public.moderation_checks (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  questionnaire_version int not null,
  status text not null default 'queued' check (status in ('queued','in_review','approved','rejected')),
  classifier jsonb,          -- [{rule, quote, severity}]
  checklist jsonb,
  reviewer_id uuid references auth.users(id),
  sla_due_at timestamptz not null default now() + interval '24 hours',
  decided_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.eval_runs (
  id uuid primary key default gen_random_uuid(),
  sphere text,
  prompt_version text not null,
  metrics jsonb not null,
  failures jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.incidents (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  severity text not null check (severity in ('sev1','sev2','sev3')),
  status text not null default 'open' check (status in ('open','mitigated','resolved')),
  timeline jsonb not null default '[]'::jsonb,
  affected_company_ids uuid[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

select private.apply_tenant_rls('integrations', array['owner']);
select private.apply_tenant_rls('integration_logs', array['owner']);
select private.apply_tenant_rls('webhook_endpoints', array['owner']);
select private.apply_tenant_rls('api_keys', array['owner']);
select private.apply_tenant_rls('notification_prefs', array['owner','admin']);
select private.apply_tenant_rls('moderation_checks', array['owner']);

alter table public.notifications enable row level security;
create index notifications_user_idx on public.notifications (user_id, created_at desc);
create policy notifications_own on public.notifications for select using (user_id = auth.uid() and public.is_member(company_id));
create policy notifications_read on public.notifications for update using (user_id = auth.uid()) with check (user_id = auth.uid());

alter table public.eval_runs enable row level security;
alter table public.incidents enable row level security;
create policy eval_runs_platform on public.eval_runs for all using (public.is_platform()) with check (public.is_platform(array['superadmin']));
create policy incidents_platform on public.incidents for all using (public.is_platform()) with check (public.is_platform(array['superadmin','support']));

-- Секреты интеграций и вебхуков — в Vault, читаются только сервисной ролью
create or replace function public.store_secret(p_company_id uuid, p_name text, p_secret text) returns text
language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  if not public.has_role(p_company_id, array['owner']) and auth.role() <> 'service_role' then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  select vault.create_secret(p_secret, p_company_id::text || ':' || p_name) into v_id;
  return v_id::text;
end $$;
