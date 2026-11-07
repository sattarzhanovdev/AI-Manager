# Развёртывание: GitHub → Vercel → Next.js → Supabase Cloud

## 1. Что понадобится

| Доступ | Зачем |
| --- | --- |
| Supabase: проект (Free подходит) + **Access Token** или пароль БД | применить миграции, создать аккаунты |
| Supabase **Project URL**, **anon/publishable key** | веб-приложение (браузер и сервер) |
| Supabase **service_role / secret key** | только provisioning-скрипт (локально), в Vercel не нужен |
| Vercel: аккаунт с доступом к репозиторию GitHub | сборка и хостинг |
| (необязательно) `ANTHROPIC_API_KEY` или `OPENAI_API_KEY` | внешняя LLM; без ключа — локальный движок |

## 2. Переменные окружения

| Переменная | Где | Обязательно | Описание |
| --- | --- | --- | --- |
| `DATA_SOURCE` | Vercel | да | `supabase` |
| `APP_URL` | Vercel | да | `https://<project>.vercel.app` |
| `SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_URL` | Vercel | да | Project URL |
| `SUPABASE_ANON_KEY`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Vercel | да | anon / publishable key |
| `SUPABASE_SERVICE_ROLE_KEY` | только локально | для provisioning | секретный ключ; не добавлять в браузерные переменные |
| `ANTHROPIC_API_KEY` или `OPENAI_API_KEY` | Vercel | нет | ключ LLM (только сервер) |
| `LLM_PROVIDER`, `LLM_MODEL` | Vercel | нет | по умолчанию `claude-haiku-5-5` / `gpt-4.1-mini` |
| `AI_RATE_PER_USER_MINUTE`, `AI_RATE_PER_COMPANY_DAY`, `AI_DAILY_TOKEN_BUDGET`, `AI_MAX_OUTPUT_TOKENS` | Vercel | нет | лимиты частоты и расходов (20 / 600 / 400 000 / 350) |
| `DEMO_ENVIRONMENT` | Vercel | нет | `1` — метка Demo Environment |
| `DEMO_OWNER_EMAIL`, `DEMO_OWNER_PASSWORD`, `DEMO_STAFF_EMAIL`, `DEMO_STAFF_PASSWORD` | только локально | нет | аккаунты жюри; без паролей — генерируются |

Полный список — `.env.example`.

## 3. База данных (Supabase Cloud)

```bash
cd packages/db
npx supabase@latest login                       # или SUPABASE_ACCESS_TOKEN=...
npx supabase@latest link --project-ref <ref>
npx supabase@latest db push                     # 13 миграций; удалённые данные не удаляются
```

`db push` применяет только новые миграции и не выполняет `seed.sql` (тарифы создаёт provisioning).
**Не используйте `supabase db reset --linked` на облачной базе** — это удалит данные. Перед изменениями
существующей продовой базы сделайте резервную копию (Database → Backups).

Настройки Supabase Dashboard:
- **Authentication → Providers → Email**: включён; *Allow new users to sign up* — **выключить** (аккаунты создаёт скрипт).
- **Authentication → URL Configuration**: *Site URL* = `https://<project>.vercel.app`; *Redirect URLs* — `https://<project>.vercel.app/**`
  (вход по паролю редиректы не использует, но значения должны указывать на прод, а не на localhost).
- **Authentication → Hooks** — custom access token hook *не обязателен*: RLS проверяет членство по таблице `memberships`.
- **Database → Extensions**: `vector`, `pg_trgm`, `pgcrypto`, `btree_gist`, `pgmq`, `pg_cron` включаются миграциями.

## 4. Демо-компания и аккаунты

```bash
SUPABASE_URL=https://<ref>.supabase.co \
SUPABASE_SERVICE_ROLE_KEY=<service_role> \
APP_URL=https://<project>.vercel.app \
pnpm --filter @all/web provision:demo --out ../../HACKATHON_ACCESS.md
```

- Пароли берутся из `DEMO_*_PASSWORD` или генерируются и печатаются один раз; `--reset-passwords` — выдать новые.
- Файл `HACKATHON_ACCESS.md` в `.gitignore`, создаётся с правами 600. Передайте его жюри отдельно (не в публичном репозитории).
- Скрипт идемпотентен: повторный запуск не дублирует записи и не перезаписывает изменения из кабинета.
- `--with-isolation-fixture` добавляет вторую компанию для e2e-проверки изоляции (на проде не обязательно).

## 5. Vercel

1. New Project → Import `sattarzhanovdev/AI-Manager`.
2. **Root Directory: `apps/web`** (Framework: Next.js). Install/Build берутся из `apps/web/vercel.json`
   (`pnpm install --frozen-lockfile`, `pnpm build`); pnpm ставит весь workspace, пакеты `@all/*` транспилируются Next.js.
3. Node.js 22 или 24. Environment Variables — из таблицы выше (Production).
4. Deploy. После деплоя: обновить `APP_URL` и Site URL в Supabase, при необходимости перезапустить деплой.

Приложение не хранит состояние в памяти процесса: сессия — в cookies Supabase, диалоги, заявки и лимиты AI — в базе.
Realtime через SSE из памяти в режиме supabase выключен (на Vercel несколько инстансов); данные обновляются при переходах и после действий.

## 6. Проверка после деплоя (smoke)

```bash
cd apps/web
E2E_MODE=supabase E2E_URL=https://<project>.vercel.app \
E2E_OWNER_EMAIL=... E2E_OWNER_PASSWORD=... E2E_STAFF_EMAIL=... E2E_STAFF_PASSWORD=... \
E2E_SUPABASE_URL=https://<ref>.supabase.co E2E_SUPABASE_ANON_KEY=<anon> \
pnpm e2e
```

Сценарий 9 использует фикстуру изоляции; без `--with-isolation-fixture` проверка «чужой заявки» всё равно проходит
(запись не найдена = 404). Тесты создают тестовые заявки и FAQ с суффиксом запуска — это видно в CRM.

## 7. Локальный запуск

```bash
pnpm install
cd packages/db && npx supabase@latest start && npx supabase@latest db reset   # нужен Docker
npx supabase@latest status -o env                                            # ключи
cd ../.. && cp .env.example apps/web/.env.local   # DATA_SOURCE=supabase + ключи из status
SUPABASE_URL=http://127.0.0.1:54321 SUPABASE_SERVICE_ROLE_KEY=... pnpm --filter @all/web provision:demo
pnpm dev                                          # http://localhost:3000
```

Без Docker миграции и RLS-тесты можно проверить на обычном Postgres 15+ с pgvector и pgTAP:
`PGURL=postgres:///postgres bash packages/db/scripts/check-migrations.sh`.

Без Supabase вообще: `DATA_SOURCE=mock pnpm dev` — демо-данные в памяти, вход по коду 000000 (только разработка).

## 8. CI (GitHub Actions)

`.github/workflows/ci.yml`: typecheck · lint · unit · eval · build; `supabase db reset` + `supabase test db`;
e2e против локального Supabase (provisioning дважды — проверка идемпотентности); pytest голосового сервиса.

## 9. От демо к коммерческому production

- Отдельные проекты Supabase для staging и prod (Pro-план: бэкапы PITR, без паузы), миграции только через CI (`supabase db push` с токеном в секретах).
- Включить custom access token hook для ускорения RLS на больших объёмах (функции уже совместимы).
- Ключи LLM — в Vercel Encrypted Env/Vault; лимиты `AI_*` под тариф; мониторинг стоимости (Langfuse).
- Sentry для web и workers; алерты по ошибкам `[ai]`, `[action]`.
- Подключить телефонию (`apps/voice`, LiveKit SIP) и воркеры очередей (`apps/workers`, pgmq) — схема и RPC уже есть.
- Регистрация компаний, приглашения команды, биллинг — разделы есть в коде (mock), их нужно подключить к базе.
- Домен, политика конфиденциальности, согласие на обработку ПДн, ротация секретов, отключение демо-аккаунтов.
