-- Фаза 1б: чаты и календарь — доработки схемы под экраны «Чаты» и «Календарь»

-- Состояние движка диалога для чата (собранные поля, число непонятых реплик)
alter table public.conversations add column if not exists dialog_state jsonb not null default '{}'::jsonb;
alter table public.conversations add column if not exists needs_human boolean not null default false;
alter table public.conversations add column if not exists tags text[] not null default '{}';
create index if not exists conversations_company_last_idx on public.conversations (company_id, last_message_at desc);

-- Блокировка времени — тоже запись в сетке, участвует в проверке пересечений
alter table public.appointments drop constraint if exists appointments_status_check;
alter table public.appointments add constraint appointments_status_check check (status in ('held','booked','cancelled','done','no_show','blocked'));
alter table public.appointments add column if not exists note text;
alter table public.appointments drop constraint if exists appointments_no_overlap;
alter table public.appointments add constraint appointments_no_overlap exclude using gist (
  resource_id with =, tstzrange(starts_at, ends_at) with &&) where (status in ('held','booked','blocked'));

-- Исключения графика ресурса (праздник, отпуск, ремонт оборудования)
create table if not exists public.schedule_exceptions (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  resource_id uuid references public.resources(id) on delete cascade,
  starts_at timestamptz not null,
  ends_at timestamptz not null check (ends_at > starts_at),
  reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
select private.apply_tenant_rls('schedule_exceptions', array['owner','admin']);

-- Запись из звонка/чата: атомарная проверка слота (двойная запись невозможна благодаря exclusion constraint)
create or replace function public.book_slot(p_company_id uuid, p_resource_id uuid, p_service_id uuid, p_starts_at timestamptz, p_ends_at timestamptz, p_contact_id uuid, p_by_ai boolean default false)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  if auth.role() <> 'service_role' and not public.has_role(p_company_id, array['owner','admin','staff']) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  insert into public.appointments (company_id, resource_id, service_id, starts_at, ends_at, contact_id, created_by_ai)
  values (p_company_id, p_resource_id, p_service_id, p_starts_at, p_ends_at, p_contact_id, p_by_ai)
  returning id into v_id;
  return v_id;
exception when exclusion_violation then
  raise exception 'slot_taken' using errcode = '23P01';
end $$;

-- Освободившийся талон → предложение первому в листе ожидания (вызывается триггером, ≤ 1 мин)
create or replace function private.offer_freed_ticket() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_entry public.waitlist_entries;
begin
  if new.status = 'open' and old.status in ('taken','offered') then
    select w.* into v_entry from public.waitlist_entries w
      join public.staff s on s.id = new.doctor_id
     where w.company_id = new.company_id and w.status = 'waiting' and w.scope = any (s.specialties)
     order by w.position limit 1 for update skip locked;
    if v_entry.id is not null then
      update public.waitlist_entries set status = 'offered', offered_at = now(), expires_at = now() + interval '15 minutes' where id = v_entry.id;
      new.status := 'offered';
      new.contact_id := v_entry.contact_id;
      perform pgmq.send('notify', jsonb_build_object('kind', 'waitlist_offer', 'company_id', new.company_id, 'entry_id', v_entry.id, 'ticket_id', new.id));
    end if;
  end if;
  return new;
end $$;
drop trigger if exists tickets_offer_freed on public.tickets;
create trigger tickets_offer_freed before update on public.tickets for each row execute function private.offer_freed_ticket();

-- Просроченные предложения освобождают талон для следующего
create or replace function private.expire_offers() returns void
language plpgsql security definer set search_path = '' as $$
begin
  update public.waitlist_entries set status = 'expired' where status = 'offered' and expires_at < now();
  update public.tickets t set status = 'open', contact_id = null
   where t.status = 'offered' and not exists (select 1 from public.waitlist_entries w where w.company_id = t.company_id and w.contact_id = t.contact_id and w.status = 'offered');
end $$;
select cron.schedule('expire-waitlist-offers', '* * * * *', 'select private.expire_offers()');

select pgmq.create('chat_outbound');
select pgmq.create('chat_inbound_dead');
select pgmq.create('chat_outbound_dead');
alter publication supabase_realtime add table public.appointments, public.tickets, public.waitlist_entries;
