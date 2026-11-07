-- Группа «Звонки»
create table public.phone_numbers (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  branch_id uuid references public.branches(id),
  e164 text not null unique check (e164 ~ '^\+[1-9][0-9]{6,14}$'),
  kind text not null default 'forwarding' check (kind in ('forwarding','platform')),
  ai_mode public.ai_mode not null default 'on',
  schedule jsonb not null default '{"mode":"always"}'::jsonb,  -- always | no_answer:{seconds} | schedule:{...}
  lines int not null default 2,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.contacts (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  phone text check (phone is null or phone ~ '^\+[1-9][0-9]{6,14}$'),
  name text,
  channels jsonb not null default '{}'::jsonb,
  tags text[] not null default '{}',
  notes text,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  interactions_count int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
-- Один номер — одна карточка в компании (звонок и чат с одного номера попадают в одну карточку)
create unique index contacts_company_phone on public.contacts (company_id, phone) where phone is not null;
create index contacts_name_trgm on public.contacts using gin (name gin_trgm_ops);

create table public.calls (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  number_id uuid references public.phone_numbers(id),
  branch_id uuid references public.branches(id),
  caller text not null,
  contact_id uuid references public.contacts(id) on delete set null,
  direction text not null default 'inbound' check (direction in ('inbound','outbound')),
  started_at timestamptz not null,
  answered_at timestamptz,
  ended_at timestamptz,
  billed_seconds int not null default 0,
  type text check (type in ('booking','consultation','complaint','reschedule','irrelevant','spam')),
  outcome text check (outcome in ('lead_created','booked','transferred','no_result','dropped','missed')),
  summary text,
  rating smallint check (rating in (-1, 1)),
  rating_reason text,
  flags text[] not null default '{}',
  recording_path text,
  callback_done_at timestamptz,
  kb_version int,
  prompt_version text,
  cost_minor bigint not null default 0,
  currency char(3) not null default 'USD',
  idempotency_key text unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index calls_company_started_idx on public.calls (company_id, started_at desc);

create table public.call_turns (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  call_id uuid not null references public.calls(id) on delete cascade,
  seq int not null,
  speaker text not null check (speaker in ('ai','caller','operator')),
  start_ms int not null,
  end_ms int not null,
  text text not null,
  interrupted boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (call_id, seq)
);

create table public.call_metrics (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  call_id uuid not null references public.calls(id) on delete cascade,
  turn_seq int not null,
  stt_ms int, eou_ms int, llm_ttft_ms int, tts_ttfb_ms int, total_ms int,
  provider_stt text, provider_llm text, provider_tts text,
  fallback_used boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.call_tool_calls (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  call_id uuid not null references public.calls(id) on delete cascade,
  at_ms int not null,
  name text not null,
  arguments jsonb not null,
  result jsonb,
  status text not null check (status in ('ok','error','rejected')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.transfers (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  call_id uuid not null references public.calls(id) on delete cascade,
  reason text not null,
  target text not null,
  answered boolean not null default false,
  wait_ms int,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

select private.apply_tenant_rls('phone_numbers', array['owner']);
select private.apply_tenant_rls('contacts', array['owner','admin','staff']);
select private.apply_tenant_rls('calls', array['owner','admin','staff']);
select private.apply_tenant_rls('call_turns', array['owner']);
select private.apply_tenant_rls('call_metrics', array['owner']);
select private.apply_tenant_rls('call_tool_calls', array['owner']);
select private.apply_tenant_rls('transfers', array['owner']);
