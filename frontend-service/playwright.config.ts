import { defineConfig, devices } from "@playwright/test";

// End-to-end flows against the full Docker stack (see ../docker-compose.yml).
// Run with `npm run test:e2e`; global setup starts the stack unless it is
// already running, and tears it down again afterwards.
export const BASE_URL = process.env.E2E_BASE_URL ?? "http://localhost:5173";
export const API_URL = process.env.E2E_API_URL ?? "http://localhost:3000";
// cognito-local from docker-compose.yml and its seeded app client.
export const COGNITO_URL = process.env.E2E_COGNITO_URL ?? "http://localhost:9229/";
export const COGNITO_CLIENT_ID = process.env.E2E_COGNITO_CLIENT_ID ?? "kanobilocalwebclient";

const CI = !!process.env.CI;

export default defineConfig({
  testDir: "./src/e2e",
  testMatch: "**/*.e2e.tsx",
  outputDir: "test-results",
  globalSetup: "./src/e2e/support/globalSetup.ts",
  globalTeardown: "./src/e2e/support/globalTeardown.ts",
  timeout: 60_000,
  expect: { timeout: 15_000 },
  fullyParallel: true,
  forbidOnly: CI,
  retries: CI ? 1 : 0,
  workers: CI ? 2 : undefined,
  reporter: CI
    ? [["github"], ["html", { open: "never", outputFolder: "playwright-report" }]]
    : [["list"], ["html", { open: "never", outputFolder: "playwright-report" }]],
  use: {
    baseURL: BASE_URL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
    // Generated APIs are served from *.execute-api.localhost.localstack.cloud.
    ignoreHTTPSErrors: true,
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
