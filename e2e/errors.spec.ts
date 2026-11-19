// A broken world: when a world file is missing, garbled or fails its checksum, the page says the realm could not be
// loaded, with a way back to the site, instead of showing a blank frame.

import type { Page, Route } from "@playwright/test";
import { LOAD_FAILED } from "../src/world/runtime/load.ts";
import { expect, test, WORLD, type Probe } from "./support";

/** A request the browser logs as an error when its reply is not OK: expected here, and nothing else is. */
const FAILED_LOAD = /^console: Failed to load resource/;

const BROKEN: { name: string; url: string | RegExp; reply: (route: Route) => Promise<void> }[] = [
  {
    name: "current.json is not JSON",
    url: "**/world/current.json",
    reply: (route) => route.fulfill({ status: 200, contentType: "application/json", body: "{ not json" }),
  },
  {
    name: "the manifest is missing",
    url: "**/manifest.json",
    reply: (route) => route.fulfill({ status: 404, body: "not found" }),
  },
  {
    name: "core.bin fails its checksum",
    url: "**/core.bin",
    reply: async (route) => {
      const res = await route.fetch();
      const body = Buffer.from(await res.body());
      body[body.length >> 1] ^= 0xff;
      await route.fulfill({ response: res, body });
    },
  },
];

async function expectFailure(page: Page, errors: string[]) {
  await expect(page.getByText(LOAD_FAILED)).toBeVisible();
  await expect(page.getByRole("link", { name: "Back to the site" })).toHaveAttribute("href", "/");
  await expect(page.locator("canvas")).toHaveCount(0);
  expect(await page.evaluate(() => (window as unknown as { __flight?: Probe }).__flight?.error)).toBe(LOAD_FAILED);
  const unexpected = errors.filter((e) => !FAILED_LOAD.test(e));
  errors.length = 0;
  expect(unexpected).toEqual([]);
}

test.describe("a broken world", () => {
  for (const broken of BROKEN) {
    test(`shows the failure message when ${broken.name}`, async ({ page, errors }) => {
      await page.route(broken.url, broken.reply);
      await page.goto(WORLD);
      await expectFailure(page, errors);
    });
  }
});
