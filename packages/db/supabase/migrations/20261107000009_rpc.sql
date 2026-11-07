-- RPC для голоса, воркеров и кабинета. Сервисные RPC принимают явный p_company_id.

-- Остаток лимитов за текущий период
create or replace function public.check_limits(p_company_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_sub public.subscriptions;
  v_limits jsonb;
  v_used numeric;
  v_total numeric;
begin
  select * into v_sub from public.subscriptions
   where company_id = p_company_id and status <> 'cancelled' and now() between period_start and period_end
   order by period_start desc limit 1;
  if v_sub.id is null then
    return jsonb_build_object('allowed', false, 'reason', 'no_subscription');
  end if;
  select pv.limits into v_limits from public.plan_versions pv where pv.id = v_sub.plan_version_id;
  select coalesce(sum(quantity), 0) into v_used from public.usage_records
   where company_id = p_company_id and kind = 'minutes' and period between v_sub.period_start::date and v_sub.period_end::date;
  v_total := (v_limits ->> 'minutes')::numeric + v_sub.extra_minutes;
  return jsonb_build_object(
    'allowed', v_used < v_total or v_sub.overage_policy = 'pay',
    'minutes_used', v_used,
    'minutes_total', v_total,
    'ratio', case when v_total > 0 then round(v_used / v_total, 3) else 1 end,
    'overage_policy', v_sub.overage_policy);
end $$;

-- Голос: в начале звонка определяет компанию и режим по номеру
create or replace function public.resolve_number(p_e164 text) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'company_id', n.company_id,
    'number_id', n.id,
    'branch_id', n.branch_id,
    'ai_mode', case when c.ai_mode = 'on' then n.ai_mode else c.ai_mode end,
    'schedule', n.schedule,
    'timezone', c.timezone,
    'kb_version', (select max(s.version) from public.kb_snapshots s where s.company_id = n.company_id),
    'limits', public.check_limits(n.company_id))
  from public.phone_numbers n join public.companies c on c.id = n.company_id
  where n.e164 = p_e164 and c.status = 'active'
$$;

create or replace function public.get_snapshot(p_company_id uuid, p_version int default null) returns jsonb
language sql stable security definer set search_path = '' as $$
  select s.payload from public.kb_snapshots s
   where s.company_id = p_company_id
     and (p_version is null or s.version = p_version)
   order by s.version desc limit 1
$$;

-- Создание заявки из голоса/чата/кабинета. Идемпотентно по p_idempotency_key.
create or replace function public.create_lead(p_company_id uuid, p_payload jsonb, p_idempotency_key text default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
  v_contact uuid;
  v_phone text := p_payload -> 'fields' ->> 'phone';
begin
  if auth.role() <> 'service_role' and not public.has_role(p_company_id, array['owner','admin','staff']) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_idempotency_key is not null then
    select id into v_id from public.leads where idempotency_key = p_idempotency_key;
    if v_id is not null then return v_id; end if;
  end if;
  if v_phone is not null then
    insert into public.contacts (company_id, phone, name)
    values (p_company_id, v_phone, p_payload -> 'fields' ->> 'name')
    on conflict (company_id, phone) where phone is not null
      do update set last_seen_at = now(), interactions_count = public.contacts.interactions_count + 1,
                    name = coalesce(public.contacts.name, excluded.name)
    returning id into v_contact;
  end if;
  insert into public.leads (company_id, source, source_id, channel, type, title, priority, contact_id, payload, idempotency_key, due_at)
  values (p_company_id,
          coalesce(p_payload ->> 'source', 'manual'),
          (p_payload ->> 'source_id')::uuid,
          p_payload ->> 'channel',
          p_payload ->> 'type',
          coalesce(p_payload ->> 'title', 'Заявка'),
          coalesce(p_payload ->> 'priority', 'normal'),
          v_contact,
          coalesce(p_payload -> 'fields', '{}'::jsonb),
          p_idempotency_key,
          now() + case when p_payload ->> 'priority' = 'urgent' then interval '15 minutes' else interval '2 hours' end)
  returning id into v_id;
  insert into public.lead_events (company_id, lead_id, actor_kind, action, after)
  values (p_company_id, v_id, case when auth.role() = 'service_role' then 'ai' else 'user' end, 'created', p_payload);
  perform pgmq.send('lead_created', jsonb_build_object('company_id', p_company_id, 'lead_id', v_id));
  return v_id;
end $$;

-- Индекс полноты по весам блоков (раздел 14)
create or replace function public.block_weights() returns jsonb language sql immutable as $$
  select '{"1":5,"2":10,"3":18,"4":8,"5":10,"6":5,"7":2,"8":10,"9":6,"10":5,"11":5,"12":4,"13":4,"14":4,"15":4}'::jsonb
$$;

-- Публикация: обязательные поля → новая версия → снимок → событие на сборку голоса.
-- Текущие звонки доигрывают на старой версии (они держат снимок в памяти).
create or replace function public.publish_questionnaire(p_company_id uuid, p_payload jsonb, p_missing text[])
returns int language plpgsql security definer set search_path = '' as $$
declare
  v_draft public.questionnaires;
  v_version int;
begin
  if not public.has_role(p_company_id, array['owner']) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if coalesce(array_length(p_missing, 1), 0) > 0 then
    raise exception 'required fields missing: %', array_to_string(p_missing, ', ') using errcode = '23514';
  end if;
  select * into v_draft from public.questionnaires where company_id = p_company_id and status = 'draft' for update;
  update public.questionnaires set status = 'archived' where company_id = p_company_id and status = 'published';
  update public.questionnaires set status = 'published', published_at = now(), published_by = auth.uid()
   where id = v_draft.id;
  v_version := v_draft.version;
  insert into public.kb_snapshots (company_id, version, payload) values (p_company_id, v_version, p_payload);
  perform public.clone_questionnaire_draft(p_company_id, v_draft.id, v_version + 1);
  perform pgmq.send('kb_published', jsonb_build_object('company_id', p_company_id, 'version', v_version));
  insert into public.audit_log (company_id, actor_id, action, entity, entity_id, after)
  values (p_company_id, auth.uid(), 'publish', 'questionnaire', v_draft.id, jsonb_build_object('version', v_version));
  return v_version;
end $$;

-- Новый черновик = копия опубликованной версии
create or replace function public.clone_questionnaire_draft(p_company_id uuid, p_from uuid, p_version int)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_new uuid;
begin
  insert into public.questionnaires (company_id, version, status, completeness)
  select company_id, p_version, 'draft', completeness from public.questionnaires where id = p_from
  returning id into v_new;
  insert into public.questionnaire_fields (company_id, questionnaire_id, block, field_key, value, source)
  select company_id, v_new, block, field_key, value, source from public.questionnaire_fields where questionnaire_id = p_from;
  insert into public.services (company_id, questionnaire_id, name, synonyms, description, price_type, price_min, price_max, currency, duration_min, staff_ids, branch_ids, restrictions, upsell, active)
  select company_id, v_new, name, synonyms, description, price_type, price_min, price_max, currency, duration_min, staff_ids, branch_ids, restrictions, upsell, active from public.services where questionnaire_id = p_from;
  insert into public.staff (company_id, questionnaire_id, name, specialties, services, branch_id, hours, transfer_phone, languages, bookable)
  select company_id, v_new, name, specialties, services, branch_id, hours, transfer_phone, languages, bookable from public.staff where questionnaire_id = p_from;
  insert into public.faq (company_id, questionnaire_id, question, synonyms, short_answer, long_answer, source, active, embedding)
  select company_id, v_new, question, synonyms, short_answer, long_answer, source, active, embedding from public.faq where questionnaire_id = p_from;
  return v_new;
end $$;

-- Откат: новая версия с содержимым старого снимка (история не переписывается)
create or replace function public.rollback_questionnaire(p_company_id uuid, p_version int)
returns int language plpgsql security definer set search_path = '' as $$
declare v_payload jsonb; v_next int;
begin
  if not public.has_role(p_company_id, array['owner']) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  select payload into v_payload from public.kb_snapshots where company_id = p_company_id and version = p_version;
  if v_payload is null then raise exception 'version not found'; end if;
  select coalesce(max(version), 0) + 1 into v_next from public.kb_snapshots where company_id = p_company_id;
  insert into public.kb_snapshots (company_id, version, payload) values (p_company_id, v_next, v_payload);
  perform pgmq.send('kb_published', jsonb_build_object('company_id', p_company_id, 'version', v_next, 'rollback_of', p_version));
  insert into public.audit_log (company_id, actor_id, action, entity, after)
  values (p_company_id, auth.uid(), 'rollback', 'questionnaire', jsonb_build_object('to', p_version, 'as', v_next));
  return v_next;
end $$;

-- Переключатель AI: применяется к новым звонкам (голос читает режим при resolve_number), пишется в аудит
create or replace function public.set_ai_mode(p_company_id uuid, p_mode public.ai_mode)
returns void language plpgsql security definer set search_path = '' as $$
declare v_before public.ai_mode;
begin
  if not public.has_role(p_company_id, array['owner','admin']) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  select ai_mode into v_before from public.companies where id = p_company_id;
  update public.companies set ai_mode = p_mode where id = p_company_id;
  insert into public.audit_log (company_id, actor_id, action, entity, entity_id, before, after)
  values (p_company_id, auth.uid(), 'ai_mode', 'company', p_company_id, to_jsonb(v_before), to_jsonb(p_mode));
  perform pgmq.send('config_changed', jsonb_build_object('company_id', p_company_id));
end $$;

-- Удаление данных звонящего по запросу: аудио, расшифровки, сообщения
create or replace function public.erase_contact(p_company_id uuid, p_contact_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_phone text;
begin
  if not public.has_role(p_company_id, array['owner']) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  select phone into v_phone from public.contacts where id = p_contact_id and company_id = p_company_id;
  perform pgmq.send('erase_recordings', jsonb_build_object('company_id', p_company_id,
    'paths', (select coalesce(jsonb_agg(recording_path), '[]'::jsonb) from public.calls where contact_id = p_contact_id and recording_path is not null)));
  delete from public.call_turns t using public.calls c where t.call_id = c.id and c.contact_id = p_contact_id;
  update public.calls set recording_path = null, summary = null, caller = '+0000000', contact_id = null where contact_id = p_contact_id;
  delete from public.messages m using public.conversations cv where m.conversation_id = cv.id and cv.contact_id = p_contact_id;
  delete from public.contacts where id = p_contact_id;
  insert into public.audit_log (company_id, actor_id, action, entity, entity_id, before)
  values (p_company_id, auth.uid(), 'erase', 'contact', p_contact_id, jsonb_build_object('phone_masked', left(v_phone, 4) || '****'));
end $$;
