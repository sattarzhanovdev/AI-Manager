-- Справочники: тарифы и демо-роли
insert into public.plans (id, key, name) values
  ('20000000-0000-0000-0000-000000000001', 'start', 'Старт'),
  ('20000000-0000-0000-0000-000000000002', 'business', 'Бизнес'),
  ('20000000-0000-0000-0000-000000000003', 'pro', 'Про');
insert into public.plan_versions (plan_id, version, limits, prices, published_at) values
  ('20000000-0000-0000-0000-000000000001', 1, '{"minutes":500,"ai_dialogs":0,"lines":1,"modes":["leads"]}',
   '{"KGS":{"amount_minor":690000,"overage_minute_minor":1800},"KZT":{"amount_minor":3900000,"overage_minute_minor":10000},"RUB":{"amount_minor":690000,"overage_minute_minor":1800}}', now()),
  ('20000000-0000-0000-0000-000000000002', 1, '{"minutes":1500,"ai_dialogs":1000,"lines":3,"modes":["leads","consult"]}',
   '{"KGS":{"amount_minor":1590000,"overage_minute_minor":1500},"KZT":{"amount_minor":8900000,"overage_minute_minor":8500},"RUB":{"amount_minor":1590000,"overage_minute_minor":1500}}', now()),
  ('20000000-0000-0000-0000-000000000003', 1, '{"minutes":4000,"ai_dialogs":5000,"lines":8,"modes":["leads","consult","booking","semi"]}',
   '{"KGS":{"amount_minor":3490000,"overage_minute_minor":1200},"KZT":{"amount_minor":19500000,"overage_minute_minor":7000},"RUB":{"amount_minor":3490000,"overage_minute_minor":1200}}', now());

insert into public.demo_roles (key, title, snapshot) values
  ('autoservice', 'Автосервис', '{"company":{"name":"Автосервис «Мотор»"},"assistant":{"name":"Айгуль"}}'),
  ('clinic', 'Клиника', '{"company":{"name":"Клиника «Здоровье»"},"assistant":{"name":"Алина"}}'),
  ('salon', 'Салон красоты', '{"company":{"name":"Салон «Лайм»"},"assistant":{"name":"Диана"}}'),
  ('dental', 'Стоматология', '{"company":{"name":"Стоматология «Смайл»"},"assistant":{"name":"Мира"}}'),
  ('polyclinic', 'Поликлиника', '{"company":{"name":"ЦСМ №7"},"assistant":{"name":"Нурия"}}');
