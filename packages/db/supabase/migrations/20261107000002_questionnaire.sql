-- Группа «Анкета»: версии, поля, услуги, сотрудники, FAQ, документы, чанки, снимки, вопросы без ответа.

create table public.questionnaires (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  version int not null,
  status text not null default 'draft' check (status in ('draft','published','archived')),
  completeness numeric(5,2) not null default 0,
  published_at timestamptz,
  published_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, version)
);
-- Один черновик на компанию
create unique index questionnaires_one_draft on public.questionnaires (company_id) where status = 'draft';

create table public.questionnaire_fields (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  questionnaire_id uuid not null references public.questionnaires(id) on delete cascade,
  block smallint not null check (block between 1 and 15),
  field_key text not null,
  value jsonb,
  source text not null default 'manual' check (source in ('manual','autofill_site','autofill_2gis','autofill_instagram','price_upload','voice','template')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (questionnaire_id, field_key)
);

create table public.services (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  questionnaire_id uuid not null references public.questionnaires(id) on delete cascade,
  name text not null,
  synonyms text[] not null default '{}',
  description text,
  price_type text not null check (price_type in ('exact','range','after_inspection')),
  price_min bigint check (price_min >= 0),
  price_max bigint check (price_max >= price_min),
  currency char(3) not null default 'KGS',
  duration_min int check (duration_min > 0),
  staff_ids uuid[] not null default '{}',
  branch_ids uuid[] not null default '{}',
  restrictions text,
  upsell text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- «после осмотра» не хранит чисел, чтобы AI не мог их назвать
  constraint services_price_shape check (
    (price_type = 'exact' and price_min is not null and price_max is null) or
    (price_type = 'range' and price_min is not null) or
    (price_type = 'after_inspection' and price_min is null and price_max is null))
);

create table public.staff (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  questionnaire_id uuid not null references public.questionnaires(id) on delete cascade,
  name text not null,
  specialties text[] not null default '{}',
  services uuid[] not null default '{}',
  branch_id uuid references public.branches(id),
  hours jsonb not null default '{}'::jsonb,
  transfer_phone text check (transfer_phone is null or transfer_phone ~ '^\+[1-9][0-9]{6,14}$'),
  languages text[] not null default '{ru}',
  bookable boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.faq (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  questionnaire_id uuid not null references public.questionnaires(id) on delete cascade,
  question text not null,
  synonyms text[] not null default '{}',
  short_answer text not null,
  long_answer text,
  source text not null default 'manual',
  active boolean not null default true,
  embedding vector(1536),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.documents (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  questionnaire_id uuid references public.questionnaires(id) on delete cascade,
  kind text not null check (kind in ('price','dialog_example','policy','other')),
  storage_path text not null,
  title text not null,
  status text not null default 'uploaded' check (status in ('uploaded','parsed','failed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.chunks (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  snapshot_version int not null,
  source_kind text not null,     -- field, service, faq, document
  source_id uuid,
  text text not null,
  embedding vector(1536),
  tsv tsvector generated always as (to_tsvector('russian', text)) stored,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index chunks_tsv_idx on public.chunks using gin (tsv);
create index chunks_embedding_idx on public.chunks using hnsw (embedding vector_cosine_ops);

-- Неизменяемый снимок опубликованной анкеты: его читает голос и чаты
create table public.kb_snapshots (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  version int not null,
  payload jsonb not null,
  greeting_audio_path text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, version)
);

create table public.unanswered_questions (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  text text not null,
  normalized text not null,
  count int not null default 1,
  last_seen_at timestamptz not null default now(),
  example_call_id uuid,
  resolved boolean not null default false,
  resolved_faq_id uuid references public.faq(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, normalized)
);

-- Редактировать анкету: собственник и админ (у админа проверка разрешения edit_questionnaire — в server action)
select private.apply_tenant_rls('questionnaires', array['owner','admin']);
select private.apply_tenant_rls('questionnaire_fields', array['owner','admin']);
select private.apply_tenant_rls('services', array['owner','admin']);
select private.apply_tenant_rls('staff', array['owner','admin']);
select private.apply_tenant_rls('faq', array['owner','admin']);
select private.apply_tenant_rls('documents', array['owner','admin']);
select private.apply_tenant_rls('chunks', array['owner']);
select private.apply_tenant_rls('kb_snapshots', array['owner']);
select private.apply_tenant_rls('unanswered_questions', array['owner','admin']);

-- Опубликованные версии неизменяемы
create or replace function private.forbid_published_change() returns trigger
language plpgsql set search_path = '' as $$
declare v_status text;
begin
  select q.status into v_status from public.questionnaires q
   where q.id = coalesce(new.questionnaire_id, old.questionnaire_id);
  if v_status <> 'draft' then
    raise exception 'questionnaire version is published and immutable' using errcode = '42501';
  end if;
  return coalesce(new, old);
end $$;
create trigger questionnaire_fields_immutable before insert or update or delete on public.questionnaire_fields for each row execute function private.forbid_published_change();
create trigger services_immutable before insert or update or delete on public.services for each row execute function private.forbid_published_change();
create trigger staff_immutable before insert or update or delete on public.staff for each row execute function private.forbid_published_change();
create trigger faq_immutable before insert or update or delete on public.faq for each row execute function private.forbid_published_change();

create or replace function private.forbid_snapshot_change() returns trigger
language plpgsql set search_path = '' as $$
begin
  raise exception 'kb_snapshots are immutable' using errcode = '42501';
end $$;
create trigger kb_snapshots_immutable before update on public.kb_snapshots for each row execute function private.forbid_snapshot_change();
