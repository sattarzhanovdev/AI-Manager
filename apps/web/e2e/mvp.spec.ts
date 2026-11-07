import { expect, test, type Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";

/**
 * Hackathon MVP: сквозные сценарии против настоящего Supabase (DATA_SOURCE=supabase).
 * Нужны: E2E_OWNER_EMAIL/PASSWORD, E2E_STAFF_EMAIL/PASSWORD (аккаунты из provision:demo),
 * E2E_SUPABASE_URL/E2E_SUPABASE_ANON_KEY — прямая проверка сохранения в базе под JWT владельца.
 * Запуск: E2E_MODE=supabase E2E_URL=https://... pnpm e2e
 */
const OWNER = { email: process.env.E2E_OWNER_EMAIL ?? "demo.owner@example.com", password: process.env.E2E_OWNER_PASSWORD ?? "" };
const STAFF = { email: process.env.E2E_STAFF_EMAIL ?? "demo.staff@example.com", password: process.env.E2E_STAFF_PASSWORD ?? "" };
// Фикстура изоляции из `provision:demo --with-isolation-fixture` (детерминированный id)
const FOREIGN_LEAD = "77d761eb-684e-592a-9123-e591e8792f07";
const RUN = Date.now().toString(36);

test.describe.configure({ mode: "serial" });

async function login(page: Page, who = OWNER) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(who.email);
  await page.getByLabel("Пароль").fill(who.password);
  await page.getByRole("button", { name: "Войти" }).click();
  await page.waitForURL("**/app");
}

/** Supabase под JWT пользователя: та же RLS, что у кабинета */
async function db(who = OWNER) {
  const url = process.env.E2E_SUPABASE_URL, key = process.env.E2E_SUPABASE_ANON_KEY;
  if (!url || !key) return null;
  const sb = createClient(url, key, { auth: { persistSession: false } });
  const { error } = await sb.auth.signInWithPassword(who);
  if (error) throw error;
  return sb;
}

async function say(page: Page, text: string) {
  const before = await page.locator('[data-speaker="ai"]').count();
  await page.getByTestId("chat-input").fill(text);
  await page.getByTestId("chat-send").click();
  await expect(page.locator('[data-speaker="ai"]')).toHaveCount(before + 1, { timeout: 30_000 });
  return (await page.locator('[data-speaker="ai"]').last().innerText()).trim();
}

test("1. вход с корректными данными, метка Demo Environment", async ({ page }) => {
  await login(page);
  await expect(page.getByRole("heading", { name: "Обзор" })).toBeVisible();
  await expect(page.getByTestId("demo-env")).toBeVisible();
  await expect(page.getByTestId("leads-by-status")).toBeVisible();
});

test("2. неверный пароль — ошибка, остаёмся на /login", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Email").fill(OWNER.email);
  await page.getByLabel("Пароль").fill("wrong-password-123");
  await page.getByRole("button", { name: "Войти" }).click();
  await expect(page.getByTestId("login-error")).toHaveText("Неверный email или пароль.");
  await expect(page).toHaveURL(/\/login$/);
});

test("3. сессия сохраняется после обновления страницы", async ({ page }) => {
  await login(page);
  await page.goto("/app/leads");
  await page.reload();
  await expect(page).toHaveURL(/\/app\/leads/);
  await expect(page.getByRole("heading", { name: "Заявки" })).toBeVisible();
});

test("4. заявка вручную сохраняется и видна после обновления", async ({ page }) => {
  await login(page);
  await page.goto("/app/leads?create=1");
  const title = `E2E ручная заявка ${RUN}`;
  await page.getByLabel("Описание").fill(title);
  await page.getByLabel("Телефон").fill("+996 555 000 301");
  await page.getByLabel("Имя").fill("E2E Клиент");
  await page.getByRole("button", { name: "Создать" }).click();
  await page.waitForURL(/open=/);
  await page.reload();
  await expect(page.getByText(title).first()).toBeVisible();
  const sb = await db();
  if (sb) {
    const { data } = await sb.from("leads").select("id, source, status").eq("title", title);
    expect(data).toHaveLength(1);
    expect(data![0]!.source).toBe("manual");
  }
});

let aiLeadId = "";
test("5–6. AI собирает заявку в диалоге, она сохраняется в Supabase и видна в CRM", async ({ page }) => {
  await login(page);
  await page.goto("/app/assistant");
  await page.getByTestId("start-text").click();
  const a1 = await say(page, "Здравствуйте, сколько стоит замена масла?");
  expect(a1).toMatch(/1\s?500\s?сом/);
  await say(page, "Хочу записаться на завтра");
  const phone = `+996 555 0${RUN.slice(-2).replace(/\D/g, "1").padStart(2, "1")} 777`;
  const a3 = await say(page, `Меня зовут Азамат, мой номер ${phone}`);
  expect(a3).toMatch(/заявк/i);
  expect(a3).not.toMatch(/записал[аи]? вас на|время подтверждено|забронирован/i);
  const chip = page.getByTestId("lead-created");
  await expect(chip).toBeVisible();
  const href = await chip.getAttribute("href");
  aiLeadId = new URL(href!, "http://x").searchParams.get("open")!;
  expect(aiLeadId).toMatch(/^[0-9a-f-]{36}$/);

  const sb = await db();
  if (sb) {
    const { data } = await sb.from("leads").select("id, source, source_id, type, payload, contacts(name, phone)").eq("id", aiLeadId).single();
    expect(data!.source).toBe("chat");
    expect(data!.type).toBe("booking");
    expect((data!.payload as Record<string, string>).service).toMatch(/масл/i);
    expect((data!.payload as Record<string, string>).preferred_time).toMatch(/завтра/i);
    expect((data!.contacts as unknown as { name: string }).name).toBe("Азамат");
    // Заявка связана с сохранённым диалогом
    const { data: msgs } = await sb.from("messages").select("author, body").eq("conversation_id", data!.source_id!);
    expect(msgs!.length).toBeGreaterThanOrEqual(6);
  }

  await page.goto(`/app/leads?open=${aiLeadId}`);
  await page.reload();
  await expect(page.getByTestId("lead-dialog")).toBeVisible();
  await expect(page.getByText("Азамат").first()).toBeVisible();
});

test("7. изменение статуса заявки сохраняется", async ({ page }) => {
  test.skip(!aiLeadId, "нет заявки из сценария 5");
  await login(page);
  await page.goto(`/app/leads?open=${aiLeadId}`);
  const card = page.getByTestId("lead-card");
  await card.getByRole("button", { name: "Взять", exact: true }).click();
  await expect(card.getByText("В работе").first()).toBeVisible();
  await page.reload();
  const sb = await db();
  if (sb) {
    const { data } = await sb.from("leads").select("status, assignee_id").eq("id", aiLeadId).single();
    expect(data!.status).toBe("in_progress");
    expect(data!.assignee_id).toBeTruthy();
    const { data: ev } = await sb.from("lead_events").select("action").eq("lead_id", aiLeadId).eq("action", "status");
    expect(ev!.length).toBeGreaterThanOrEqual(1);
  }
});

test("8. изменение базы знаний публикуется и используется AI", async ({ page }) => {
  await login(page);
  const question = `Есть ли у вас мойка кузова ${RUN}?`;
  const answer = `Да, мойка кузова бесплатно при ТО, код ${RUN}.`;
  await page.goto(`/app/knowledge/faq?new=${encodeURIComponent(question)}`);
  const headers = page.locator("thead th");
  const idx = await headers.evaluateAll((ths) => ths.findIndex((th) => th.textContent?.includes("Короткий ответ")));
  expect(idx).toBeGreaterThan(0);
  const cell = page.locator(`[data-cell="0:${idx - 1}"]`);
  await cell.click();
  await cell.click();
  await page.keyboard.type(answer);
  await page.keyboard.press("Enter");
  await expect(page.getByText("Сохранено").first()).toBeVisible({ timeout: 10_000 });

  await page.goto("/app/knowledge");
  await page.getByRole("button", { name: "Опубликовать" }).first().click();
  await page.getByRole("button", { name: "Опубликовать" }).last().click();
  await expect(page.getByText(/опубликован/i).first()).toBeVisible({ timeout: 10_000 });

  await page.goto("/app/assistant");
  await page.getByTestId("start-text").click();
  const reply = await say(page, question);
  expect(reply).toContain(RUN);
});

test("9. данные другой компании недоступны; сотрудник не выполняет действия владельца", async ({ page, request }) => {
  await login(page);
  const r = await page.request.get(`/api/read/lead/${FOREIGN_LEAD}`);
  expect(r.status()).toBe(404);
  const anon = await request.get(`/api/read/lead/${FOREIGN_LEAD}`, { headers: { cookie: "" } });
  expect(anon.status()).toBe(401);
  const sb = await db();
  if (sb) {
    const { data } = await sb.from("leads").select("id").eq("id", FOREIGN_LEAD);
    expect(data).toHaveLength(0);
    const { error } = await sb.rpc("resolve_number", { p_e164: "+996555000101" });
    expect(error).toBeTruthy();
  }
  await page.context().clearCookies();

  await login(page, STAFF);
  const nav = page.getByRole("navigation", { name: "Основная навигация" });
  await expect(nav.getByRole("link", { name: "Заявки" })).toBeVisible();
  await expect(nav.getByRole("link", { name: /Анкета|База знаний/ })).toHaveCount(0);
  await expect(nav.getByRole("link", { name: "Ассистент" })).toHaveCount(0);
  await page.goto("/app/knowledge");
  await expect(page).toHaveURL(/\/app$/);
  await page.goto("/app/assistant");
  await expect(page).toHaveURL(/\/app$/);
  const sbs = await db(STAFF);
  if (sbs) {
    const { data } = await sbs.from("assistant_settings").update({ settings: { name: "взлом" } }).neq("company_id", "00000000-0000-0000-0000-000000000000").select("id");
    expect(data ?? []).toHaveLength(0);
    const { error } = await sbs.rpc("publish_questionnaire", { p_company_id: "4603235f-c3d2-5d7a-a103-4f16fdc02d79", p_payload: {}, p_missing: [] });
    expect(error?.code).toBe("42501");
  }
});

test("10. выход закрывает доступ к приватным маршрутам", async ({ page }) => {
  await login(page);
  await page.getByRole("button", { name: /Demo Owner/ }).first().click();
  await page.getByRole("menuitem", { name: "Выйти" }).click();
  await page.waitForURL("**/login");
  await page.goto("/app/leads");
  await expect(page).toHaveURL(/\/login$/);
  const r = await page.request.get("/api/read/lead/00000000-0000-4000-8000-000000000000");
  expect(r.status()).toBe(401);
});
