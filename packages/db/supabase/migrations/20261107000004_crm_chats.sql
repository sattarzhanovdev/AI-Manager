-- Группа «Чаты и CRM»
create table public.channels (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  type text not null check (type in ('widget','telegram','whatsapp','instagram','facebook')),
  status text not null default 'connected' check (status in ('connected','error','reconnect','disabled')),
  credentials_ref text,          -- ссылка на секрет в Vault
  settings jsonb not null default '{}'::jsonb,
  ai_mode public.ai_mode not null default 'on',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.conversations (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  channel_id uuid not null references public.channels(id) on delete cascade,
  contact_id uuid references public.contacts(id) on delete set null,
  external_id text not null,
  state text not null default 'ai' check (state in ('ai','draft','operator','closed')),
  assignee_id uuid references auth.users(id),
  window_expires_at timestamptz,
  last_message_at timestamptz,
  unread int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (channel_id, external_id)
);

create table public.messages (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  direction text not null check (direction in ('in','out')),
  author text not null check (author in ('client','ai','operator','system')),
  author_id uuid references auth.users(id),
  body text,
  attachments jsonb not null default '[]'::jsonb,
  transcript text,
  status text not null default 'sent' check (status in ('draft','queued','sent','delivered','failed')),
  external_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (conversation_id, external_id)
);

create table public.leads (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  number serial,
  source text not null check (source in ('call','chat','manual','demo')),
  source_id uuid,
  channel text,
  type text not null check (type in ('booking','consultation','order','complaint','reschedule','callback','other')),
  title text not null,
  status text not null default 'new' check (status in ('new','in_progress','waiting','won','lost')),
  priority text not null default 'normal' check (priority in ('normal','urgent')),
  tags text[] not null default '{}',
  contact_id uuid references public.contacts(id) on delete set null,
  branch_id uuid references public.branches(id),
  assignee_id uuid references auth.users(id),
  due_at timestamptz,
  closed_at timestamptz,
  lost_reason text,
  payload jsonb not null default '{}'::jsonb,
  idempotency_key text unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- закрытие без результата требует причину
  constraint leads_lost_reason check (status <> 'lost' or lost_reason is not null)
);
create index leads_company_status_idx on public.leads (company_id, status, created_at desc);

create table public.lead_events (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  lead_id uuid not null references public.leads(id) on delete cascade,
  actor_id uuid references auth.users(id),
  actor_kind text not null default 'user' check (actor_kind in ('user','ai','system')),
  action text not null,     -- created, status, assignee, comment, tag
  comment text,
  mentions uuid[] not null default '{}',
  before jsonb,
  after jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

select private.apply_tenant_rls('channels', array['owner']);
select private.apply_tenant_rls('conversations', array['owner','admin','staff']);
select private.apply_tenant_rls('messages', array['owner','admin','staff']);
select private.apply_tenant_rls('leads', array['owner','admin','staff']);
select private.apply_tenant_rls('lead_events', array['owner','admin','staff']);

-- Видимость по ролям (раздел 05): сотрудник видит «свои», бухгалтер не видит операционных данных.
create or replace function public.can_see_ops(p_company_id uuid, p_assignee uuid) returns boolean
language sql stable set search_path = '' as $$
  select public.has_role(p_company_id, array['owner','admin'])
      or (public.has_role(p_company_id, array['staff']) and (p_assignee is null or p_assignee = auth.uid()))
$$;

drop policy leads_select on public.leads;
create policy leads_select on public.leads for select using (public.can_see_ops(company_id, assignee_id));
drop policy leads_update on public.leads;
create policy leads_update on public.leads for update
  using (public.can_see_ops(company_id, assignee_id)) with check (public.can_see_ops(company_id, assignee_id));
drop policy conversations_select on public.conversations;
create policy conversations_select on public.conversations for select using (public.can_see_ops(company_id, assignee_id));
drop policy messages_select on public.messages;
create policy messages_select on public.messages for select using (
  exists (select 1 from public.conversations c where c.id = conversation_id and public.can_see_ops(c.company_id, c.assignee_id)));
drop policy contacts_select on public.contacts;
create policy contacts_select on public.contacts for select using (public.has_role(company_id, array['owner','admin','staff']));

-- Звонки: сотрудник видит звонки, связанные со своими заявками
drop policy calls_select on public.calls;
create policy calls_select on public.calls for select using (
  public.has_role(company_id, array['owner','admin'])
  or (public.has_role(company_id, array['staff']) and exists (
    select 1 from public.leads l where l.source = 'call' and l.source_id = calls.id and l.assignee_id = auth.uid())));
drop policy call_turns_select on public.call_turns;
create policy call_turns_select on public.call_turns for select using (
  exists (select 1 from public.calls c where c.id = call_id));
