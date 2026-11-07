import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  use: { baseURL: process.env.E2E_URL ?? "http://localhost:3000", viewport: { width: 1440, height: 900 } },
  webServer: process.env.E2E_URL ? undefined : { command: "pnpm dev", port: 3000, reuseExistingServer: true, env: { DATA_SOURCE: "mock", MOCK_SIMULATOR: "off" } },
});
