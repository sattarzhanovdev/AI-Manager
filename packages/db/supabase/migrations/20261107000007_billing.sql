-- Группа «Биллинг». Деньги — целые минорные единицы + currency.
create table public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  plan_version_id uuid not null references public.plan_versions(id),
  currency char(3) not null,
  period_start timestamptz not null,
  period_end timestamptz not null,
  overage_policy text not null default 'stop_ai' check (overage_policy in ('pay','stop_ai')),
  overage_cap_minor bigint,
  status text not null default 'active' check (status in ('active','past_due','cancelled')),
  extra_minutes int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.usage_records (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  kind text not null check (kind in ('minutes','ai_dialogs','lines','sms')),
  quantity numeric(12,2) not null,
  cost_minor bigint not null default 0,
  currency char(3) not null default 'USD',
  period date not null,
  source_id uuid,
  idempotency_key text not null unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.invoices (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  number text not null unique,
  period_start date not null,
  period_end date not null,
  amount_minor bigint not null,
  currency char(3) not null,
  status text not null default 'issued' check (status in ('draft','issued','paid','overdue','void')),
  pdf_path text,
  due_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.payments (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  invoice_id uuid references public.invoices(id),
  amount_minor bigint not null,
  currency char(3) not null,
  method text not null check (method in ('bank_transfer','card','manual')),
  external_id text unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

select private.apply_tenant_rls('subscriptions', array['owner']);
select private.apply_tenant_rls('usage_records', array['owner']);
select private.apply_tenant_rls('invoices', array['owner']);
select private.apply_tenant_rls('payments', array['owner']);

-- Тариф и счета видят собственник и бухгалтер
drop policy subscriptions_select on public.subscriptions;
create policy subscriptions_select on public.subscriptions for select using (public.has_role(company_id, array['owner','admin','accountant']));
drop policy invoices_select on public.invoices;
create policy invoices_select on public.invoices for select using (public.has_role(company_id, array['owner','accountant']));
drop policy payments_select on public.payments;
create policy payments_select on public.payments for select using (public.has_role(company_id, array['owner','accountant']));
