-- Фаза 1б: запись, талоны поликлиник, лист ожидания
create table public.resources (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  branch_id uuid references public.branches(id),
  kind text not null check (kind in ('staff','room','equipment')),
  name text not null,
  staff_id uuid references public.staff(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create extension if not exists btree_gist;

create table public.appointments (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  service_id uuid references public.services(id) on delete set null,
  staff_id uuid references public.staff(id) on delete set null,
  resource_id uuid not null references public.resources(id) on delete cascade,
  contact_id uuid references public.contacts(id) on delete set null,
  starts_at timestamptz not null,
  ends_at timestamptz not null check (ends_at > starts_at),
  status text not null default 'booked' check (status in ('held','booked','cancelled','done','no_show')),
  created_by_ai boolean not null default false,
  lead_id uuid references public.leads(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Ноль двойных записей: ресурс не может быть занят дважды в одно время
  constraint appointments_no_overlap exclude using gist (
    resource_id with =, tstzrange(starts_at, ends_at) with &&) where (status in ('held','booked'))
);

create table public.tickets (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  doctor_id uuid not null references public.staff(id) on delete cascade,
  starts_at timestamptz not null,
  opens_at timestamptz not null,
  status text not null default 'closed' check (status in ('closed','open','offered','taken','cancelled')),
  contact_id uuid references public.contacts(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (doctor_id, starts_at)
);

create table public.waitlist_entries (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  scope text not null,         -- специальность или услуга
  contact_id uuid not null references public.contacts(id) on delete cascade,
  position int not null,
  offered_at timestamptz,
  expires_at timestamptz,
  status text not null default 'waiting' check (status in ('waiting','offered','accepted','expired','removed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

select private.apply_tenant_rls('resources', array['owner','admin']);
select private.apply_tenant_rls('appointments', array['owner','admin','staff']);
select private.apply_tenant_rls('tickets', array['owner','admin']);
select private.apply_tenant_rls('waitlist_entries', array['owner','admin','staff']);
