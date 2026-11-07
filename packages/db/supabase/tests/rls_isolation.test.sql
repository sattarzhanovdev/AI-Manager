-- Тест изоляции: две компании, чужие данные не читаются и не пишутся.
-- Запуск: supabase test db
begin;
create extension if not exists pgtap;
select plan(14);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000000a', 'a@test.local'),
  ('00000000-0000-0000-0000-00000000000b', 'b@test.local'),
  ('00000000-0000-0000-0000-00000000000c', 'staff-a@test.local');
insert into public.companies (id, name, sphere) values
  ('10000000-0000-0000-0000-00000000000a', 'Компания A', 'autoservice'),
  ('10000000-0000-0000-0000-00000000000b', 'Компания B', 'clinic');
insert into public.memberships (company_id, user_id, role) values
  ('10000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-00000000000a', 'owner'),
  ('10000000-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-00000000000b', 'owner'),
  ('10000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-00000000000c', 'staff');
insert into public.contacts (company_id, phone, name) values
  ('10000000-0000-0000-0000-00000000000a', '+996555000001', 'Клиент A'),
  ('10000000-0000-0000-0000-00000000000b', '+996555000002', 'Клиент B');
insert into public.leads (company_id, source, type, title, assignee_id) values
  ('10000000-0000-0000-0000-00000000000a', 'call', 'booking', 'A свободная', null),
  ('10000000-0000-0000-0000-00000000000a', 'call', 'booking', 'A чужая для сотрудника', '00000000-0000-0000-0000-00000000000a'),
  ('10000000-0000-0000-0000-00000000000b', 'call', 'booking', 'B', null);
insert into public.questionnaires (company_id, version) values
  ('10000000-0000-0000-0000-00000000000a', 1), ('10000000-0000-0000-0000-00000000000b', 1);

-- Пользователь A
set local role authenticated;
select set_config('request.jwt.claims', json_build_object(
  'sub', '00000000-0000-0000-0000-00000000000a', 'role', 'authenticated',
  'companies', json_build_object('10000000-0000-0000-0000-00000000000a', 'owner'))::text, true);

select is((select count(*)::int from public.companies), 1, 'A видит только свою компанию');
select is((select count(*)::int from public.contacts), 1, 'A видит только свои контакты');
select is((select count(*)::int from public.leads), 2, 'A видит только свои заявки');
select is((select count(*)::int from public.questionnaires), 1, 'A видит только свою анкету');
select throws_ok(
  $$insert into public.contacts (company_id, phone) values ('10000000-0000-0000-0000-00000000000b', '+996555999999')$$,
  '42501', null, 'A не может писать в компанию B');
update public.leads set title = 'взлом' where company_id = '10000000-0000-0000-0000-00000000000b';
select is((select count(*)::int from public.leads where title = 'взлом'), 0, 'A не может менять заявки B');
select is((select count(*)::int from public.audit_log), 0, 'аудит чужой компании не виден');
select throws_ok(
  $$select public.set_ai_mode('10000000-0000-0000-0000-00000000000b', 'off')$$,
  '42501', null, 'RPC set_ai_mode проверяет компанию');
select throws_ok(
  $$select public.create_lead('10000000-0000-0000-0000-00000000000b', '{"type":"booking","fields":{}}'::jsonb)$$,
  '42501', null, 'RPC create_lead проверяет компанию');

-- Сотрудник A видит только свои и свободные заявки, не видит счета
select set_config('request.jwt.claims', json_build_object(
  'sub', '00000000-0000-0000-0000-00000000000c', 'role', 'authenticated',
  'companies', json_build_object('10000000-0000-0000-0000-00000000000a', 'staff'))::text, true);
select is((select count(*)::int from public.leads), 1, 'сотрудник видит только свободные и свои заявки');
select is((select count(*)::int from public.invoices), 0, 'сотрудник не видит счета');
select throws_ok(
  $$select public.publish_questionnaire('10000000-0000-0000-0000-00000000000a', '{}'::jsonb, '{}')$$,
  '42501', null, 'сотрудник не публикует анкету');

-- Аноним не видит ничего
select set_config('request.jwt.claims', '{"role":"anon"}', true);
set local role anon;
select is((select count(*)::int from public.leads), 0, 'аноним не видит заявки');
select is((select count(*)::int from public.contacts), 0, 'аноним не видит контакты');

select * from finish();
rollback;
