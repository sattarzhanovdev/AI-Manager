-- Очереди (pgmq), Realtime и Cron
create extension if not exists pgmq;
create extension if not exists pg_cron;

select pgmq.create('call_ended');        -- пост-обработка: резюме, карточка, учёт минут
select pgmq.create('lead_created');      -- уведомления
select pgmq.create('kb_published');      -- индексатор: чанки, эмбеддинги, приветствие, Redis
select pgmq.create('config_changed');    -- сброс кэша номеров в Redis
select pgmq.create('notify');            -- Telegram, email, push
select pgmq.create('chat_inbound');      -- чаты (1б)
select pgmq.create('integration_out');   -- исходящие события интеграций с повторами
select pgmq.create('erase_recordings');
select pgmq.create('demo_summary');      -- SMS со ссылкой на результат демо

alter publication supabase_realtime add table public.calls, public.leads, public.lead_events, public.notifications, public.conversations, public.messages, public.companies;

-- Заявки без ответственного дольше SLA → уведомление (повтор каждые 15 мин для срочных)
create or replace function private.sla_sweep() returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform pgmq.send('notify', jsonb_build_object('kind', 'lead_sla', 'company_id', l.company_id, 'lead_id', l.id))
    from public.leads l
   where l.status = 'new' and l.assignee_id is null and l.due_at < now()
     and not exists (select 1 from public.notifications n where n.entity_id = l.id and n.created_at > now() - interval '15 minutes');
end $$;
select cron.schedule('sla-sweep', '* * * * *', 'select private.sla_sweep()');
