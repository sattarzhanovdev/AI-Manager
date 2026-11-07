# ALL-менеджер

Мультиарендная SaaS-платформа AI-администратора: ассистент отвечает на звонки компании голосом как живой человек,
консультирует по анкете, собирает заявки, переводит сложное человеку.

Источники правды — `docs/промпт.pdf` (мастер-промпт v1.0) и `docs/design.md` (визуальный стиль). Постоянные инструкции для ИИ — `CLAUDE.md`.

## Быстрый старт (демо-данные, без Supabase)

```bash
pnpm install
cp .env.example apps/web/.env.local     # DATA_SOURCE=mock
pnpm dev                                # http://localhost:3000
```

Вход: `/login` → телефон `+996 555 100 200` (админ) или `+996 555 100 100` (собственник, затем 2FA) → код `000000`.
В меню пользователя (слева внизу) можно войти под любой ролью — проверить права.
В «Чатах» внизу списка есть поле «Тест: сообщение от клиента» — так проверяется ответ AI, черновики и «Взять чат».
Вебхуки каналов: `POST /api/webhooks/chat/{telegram|whatsapp|widget}`. Симулятор присылает новый звонок
и заявку каждые ~40 с, пока открыт кабинет (`MOCK_SIMULATOR=off` — выключить).

## Структура

| Папка | Что внутри |
| --- | --- |
| `apps/web` | Next.js 16: лендинг, `/login`, `/onboarding`, кабинет `/app` (включая «Чаты» и «Календарь» с талонами), суперадминка `/admin`, вебхуки `/api/webhooks` |
| `apps/voice` | Голосовой сервис: Python 3.12 + LiveKit Agents, охрана ответа, демо-режим, перевод по SIP |
| `apps/workers` | Воркеры pgmq: пост-обработка звонков, уведомления, индексатор, повторы и dead-letter |
| `packages/db` | Миграции Supabase (12), RLS на каждую таблицу, RPC, seed, тест изоляции (pgTAP), доменные типы |
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
pnpm e2e            # Playwright (apps/web/e2e)
cd packages/db && supabase start && supabase db reset && supabase test db   # схема + RLS-тест
pnpm db:types       # сгенерировать типы Supabase
cd apps/voice && pip install -e ".[dev]" && pytest
```

## Подключение Supabase

1. `cd packages/db && supabase start && supabase db reset` — применит миграции и seed.
2. Заполнить `SUPABASE_*` и `NEXT_PUBLIC_SUPABASE_*` в `.env`, поставить `DATA_SOURCE=supabase`.
3. Custom access token hook (`public.custom_access_token_hook`) кладёт компании и роли в JWT — RLS читает их без подзапросов.

Переменные окружения описаны в `.env.example` и проверяются zod-схемой при старте (`apps/web/lib/env.ts`, `apps/workers/src/env.ts`, `apps/voice/src/allvoice/config.py`).

## Дизайн

Тёмная тема по умолчанию (Dimension из `design.md`): холст `#0a0a0a`, хейрлайны вместо теней, пилюли, Geist для заголовков,
Inter для интерфейса (DM Sans не содержит кириллицы — используется рекомендованная замена), фиолетовый — только градиентной
полосой, тёплый→холодный горизонт — только на публичных страницах. Плотность кабинета — по разделу 03 промпта: текст 13px,
строки и поля 32px. Светлая тема — в меню пользователя.
