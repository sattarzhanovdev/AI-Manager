-- MVP: права по членству без JWT-хука, защита platform_role, закрытые сервисные RPC,
-- история заявок, настройки ассистента и учёт AI-запросов изолированы по компаниям.
begin;
create extension if not exists pgtap;
select plan(22);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000a1', 'owner-a@test.local'),
  ('00000000-0000-0000-0000-0000000000b1', 'owner-b@test.local'),
  ('00000000-0000-0000-0000-0000000000a2', 'staff-a@test.local');
insert into public.profiles (id, full_name) values
  ('00000000-0000-0000-0000-0000000000a1', 'Owner A'),
  ('00000000-0000-0000-0000-0000000000b1', 'Owner B'),
  ('00000000-0000-0000-0000-0000000000a2', 'Staff A');
insert into public.companies (id, name, sphere) values
  ('10000000-0000-0000-0000-0000000000a1', 'A', 'autoservice'),
  ('10000000-0000-0000-0000-0000000000b1', 'B', 'autoservice');
insert into public.memberships (company_id, user_id, role) values
  ('10000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000a1', 'owner'),
  ('10000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000b1', 'owner'),
  ('10000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000a2', 'staff');
insert into public.contacts (id, company_id, phone, name) values
  ('30000000-0000-0000-0000-0000000000b1', '10000000-0000-0000-0000-0000000000b1', '+996700000002', 'Клиент B');
insert into public.leads (id, company_id, source, type, title) values
  ('40000000-0000-0000-0000-0000000000a1', '10000000-0000-0000-0000-0000000000a1', 'manual', 'booking', 'A'),
  ('40000000-0000-0000-0000-0000000000b1', '10000000-0000-0000-0000-0000000000b1', 'manual', 'booking', 'B');
insert into public.assistant_settings (company_id, settings) values
  ('10000000-0000-0000-0000-0000000000a1', '{"name":"A"}'), ('10000000-0000-0000-0000-0000000000b1', '{"name":"B"}');
insert into public.channels (id, company_id, type) values
  ('50000000-0000-0000-0000-0000000000a1', '10000000-0000-0000-0000-0000000000a1', 'widget'),
  ('50000000-0000-0000-0000-0000000000b1', '10000000-0000-0000-0000-0000000000b1', 'widget');
insert into public.conversations (id, company_id, channel_id, external_id) values
  ('60000000-0000-0000-0000-0000000000b1', '10000000-0000-0000-0000-0000000000b1', '50000000-0000-0000-0000-0000000000b1', 'test:b');

-- Владелец A с JWT без claim companies (хук не настроен) — доступ по memberships
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-0000-0000-0000000000a1', 'role', 'authenticated')::text, true);

select is((select count(*)::int from public.companies), 1, 'без хука владелец видит свою компанию');
select is((select count(*)::int from public.leads), 1, 'без хука видны только свои заявки');
select is((select count(*)::int from public.assistant_settings), 1, 'настройки ассистента чужой компании не видны');
select is((select count(*)::int from public.contacts where company_id = '10000000-0000-0000-0000-0000000000b1'), 0, 'контакты B не видны');

select throws_ok($$update public.profiles set platform_role = 'superadmin' where id = auth.uid()$$, '42501', null, 'нельзя выдать себе platform_role');
select is((select platform_role from public.profiles where id = auth.uid()), null, 'platform_role не изменился');

select throws_ok($$select public.resolve_number('+996700000000')$$, '42501', null, 'resolve_number закрыт для пользователей');
select throws_ok($$select public.get_snapshot('10000000-0000-0000-0000-0000000000b1')$$, '42501', null, 'get_snapshot закрыт для пользователей');
select throws_ok($$select public.check_limits('10000000-0000-0000-0000-0000000000b1')$$, '42501', null, 'check_limits закрыт для пользователей');
select throws_ok($$select public.clone_questionnaire_draft('10000000-0000-0000-0000-0000000000b1', gen_random_uuid(), 2)$$, '42501', null, 'clone_questionnaire_draft закрыт');
select throws_ok($$select public.erase_contact('10000000-0000-0000-0000-0000000000a1', '30000000-0000-0000-0000-0000000000b1')$$, 'P0002', null, 'erase_contact не удаляет контакт чужой компании');

-- Заявка с привязкой к чужому диалогу запрещена
select throws_ok($$select public.create_lead('10000000-0000-0000-0000-0000000000a1',
  '{"type":"booking","source":"chat","source_id":"60000000-0000-0000-0000-0000000000b1","fields":{"phone":"+996700111222"}}'::jsonb)$$,
  '42501', null, 'create_lead не связывает заявку с чужим диалогом');

-- AI-заявка: контакт создаётся, автор события — ai
select lives_ok($$select public.create_lead('10000000-0000-0000-0000-0000000000a1',
  '{"type":"booking","title":"Замена масла","source":"manual","actor_kind":"ai","fields":{"name":"Азамат","phone":"+996700111222","service":"Замена масла"}}'::jsonb, 'test-key-1')$$, 'create_lead создаёт заявку');
select is((select count(*)::int from public.contacts where phone = '+996700111222'), 1, 'контакт создан по телефону');
select is((select actor_kind from public.lead_events e join public.leads l on l.id = e.lead_id where l.idempotency_key = 'test-key-1'), 'ai', 'событие создания от AI');

-- Смена статуса пишет историю триггером
update public.leads set status = 'in_progress' where id = '40000000-0000-0000-0000-0000000000a1';
select is((select count(*)::int from public.lead_events where lead_id = '40000000-0000-0000-0000-0000000000a1' and action = 'status'), 1, 'смена статуса записана в историю');

-- Учёт AI: свой запрос регистрируется, лимит срабатывает, чужая компания запрещена
select is((public.ai_begin_request('10000000-0000-0000-0000-0000000000a1', null, 'offline', 1, 100, 1000) ->> 'allowed'), 'true', 'первый AI-запрос разрешён');
select is((public.ai_begin_request('10000000-0000-0000-0000-0000000000a1', null, 'offline', 1, 100, 1000) ->> 'reason'), 'rate_user', 'лимит запросов в минуту срабатывает');
select throws_ok($$select public.ai_begin_request('10000000-0000-0000-0000-0000000000b1', null, 'offline', 10, 100, 1000)$$, '42501', null, 'AI-запрос от имени чужой компании запрещён');

-- Сотрудник A: не меняет услуги/настройки ассистента, не видит учёт AI
select set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-0000-0000-0000000000a2', 'role', 'authenticated')::text, true);
update public.assistant_settings set settings = '{"name":"взлом"}' where company_id = '10000000-0000-0000-0000-0000000000a1';
select is((select settings ->> 'name' from public.assistant_settings where company_id = '10000000-0000-0000-0000-0000000000a1'), 'A', 'сотрудник не меняет настройки ассистента');
select is((select count(*)::int from public.ai_requests), 0, 'сотрудник не видит учёт AI');
select throws_ok($$select public.publish_questionnaire('10000000-0000-0000-0000-0000000000a1', '{}'::jsonb, '{}')$$, '42501', null, 'сотрудник не публикует базу знаний');

select * from finish();
rollback;
