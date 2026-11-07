-- Hackathon MVP: усиление безопасности и данные, без которых веб-MVP не работает на Supabase.
--  1. Права проверяются по таблице memberships, а не только по JWT: RLS работает и без custom access token hook
--     (на облаке хук включается вручную; без него раньше пользователь не видел ничего).
--  2. platform_role нельзя выставить себе через API (раньше profiles_self позволял стать superadmin).
--  3. Сервисные SECURITY DEFINER-функции без проверки прав закрыты от anon/authenticated.
--  4. erase_contact и book_slot больше не трогают данные чужой компании.
--  5. История заявок пишется триггером на сервере БД (status, assignee, priority, tags).
--  6. Таблицы: assistant_settings (настройки ассистента), ai_requests (учёт и ограничение AI-запросов).

-- ───────────── 1. Доступ по членству ─────────────
create or replace function public.is_member(p_company_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
      select 1 from public.memberships m
       where m.company_id = p_company_id and m.user_id = auth.uid() and m.disabled_at is null)
      or exists (select 1 from public.profiles p where p.id = auth.uid() and p.platform_role in ('superadmin','support'))
$$;

create or replace function public.has_role(p_company_id uuid, p_roles text[]) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
      select 1 from public.memberships m
       where m.company_id = p_company_id and m.user_id = auth.uid() and m.disabled_at is null
         and m.role::text = any (p_roles))
      or exists (select 1 from public.profiles p where p.id = auth.uid() and p.platform_role = 'superadmin')
$$;

create or replace function public.is_platform(p_roles text[] default array['superadmin','support','sales']) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.profiles p where p.id = auth.uid() and p.platform_role = any (p_roles))
$$;

create index if not exists memberships_user_idx on public.memberships (user_id, company_id) where disabled_at is null;

-- ───────────── 2. platform_role меняется только сервером ─────────────
create or replace function private.protect_platform_role() returns trigger
language plpgsql set search_path = '' as $$
begin
  if coalesce(auth.role(), '') in ('anon', 'authenticated')
     and new.platform_role is distinct from (case when tg_op = 'UPDATE' then old.platform_role else null end) then
    raise exception 'platform_role is managed by the platform' using errcode = '42501';
  end if;
  return new;
end $$;
drop trigger if exists profiles_protect_platform_role on public.profiles;
create trigger profiles_protect_platform_role before insert or update on public.profiles
  for each row execute function private.protect_platform_role();

-- ───────────── 3. Сервисные функции — только service_role ─────────────
revoke execute on function public.resolve_number(text) from public, anon, authenticated;
revoke execute on function public.get_snapshot(uuid, int) from public, anon, authenticated;
revoke execute on function public.check_limits(uuid) from public, anon, authenticated;
revoke execute on function public.clone_questionnaire_draft(uuid, uuid, int) from public, anon, authenticated;
revoke execute on function public.custom_access_token_hook(jsonb) from public, anon, authenticated;
grant execute on function public.resolve_number(text), public.get_snapshot(uuid, int), public.check_limits(uuid),
  public.clone_questionnaire_draft(uuid, uuid, int) to service_role;
-- Функции кабинета: только вошедшим (внутри — проверка роли в компании)
revoke execute on function public.write_audit(uuid, text, text, uuid, jsonb, jsonb) from public, anon;
revoke execute on function public.store_secret(uuid, text, text) from public, anon;
revoke execute on function public.publish_questionnaire(uuid, jsonb, text[]) from public, anon;
revoke execute on function public.rollback_questionnaire(uuid, int) from public, anon;
revoke execute on function public.set_ai_mode(uuid, public.ai_mode) from public, anon;
revoke execute on function public.erase_contact(uuid, uuid) from public, anon;
revoke execute on function public.book_slot(uuid, uuid, uuid, timestamptz, timestamptz, uuid, boolean) from public, anon;
revoke execute on function public.create_lead(uuid, jsonb, text) from public, anon;

-- ───────────── 4. Межарендные проверки в RPC ─────────────
create or replace function public.erase_contact(p_company_id uuid, p_contact_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_phone text;
begin
  if not public.has_role(p_company_id, array['owner']) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  select phone into v_phone from public.contacts where id = p_contact_id and company_id = p_company_id;
  if not found then raise exception 'contact not found' using errcode = 'P0002'; end if;
  perform pgmq.send('erase_recordings', jsonb_build_object('company_id', p_company_id,
    'paths', (select coalesce(jsonb_agg(recording_path), '[]'::jsonb) from public.calls
               where company_id = p_company_id and contact_id = p_contact_id and recording_path is not null)));
  delete from public.call_turns t using public.calls c
   where t.call_id = c.id and c.company_id = p_company_id and c.contact_id = p_contact_id;
  update public.calls set recording_path = null, summary = null, caller = '+0000000', contact_id = null
   where company_id = p_company_id and contact_id = p_contact_id;
  delete from public.messages m using public.conversations cv
   where m.conversation_id = cv.id and cv.company_id = p_company_id and cv.contact_id = p_contact_id;
  delete from public.contacts where id = p_contact_id and company_id = p_company_id;
  insert into public.audit_log (company_id, actor_id, action, entity, entity_id, before)
  values (p_company_id, auth.uid(), 'erase', 'contact', p_contact_id, jsonb_build_object('phone_masked', left(v_phone, 4) || '****'));
end $$;

create or replace function public.book_slot(p_company_id uuid, p_resource_id uuid, p_service_id uuid, p_starts_at timestamptz, p_ends_at timestamptz, p_contact_id uuid, p_by_ai boolean default false)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  if auth.role() <> 'service_role' and not public.has_role(p_company_id, array['owner','admin','staff']) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if not exists (select 1 from public.resources where id = p_resource_id and company_id = p_company_id)
     or (p_service_id is not null and not exists (select 1 from public.services where id = p_service_id and company_id = p_company_id))
     or (p_contact_id is not null and not exists (select 1 from public.contacts where id = p_contact_id and company_id = p_company_id)) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  insert into public.appointments (company_id, resource_id, service_id, starts_at, ends_at, contact_id, created_by_ai)
  values (p_company_id, p_resource_id, p_service_id, p_starts_at, p_ends_at, p_contact_id, p_by_ai)
  returning id into v_id;
  return v_id;
exception when exclusion_violation then
  raise exception 'slot_taken' using errcode = '23P01';
end $$;

-- Заявка: проверка роли, контакт по телефону (E.164), идемпотентность, событие «создана» с автором.
-- p_payload: {type, title, priority, source, source_id, channel, actor_kind: user|ai, fields: {name, phone, ...}}
create or replace function public.create_lead(p_company_id uuid, p_payload jsonb, p_idempotency_key text default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
  v_contact uuid;
  v_phone text := nullif(p_payload -> 'fields' ->> 'phone', '');
  v_actor text := case when auth.role() = 'service_role' or p_payload ->> 'actor_kind' = 'ai' then 'ai' else 'user' end;
  v_source text := coalesce(p_payload ->> 'source', 'manual');
begin
  if auth.role() <> 'service_role' and not public.has_role(p_company_id, array['owner','admin','staff']) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_idempotency_key is not null then
    select id into v_id from public.leads where idempotency_key = p_idempotency_key and company_id = p_company_id;
    if v_id is not null then return v_id; end if;
  end if;
  if v_source = 'chat' and p_payload ->> 'source_id' is not null and not exists (
      select 1 from public.conversations where id = (p_payload ->> 'source_id')::uuid and company_id = p_company_id) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if v_source = 'call' and p_payload ->> 'source_id' is not null and not exists (
      select 1 from public.calls where id = (p_payload ->> 'source_id')::uuid and company_id = p_company_id) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if v_phone is not null then
    insert into public.contacts (company_id, phone, name, channels)
    values (p_company_id, v_phone, nullif(p_payload -> 'fields' ->> 'name', ''), jsonb_build_object(coalesce(p_payload ->> 'channel', 'phone'), true))
    on conflict (company_id, phone) where phone is not null
      do update set last_seen_at = now(), interactions_count = public.contacts.interactions_count + 1,
                    name = coalesce(public.contacts.name, excluded.name)
    returning id into v_contact;
  end if;
  insert into public.leads (company_id, source, source_id, channel, type, title, priority, contact_id, payload, idempotency_key, due_at)
  values (p_company_id,
          v_source,
          (p_payload ->> 'source_id')::uuid,
          p_payload ->> 'channel',
          coalesce(p_payload ->> 'type', 'other'),
          coalesce(nullif(p_payload ->> 'title', ''), 'Заявка'),
          coalesce(p_payload ->> 'priority', 'normal'),
          v_contact,
          coalesce(p_payload -> 'fields', '{}'::jsonb),
          p_idempotency_key,
          now() + case when p_payload ->> 'priority' = 'urgent' then interval '15 minutes' else interval '2 hours' end)
  returning id into v_id;
  insert into public.lead_events (company_id, lead_id, actor_id, actor_kind, action, after)
  values (p_company_id, v_id, auth.uid(), v_actor, 'created', p_payload - 'actor_kind');
  perform pgmq.send('lead_created', jsonb_build_object('company_id', p_company_id, 'lead_id', v_id));
  return v_id;
end $$;
revoke execute on function public.create_lead(uuid, jsonb, text) from public, anon;

-- ───────────── 5. История заявок на стороне БД ─────────────
create or replace function private.lead_history() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_actor uuid := auth.uid();
begin
  if new.status is distinct from old.status then
    insert into public.lead_events (company_id, lead_id, actor_id, actor_kind, action, comment, before, after)
    values (new.company_id, new.id, v_actor, case when v_actor is null then 'system' else 'user' end, 'status',
            case when new.status = 'lost' then new.lost_reason end, to_jsonb(old.status), to_jsonb(new.status));
  end if;
  if new.assignee_id is distinct from old.assignee_id then
    insert into public.lead_events (company_id, lead_id, actor_id, actor_kind, action, before, after)
    values (new.company_id, new.id, v_actor, case when v_actor is null then 'system' else 'user' end, 'assignee',
            to_jsonb(old.assignee_id), to_jsonb(new.assignee_id));
  end if;
  if new.tags is distinct from old.tags or new.priority is distinct from old.priority then
    insert into public.lead_events (company_id, lead_id, actor_id, actor_kind, action, before, after)
    values (new.company_id, new.id, v_actor, case when v_actor is null then 'system' else 'user' end, 'tag',
            jsonb_build_object('tags', old.tags, 'priority', old.priority), jsonb_build_object('tags', new.tags, 'priority', new.priority));
  end if;
  return new;
end $$;

create or replace function private.lead_close() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.status in ('won','lost') and old.status not in ('won','lost') then new.closed_at := now(); end if;
  if new.status not in ('won','lost') then new.closed_at := null; new.lost_reason := case when new.status = 'lost' then new.lost_reason end; end if;
  return new;
end $$;

drop trigger if exists leads_close on public.leads;
create trigger leads_close before update on public.leads for each row execute function private.lead_close();
drop trigger if exists leads_history on public.leads;
create trigger leads_history after update on public.leads for each row execute function private.lead_history();

-- Автор комментария — всегда текущий пользователь, подделать нельзя
create or replace function private.lead_event_author() returns trigger
language plpgsql set search_path = '' as $$
begin
  if coalesce(auth.role(), '') = 'authenticated' then
    new.actor_id := auth.uid();
    if new.actor_kind = 'system' then new.actor_kind := 'user'; end if;
  end if;
  return new;
end $$;
drop trigger if exists lead_events_author on public.lead_events;
create trigger lead_events_author before insert on public.lead_events for each row execute function private.lead_event_author();
-- События истории не редактируются из API
drop policy if exists lead_events_update on public.lead_events;
drop policy if exists lead_events_delete on public.lead_events;

create index if not exists lead_events_lead_idx on public.lead_events (lead_id, created_at);
create index if not exists leads_contact_idx on public.leads (contact_id);
create index if not exists calls_contact_idx on public.calls (contact_id);
create index if not exists messages_conversation_idx on public.messages (conversation_id, created_at);

-- ───────────── 6а. Настройки ассистента ─────────────
create table if not exists public.assistant_settings (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null unique references public.companies(id) on delete cascade,
  settings jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
select private.apply_tenant_rls('assistant_settings', array['owner']);

-- ───────────── 6б. Учёт и ограничение AI-запросов ─────────────
create table if not exists public.ai_requests (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  user_id uuid references auth.users(id) on delete set null,
  conversation_id uuid references public.conversations(id) on delete set null,
  engine text not null check (engine in ('llm','offline')),
  model text,
  tokens_in int not null default 0 check (tokens_in >= 0),
  tokens_out int not null default 0 check (tokens_out >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.ai_requests enable row level security;
create index if not exists ai_requests_company_created_idx on public.ai_requests (company_id, created_at desc);
create index if not exists ai_requests_user_created_idx on public.ai_requests (user_id, created_at desc);
-- Читают собственник и админ; пишет только RPC ниже
create policy ai_requests_select on public.ai_requests for select using (public.has_role(company_id, array['owner','admin']));
create trigger ai_requests_touch before update on public.ai_requests for each row execute function private.touch_updated_at();

-- Атомарная проверка лимитов и регистрация запроса. Лимиты передаёт сервер приложения (из env).
create or replace function public.ai_begin_request(
  p_company_id uuid, p_conversation_id uuid, p_engine text,
  p_per_user_minute int, p_per_company_day int, p_company_day_tokens bigint, p_model text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_user int; v_day int; v_tokens bigint; v_id uuid;
begin
  if not public.has_role(p_company_id, array['owner','admin','staff']) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_conversation_id is not null and not exists (
      select 1 from public.conversations where id = p_conversation_id and company_id = p_company_id) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  perform pg_advisory_xact_lock(hashtext('ai:' || p_company_id::text));
  select count(*) into v_user from public.ai_requests
   where user_id = auth.uid() and created_at > now() - interval '1 minute';
  if v_user >= p_per_user_minute then return jsonb_build_object('allowed', false, 'reason', 'rate_user'); end if;
  select count(*), coalesce(sum(tokens_in + tokens_out), 0) into v_day, v_tokens from public.ai_requests
   where company_id = p_company_id and created_at >= date_trunc('day', now());
  if v_day >= p_per_company_day then return jsonb_build_object('allowed', false, 'reason', 'rate_company'); end if;
  if p_engine = 'llm' and v_tokens >= p_company_day_tokens then return jsonb_build_object('allowed', false, 'reason', 'budget'); end if;
  insert into public.ai_requests (company_id, user_id, conversation_id, engine, model)
  values (p_company_id, auth.uid(), p_conversation_id, case when p_engine = 'llm' then 'llm' else 'offline' end, p_model)
  returning id into v_id;
  return jsonb_build_object('allowed', true, 'request_id', v_id);
end $$;
revoke execute on function public.ai_begin_request(uuid, uuid, text, int, int, bigint, text) from public, anon;

-- Токены только добавляются: занизить расход нельзя
create or replace function public.ai_finish_request(p_request_id uuid, p_tokens_in int, p_tokens_out int)
returns void language plpgsql security definer set search_path = '' as $$
begin
  update public.ai_requests
     set tokens_in = tokens_in + greatest(p_tokens_in, 0), tokens_out = tokens_out + greatest(p_tokens_out, 0)
   where id = p_request_id and user_id = auth.uid();
end $$;
revoke execute on function public.ai_finish_request(uuid, int, int) from public, anon;
