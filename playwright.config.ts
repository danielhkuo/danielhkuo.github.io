// The end-to-end suites: the static export in out/, served as GitHub Pages would (scripts/serve-out.mjs), in Chromium
// and in WebKit, the closest automated stand-in for Safari.
//
//   npm run e2e                    builds, then runs every project
//   npx playwright test            runs against the out/ already built
//   npx playwright test --project=webkit e2e/site/landing.spec.ts
//
// Each suite is a folder under e2e/ with projects of its own. The site's (e2e/site/) runs in both engines at a desktop
// size, and its tests tagged @phone also on emulated phones. Another suite joins with its own projects and testDir;
// e2e/support.ts holds what they share (a test that fails on console errors, the world's probe).

import { defineConfig, devices, type Project } from "@playwright/test";

const PORT = Number(process.env.E2E_PORT ?? 4417);
const DESKTOP = { width: 1440, height: 900 };

/** The site: the world and the pages. */
const site: Project[] = [
  { name: "chromium", use: { ...devices["Desktop Chrome"], viewport: DESKTOP } },
  { name: "webkit", use: { ...devices["Desktop Safari"], viewport: DESKTOP } },
  { name: "chromium-phone", use: { ...devices["Pixel 7"] }, grep: /@phone/ },
  { name: "webkit-phone", use: { ...devices["iPhone 17"] }, grep: /@phone/ },
].map((p) => ({ ...p, testDir: "e2e/site" }));

export default defineConfig({
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
  projects: [...site],
});
