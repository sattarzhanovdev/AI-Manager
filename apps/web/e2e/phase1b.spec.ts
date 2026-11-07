import { expect, test, type Page } from "@playwright/test";

async function login(page: Page) {
  await page.context().addCookies([{ name: "all_session", value: "u_admin", url: page.context().pages()[0]?.url().startsWith("http") ? page.url() : (process.env.E2E_URL ?? "http://localhost:3000") }]);
}

test.beforeEach(async ({ page, baseURL }) => {
  await page.context().addCookies([{ name: "all_session", value: "u_admin", url: baseURL! }]);
  void login;
});

test("чаты: после «Взять чат» AI не отправляет ни одного сообщения", async ({ page }) => {
  await page.goto("/app/inbox?open=cv_6");
  await expect(page.getByRole("button", { name: /Взять чат|Вернуть AI/ })).toBeVisible();
  const back = page.getByRole("button", { name: "Вернуть AI" });
  if (await back.isVisible()) { await back.click(); await expect(page.getByRole("button", { name: "Взять чат" })).toBeVisible(); }
  await page.getByRole("button", { name: "Взять чат" }).click();
  await expect(page.getByRole("main").getByText("Вы ведёте чат", { exact: false })).toBeVisible();
  const aiBefore = await page.locator("main ol li").filter({ hasText: /^AI/ }).count();
  await page.getByPlaceholder("Напишите как клиент…").fill("А сколько стоит замена масла?");
  await page.getByPlaceholder("Напишите как клиент…").press("Enter");
  await expect(page.getByText("А сколько стоит замена масла?").last()).toBeVisible();
  await page.waitForTimeout(6000); // склейка 3,5 с + запас
  expect(await page.locator("main ol li").filter({ hasText: /^AI/ }).count()).toBe(aiBefore);
  await page.getByRole("button", { name: "Вернуть AI" }).click();
});

test("чаты: черновик AI появляется ≤ 5 с в режиме черновика", async ({ page }) => {
  await page.goto("/app/inbox?open=cv_2");
  await page.getByPlaceholder("Напишите как клиент…").fill("А до скольки вы работаете в субботу?");
  await page.getByPlaceholder("Напишите как клиент…").press("Enter");
  await expect(page.getByText("Черновик AI", { exact: false })).toBeVisible({ timeout: 5000 });
});

test("чаты: вне 24-часового окна свободный текст заблокирован", async ({ page }) => {
  await page.goto("/app/inbox?open=cv_5");
  await expect(page.getByText("24-часовое окно закрыто", { exact: false })).toBeVisible();
  await expect(page.getByPlaceholder("Ответ клиенту…", { exact: false })).toHaveCount(0);
});

test("календарь: ноль двойных записей", async ({ page }) => {
  await page.goto("/app/calendar");
  await page.getByRole("button", { name: "Новая запись" }).click();
  // 10:00 у первого ресурса уже занято в демо-данных
  await page.getByPlaceholder("+996 555 123 456").fill("+996555777001");
  await page.getByRole("button", { name: "Создать" }).click();
  await expect(page.getByText("Время занято", { exact: false })).toBeVisible();
});

test("талоны: освободившийся талон предлагается первому в листе", async ({ page }) => {
  await page.goto("/app/calendar");
  await page.getByRole("radio", { name: "Талоны" }).click();
  const cardiology = page.locator("section").filter({ hasText: "Кардиолог" }).first();
  await cardiology.getByRole("button", { name: "Освободить" }).first().click();
  await expect(page.getByText("предложено до", { exact: false }).first()).toBeVisible({ timeout: 60_000 });
});
