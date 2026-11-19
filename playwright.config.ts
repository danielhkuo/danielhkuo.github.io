// The end-to-end suite (e2e/): the static export in out/, served as GitHub Pages would (scripts/serve-out.mjs), in
// Chromium and in WebKit, the closest automated stand-in for Safari, at a desktop size and on a phone.
//
//   npm run e2e                    builds, then runs every project
//   npx playwright test            runs against the out/ already built
//   npx playwright test --project=webkit e2e/landing.spec.ts
//
// Phone projects run only the tests tagged @phone.

import { defineConfig, devices } from "@playwright/test";

const PORT = Number(process.env.E2E_PORT ?? 4417);

export default defineConfig({
  testDir: "e2e",
  // Each world page starts its own pool of bake workers: two pages at a time keep a shared machine usable.
  workers: Number(process.env.E2E_WORKERS ?? 2),
  timeout: 60_000,
  expect: { timeout: 15_000 },
  retries: process.env.CI ? 1 : 0,
  reporter: [["list"]],
  outputDir: ".cache/e2e-results",
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    trace: "retain-on-failure",
  },
  webServer: {
    command: `node scripts/serve-out.mjs --port ${PORT}`,
    url: `http://127.0.0.1:${PORT}/`,
    reuseExistingServer: false,
    stdout: "ignore",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } } },
    { name: "webkit", use: { ...devices["Desktop Safari"], viewport: { width: 1440, height: 900 } } },
    { name: "chromium-phone", use: { ...devices["Pixel 7"] }, grep: /@phone/ },
    { name: "webkit-phone", use: { ...devices["iPhone 17"] }, grep: /@phone/ },
  ],
});
