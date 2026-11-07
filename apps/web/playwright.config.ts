import { defineConfig } from "@playwright/test";

// E2E_MODE=supabase — сценарии Hackathon MVP против настоящего Supabase (e2e/mvp.spec.ts);
// по умолчанию — mock-режим для локальной разработки без базы.
const supabase = process.env.E2E_MODE === "supabase";

export default defineConfig({
  testDir: "./e2e",
  testMatch: supabase ? ["mvp.spec.ts"] : ["cabinet.spec.ts", "phase1b.spec.ts"],
  timeout: 60_000,
  retries: process.env.CI ? 1 : 0,
  // В CI ошибки попадают в аннотации GitHub (видны без доступа к логам)
  reporter: process.env.CI ? [["github"], ["list"]] : "list",
  use: { baseURL: process.env.E2E_URL ?? "http://localhost:3000", viewport: { width: 1440, height: 900 }, trace: "retain-on-failure" },
  webServer: process.env.E2E_URL ? undefined : supabase
    ? { command: "pnpm start", port: 3000, reuseExistingServer: true, timeout: 120_000 }
    : { command: "pnpm dev", port: 3000, reuseExistingServer: true, env: { DATA_SOURCE: "mock", MOCK_SIMULATOR: "off" } },
});
