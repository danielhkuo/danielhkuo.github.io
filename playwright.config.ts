// The end-to-end suites: the static export in out/, served as GitHub Pages would (scripts/serve-out.mjs), in Chromium
// and in WebKit, the closest automated stand-in for Safari.
//
//   npm run e2e                    builds, then runs every project
//   npx playwright test            runs against the out/ already built
//   npx playwright test --project=webkit e2e/site/landing.spec.ts
//   npm run test:minimal           the minimal version's projects alone, against the out/ already built
//
// Each suite is a folder under e2e/ with projects of its own. The site's (e2e/site/) runs in both engines at a desktop
// size, and its tests tagged @phone also on emulated phones. The minimal version's (e2e/minimal/) runs in WebKit, at
// a phone's size and a desktop's. Another suite joins with its own projects and testDir; e2e/support.ts holds what
// they share (a test that fails on console errors, the world's probe).

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

/**
 * The minimal version: the whole site as one text file, open in nano. WebKit only, the nearest thing to Safari, whose
 * keyboard and scrolling the page is built around. Its tests run on the phone unless tagged @desktop.
 *
 * The phone's size is the area Safari showed on an iPhone 17e with its toolbar out, 390 × 699, measured in the iOS
 * Simulator (docs/superpowers/research/2026-11-19-minimal-terminal-mobile.md). Less motion is asked for, as a visitor
 * may: nothing on the page moves now, and nothing that moves later should slow every test.
 */
const minimal: Project[] = [
  { name: "minimal-phone", use: { ...devices["iPhone 17"], viewport: { width: 390, height: 699 } }, grepInvert: /@desktop/ },
  { name: "minimal-desktop", use: { ...devices["Desktop Safari"], viewport: { width: 1280, height: 800 } }, grep: /@desktop/ },
].map((p) => ({ ...p, testDir: "e2e/minimal", use: { ...p.use, contextOptions: { reducedMotion: "reduce" as const } } }));

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
  projects: [...site, ...minimal],
});
