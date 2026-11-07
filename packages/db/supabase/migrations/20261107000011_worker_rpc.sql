-- RPC для воркеров (сервисная роль, явный company_id)

create or replace function public.upsert_unanswered(p_company_id uuid, p_text text, p_call_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_norm text := lower(regexp_replace(trim(p_text), '[^[:alnum:][:space:]]', '', 'g'));
begin
  if auth.role() <> 'service_role' then raise exception 'forbidden' using errcode = '42501'; end if;
  insert into public.unanswered_questions (company_id, text, normalized, example_call_id)
  values (p_company_id, p_text, v_norm, p_call_id)
  on conflict (company_id, normalized) do update
    set count = public.unanswered_questions.count + 1, last_seen_at = now(), resolved = false;
end $$;
revoke execute on function public.upsert_unanswered from anon, authenticated, public;

-- Продление видимости сообщения pgmq до следующей попытки (расписание повторов)
create or replace function public.pgmq_set_vt(queue_name text, msg_id bigint, vt integer)
returns void language sql security definer set search_path = '' as $$
  select pgmq.set_vt(queue_name, msg_id, vt);
$$;
revoke execute on function public.pgmq_set_vt from anon, authenticated, public;

-- Очереди ошибок (dead-letter) для каждой рабочей очереди
select pgmq.create(q || '_dead') from unnest(array['call_ended','lead_created','kb_published','notify','integration_out','demo_summary','erase_recordings']) as q;
