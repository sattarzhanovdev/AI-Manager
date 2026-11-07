# ALL-менеджер

Мультиарендная SaaS-платформа AI-администратора: ассистент отвечает на звонки компании голосом как живой человек,
консультирует по анкете, собирает заявки, переводит сложное человеку.

Источники правды — `docs/промпт.pdf` (мастер-промпт v1.0) и `docs/design.md` (визуальный стиль). Постоянные инструкции для ИИ — `CLAUDE.md`.

## Hackathon MVP

Рабочая демо-среда на Supabase: вход по email/паролю, AI-ассистент (голос в браузере и текст) создаёт настоящие заявки,
CRM (заявки, контакты, звонки, база знаний, аналитика) читает и пишет в базу под RLS.

- Что работает и как устроено — [docs/HACKATHON_MVP.md](docs/HACKATHON_MVP.md)
- Деплой GitHub → Vercel → Supabase Cloud, переменные окружения — [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)
- Сценарий показа для жюри — [docs/DEMO_SCRIPT.md](docs/DEMO_SCRIPT.md)
- Ограничения и план — [docs/REMAINING_WORK.md](docs/REMAINING_WORK.md)

```bash
pnpm install
cp .env.example apps/web/.env.local        # DATA_SOURCE=supabase + ключи Supabase
pnpm --filter @all/web provision:demo      # AutoCity Service + Demo Owner / Demo Staff (нужен SUPABASE_SERVICE_ROLE_KEY)
pnpm dev                                   # http://localhost:3000/login
```

## Быстрый старт без Supabase (только разработка)

`DATA_SOURCE=mock pnpm dev` — демо-данные в памяти. Вход: `/login` → `+996 555 100 200` (админ) или `+996 555 100 100`
(собственник, затем 2FA) → код `000000`. Mock-вход и переключатель ролей работают только в `next dev`
(в production-сборке выключены). Вебхуки каналов в mock требуют секрет (`TELEGRAM_WEBHOOK_SECRET`, `CHAT_WEBHOOK_SECRET`).

## Структура

| Папка | Что внутри |
| --- | --- |
| `apps/web` | Next.js 16: лендинг, `/login`, `/onboarding`, кабинет `/app` (включая «Чаты» и «Календарь» с талонами), суперадминка `/admin`, вебхуки `/api/webhooks` |
| `apps/voice` | Голосовой сервис: Python 3.12 + LiveKit Agents, охрана ответа, демо-режим, перевод по SIP |
| `apps/workers` | Воркеры pgmq: пост-обработка звонков, уведомления, индексатор, повторы и dead-letter |
| `packages/db` | Миграции Supabase (13), RLS на каждую таблицу, RPC, seed, тесты изоляции (pgTAP), доменные типы |
| `packages/dialog` | Промпт ассистента, JSON-схемы функций, охрана ответа, поиск по снимку, движок, анкета (15 блоков) |
| `packages/ui` | Токены (`tokens.css`) и компоненты: DataTable, SplitView, FilterBar, Sheet, Pill, KPI, UsageBar… |
| `packages/integrations` | Каркас интеграций, Telegram-уведомления, HMAC-вебхуки, расписание повторов |
| `eval` | 30 сценариев диалога, базовый прогон, регрессия > 2 п.п. роняет CI |

## Команды

```bash
pnpm dev            # веб
pnpm typecheck      # TypeScript strict во всех пакетах
pnpm lint
pnpm test           # vitest: dialog, integrations, workers, web
pnpm eval           # eval-набор диалогов
pnpm e2e            # Playwright, mock-режим; E2E_MODE=supabase E2E_URL=... — сценарии MVP (e2e/mvp.spec.ts)
cd packages/db && supabase start && supabase db reset && supabase test db   # схема + RLS-тесты
PGURL=postgres:///postgres bash packages/db/scripts/check-migrations.sh      # то же без Docker (Postgres + pgvector + pgTAP)
pnpm db:types       # сгенерировать типы Supabase
cd apps/voice && pip install -e ".[dev]" && pytest
```

## Подключение Supabase

1. `cd packages/db && supabase start && supabase db reset` — применит миграции и seed.
2. Заполнить `SUPABASE_*` и `NEXT_PUBLIC_SUPABASE_*` в `.env`, поставить `DATA_SOURCE=supabase`.
3. `pnpm --filter @all/web provision:demo` — демо-компания и аккаунты.
4. RLS проверяет членство по `memberships` (SECURITY DEFINER-функции); custom access token hook не обязателен.

Переменные окружения описаны в `.env.example` и проверяются zod-схемой при старте (`apps/web/lib/env.ts`, `apps/workers/src/env.ts`, `apps/voice/src/allvoice/config.py`).

## Дизайн

Тёмная тема по умолчанию (Dimension из `design.md`): холст `#0a0a0a`, хейрлайны вместо теней, пилюли, Geist для заголовков,
Inter для интерфейса (DM Sans не содержит кириллицы — используется рекомендованная замена), фиолетовый — только градиентной
полосой, тёплый→холодный горизонт — только на публичных страницах. Плотность кабинета — по разделу 03 промпта: текст 13px,
строки и поля 32px. Светлая тема — в меню пользователя.
