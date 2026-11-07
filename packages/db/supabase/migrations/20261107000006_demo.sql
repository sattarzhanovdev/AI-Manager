-- Фаза 0: демо-линия. Глобальные таблицы платформы, доступ только команде платформы.
create table public.demo_roles (
  id uuid primary key default gen_random_uuid(),
  key text not null unique,      -- autoservice, clinic, salon, dental, polyclinic
  title text not null,
  snapshot jsonb not null,       -- анкета демо-компании
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.demo_calls (
  id uuid primary key default gen_random_uuid(),
  call_id uuid references public.calls(id) on delete set null,
  caller text not null,
  roles text[] not null default '{}',
  duration_s int not null default 0,
  cost_minor bigint not null default 0,
  summary_sent boolean not null default false,
  result_token text unique,
  payload jsonb not null default '{}'::jsonb,   -- расшифровка, карточка, заявка для /demo/[token]
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index demo_calls_caller_idx on public.demo_calls (caller, created_at desc);

create table public.demo_leads (
  id uuid primary key default gen_random_uuid(),
  phone text not null unique,
  calls int not null default 0,
  roles text[] not null default '{}',
  consent boolean not null default false,
  status text not null default 'new' check (status in ('new','contacted','meeting','won','lost')),
  owner_id uuid references auth.users(id),
  utm jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function public.is_platform(p_roles text[] default array['superadmin','support','sales']) returns boolean
language sql stable set search_path = '' as $$
  select coalesce(auth.jwt() ->> 'platform_role' = any (p_roles), false)
$$;

alter table public.demo_roles enable row level security;
alter table public.demo_calls enable row level security;
alter table public.demo_leads enable row level security;
create policy demo_roles_platform on public.demo_roles for all using (public.is_platform()) with check (public.is_platform(array['superadmin']));
create policy demo_calls_platform on public.demo_calls for select using (public.is_platform());
create policy demo_leads_platform on public.demo_leads for all using (public.is_platform()) with check (public.is_platform());

-- Ограничители демо: 5 звонков с номера в сутки, дневной бюджет
create table private.demo_settings (
  id boolean primary key default true check (id),
  daily_budget_minor bigint not null default 5000000,
  max_calls_per_day int not null default 5,
  max_duration_s int not null default 900
);
insert into private.demo_settings default values;

create or replace function public.demo_check(p_phone text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  s private.demo_settings;
  v_calls int;
  v_spent bigint;
begin
  select * into s from private.demo_settings;
  select count(*) into v_calls from public.demo_calls
   where caller = p_phone and created_at > now() - interval '1 day';
  select coalesce(sum(cost_minor), 0) into v_spent from public.demo_calls
   where created_at >= date_trunc('day', now());
  if v_calls >= s.max_calls_per_day then
    return jsonb_build_object('allowed', false, 'reason', 'phone_limit');
  end if;
  if v_spent >= s.daily_budget_minor then
    return jsonb_build_object('allowed', false, 'reason', 'budget');
  end if;
  return jsonb_build_object('allowed', true, 'max_duration_s', s.max_duration_s, 'calls_left', s.max_calls_per_day - v_calls);
end $$;
revoke execute on function public.demo_check from anon, authenticated, public;
