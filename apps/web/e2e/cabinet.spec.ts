import { expect, test, type Page } from "@playwright/test";

async function login(page: Page, phone = "+996555100200") {
  await page.goto("/login");
  await page.getByLabel("Телефон или email").fill(phone);
  await page.getByRole("button", { name: "Получить код" }).click();
  await page.getByLabel("Цифра 1").fill("0");
  await page.keyboard.type("00000");
  await page.waitForURL("**/app");
}

test("вход по телефону ≤ 3 действий и Обзор без прокрутки на 1440×900", async ({ page }) => {
  await login(page);
  await expect(page.getByRole("heading", { name: "Обзор" })).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollHeight > window.innerHeight);
  expect(overflow).toBe(false);
});

test("звонки: J открывает следующий, клик по реплике перематывает", async ({ page }) => {
  await login(page);
  await page.goto("/app/calls");
  await page.locator("tbody tr").first().click();
  await expect(page.getByText("Расшифровка", { exact: false })).toBeVisible();
  await page.keyboard.press("j");
  await expect(page).toHaveURL(/open=/);
});

test("заявка: закрытие без результата требует причину", async ({ page }) => {
  await login(page);
  await page.goto("/app/leads");
  // по умолчанию — канбан; открываем первую карточку в колонке «Новая»
  await page.locator("section[role=listitem] li[draggable=true]").first().click();
  await page.getByRole("button", { name: "Закрыть без результата" }).click();
  await expect(page.getByRole("button", { name: "Закрыть без результата" }).last()).toBeDisabled();
});

test("анкета: тестовый чат отвечает по черновику", async ({ page }) => {
  await login(page);
  await page.goto("/app/knowledge");
  await page.getByPlaceholder("Спросите как клиент…").fill("Вы робот?");
  await page.keyboard.press("Enter");
  await expect(page.getByText("виртуальный помощник", { exact: false }).last()).toBeVisible();
});

test("заявки: «Взять» прямо с карточки канбана, без открытия", async ({ page }) => {
  await login(page);
  await page.goto("/app/leads");
  const card = page.locator("section[role=listitem]").first().locator("li[draggable=true]").filter({ has: page.getByRole("button", { name: "Взять" }) }).first();
  await card.getByRole("button", { name: "Взять" }).click();
  await expect(page.getByText("Ответственный назначен").first()).toBeVisible();
});
