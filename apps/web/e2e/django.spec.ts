import { test, expect, type BrowserContext } from "@playwright/test";
import { createHmac } from "node:crypto";

// Uses seed_demo (DEBUG only). No provider calls and no production credentials.
const password = process.env.E2E_OWNER_PASSWORD ?? "local-e2e-password-only";
const email = process.env.E2E_OWNER_EMAIL ?? "demo.owner@example.com";
const backend = process.env.E2E_DJANGO_URL ?? "http://127.0.0.1:8000/api/v1";
let cookies: Awaited<ReturnType<BrowserContext["cookies"]>> = [];
let token = "";
const run = Date.now().toString(36);
function totp(secret: string) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const bits = [...secret].map((c) => alphabet.indexOf(c).toString(2).padStart(5, "0")).join("");
  const key = Buffer.from(bits.match(/.{8}/g)!.map((b) => parseInt(b, 2)));
  const counter = Buffer.alloc(8); counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30_000)));
  const mac = createHmac("sha1", key).update(counter).digest(); const offset = mac[19]! & 15;
  return ((mac.readUInt32BE(offset) & 0x7fffffff) % 1_000_000).toString().padStart(6, "0");
}
test.describe.configure({ mode: "serial" });
test("Django: password + required TOTP enrolment, session survives reload", async ({ page, context }) => {
  await page.goto("/login");
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Пароль", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Войти", exact: true }).click();
  const otp = page.getByLabel("Код из приложения аутентификации");
  await expect(otp).toBeVisible();
  const setup = await page.locator("code").textContent();
  const secret = process.env.E2E_TOTP_SECRET ?? setup;
  expect(secret).toBeTruthy();
  await otp.fill(totp(secret!.trim()));
  await page.getByRole("button", { name: "Войти", exact: true }).click();
  await expect(page).toHaveURL(/\/app$/);
  await page.reload();
  await expect(page.getByRole("heading", { name: "Обзор", exact: true })).toBeVisible();
  cookies = await context.cookies(); token = cookies.find((c) => c.name === "all_django_session")!.value;
});
test.beforeEach(async ({ context }) => { if (cookies.length) await context.addCookies(cookies); });
test("Django: create lead in UI, reload, verify via independent REST read", async ({ page, request }) => {
  await page.goto("/app/leads?create=1");
  const title = `Django UI ${run}`;
  await page.getByLabel("Описание", { exact: true }).fill(title);
  await page.getByLabel("Телефон", { exact: true }).fill("+996555000301");
  await page.getByLabel("Имя", { exact: true }).fill("Тестовый клиент");
  await page.getByRole("button", { name: "Создать", exact: true }).click();
  await page.waitForURL(/open=/); await page.reload();
  await expect(page.getByText(title).first()).toBeVisible();
  const response = await request.get(`${backend}/leads/`, { headers: { Authorization: `Bearer ${token}` } });
  expect(response.ok()).toBeTruthy();
  expect((await response.json()).results.some((x: { title: string }) => x.title === title)).toBeTruthy();
});
test("Django: all enabled cabinet screens render using real API data", async ({ page }) => {
  for (const path of ["calls", "contacts", "knowledge", "assistant", "inbox", "calendar", "analytics", "team", "billing", "settings/company", "settings/notifications", "settings/security", "integrations"]) {
    const response = await page.goto(`/app/${path}`);
    expect(response?.status(), path).toBe(200);
    await expect(page.locator("main")).toBeVisible();
    await expect(page.getByText("Application error", { exact: false })).toHaveCount(0);
  }
  await page.screenshot({ path: "test-results/django-cabinet.png", fullPage: true });
});
test("Django: assistant reads published price and saves a real lead", async ({ page, request }) => {
  await page.goto("/app/assistant");
  await page.getByTestId("start-text").click();
  async function say(text: string) {
    const n = await page.locator('[data-speaker="ai"]').count();
    await page.getByTestId("chat-input").fill(text); await page.getByTestId("chat-send").click();
    await expect(page.locator('[data-speaker="ai"]')).toHaveCount(n + 1);
    return await page.locator('[data-speaker="ai"]').last().innerText();
  }
  expect(await say("Сколько стоит замена масла?")).toMatch(/1\s?500/);
  await say("Хочу записаться на замену масла завтра");
  const reply = await say("Меня зовут Азамат, телефон +996 555 000 302");
  expect(reply).toMatch(/заявк[аи]|уточн/i);
  const r = await request.get(`${backend}/read/listLeads/`, { headers: { Authorization: `Bearer ${token}` } });
  expect((await r.json()).some((x: { source: string; contactPhone: string }) => x.source === "chat" && x.contactPhone === "+996555000302")).toBeTruthy();
});
test("Django: settings persist through UI and do not enable a phone line", async ({ page, request }) => {
  await page.goto("/app/settings/company");
  const form = page.locator("form").first();
  const name = form.locator("input").first();
  await name.fill(`Демо Мотор ${run}`);
  await form.getByRole("button", { name: "Сохранить", exact: true }).click();
  await page.reload(); await expect(name).toHaveValue(`Демо Мотор ${run}`);
  const r = await request.get(`${backend}/read/getCompany/`, { headers: { Authorization: `Bearer ${token}` } });
  expect((await r.json()).aiMode).toBe("off");
});
test("Django: invalid password does not create a session", async ({ browser }) => {
  const ctx = await browser.newContext(); const page = await ctx.newPage();
  await page.goto("/login"); await page.getByLabel("Email", { exact: true }).fill(email); await page.getByLabel("Пароль", { exact: true }).fill("wrong-password");
  await page.getByRole("button", { name: "Войти", exact: true }).click();
  await expect(page.getByTestId("login-error")).toHaveText("Неверный email или пароль.");
  expect((await ctx.cookies()).some((c) => c.name === "all_django_session")).toBeFalsy();
  await ctx.close();
});
