// The site's other pages load, in their fonts, with no console errors.

import { expect, NOT_YET, offline, test } from "../support";

test.describe("pages", () => {
  test("the home page", { tag: "@phone" }, async ({ page }) => {
    await offline(page);
    const res = await page.goto("/");
    expect(res?.status()).toBe(200);
    await expect(page.getByText("Daniel Kuo").first()).toBeVisible();
    const fonts = await page.evaluate(async () => {
      await document.fonts.ready;
      return Object.fromEntries([...document.fonts].filter((f) => !/Fallback/.test(f.family)).map((f) => [f.family, f.status]));
    });
    expect(fonts).toMatchObject({ adventor: "loaded", libron: "loaded" });
  });

  test("the world bench starts its workers", async ({ page }) => {
    const res = await page.goto("/world-bench");
    expect(res?.status()).toBe(200);
    await expect(page.getByRole("heading", { name: "World bench" })).toBeVisible();
    await expect(page.getByText("Ready", { exact: true })).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole("button", { name: "Run" })).toBeEnabled();
  });

  test("the fish", async ({ request }) => {
    const res = await request.get("/fish.json");
    expect(res.status()).toBe(200);
    expect(Object.keys(await res.json()).length).toBeGreaterThan(0);
  });

  test("pages linked before they exist are still missing", async ({ request }) => {
    for (const path of NOT_YET) {
      const res = await request.get(path);
      expect(res.status(), `${path} exists now: take it off NOT_YET in e2e/support.ts`).toBe(404);
    }
  });

  test("a page that does not exist", { tag: "@phone" }, async ({ page, errors }) => {
    await offline(page);
    const res = await page.goto("/no-such-page");
    expect(res?.status()).toBe(404);
    await expect(page.getByText("This page could not be found.")).toBeVisible();
    // The browser logs the 404 itself; nothing else may.
    const unexpected = errors.filter((e) => !/^console: Failed to load resource: .*404/.test(e));
    errors.length = 0;
    expect(unexpected).toEqual([]);
  });
});
