// The site's other pages load, in their fonts, with no console errors.

import { expect, NOT_YET, offline, test } from "../support";

test.describe("pages", () => {
  test("the home page", { tag: "@phone" }, async ({ page }) => {
    await offline(page);
    const res = await page.goto("/");
    expect(res?.status()).toBe(200);
    // Both titles are in the document; CSS shows one. The name that is on screen is the one this checks.
    await expect(page.getByText("Daniel Kuo").filter({ visible: true }).first()).toBeVisible();
    // Desktop text is the terminal's own mono. The phone title is set in IM Fell. Adventor is the other pages'
    // display face, so it stays unloaded here; Libron is only the body rule, which an engine may or may not fetch.
    const fonts = await page.evaluate(async () => {
      await document.fonts.ready;
      const status: Record<string, string> = {};
      for (const face of document.fonts) {
        if (/Fallback/.test(face.family)) continue;
        if (status[face.family] === "loaded") continue;
        status[face.family] = face.status;
      }
      return status;
    });
    for (const status of Object.values(fonts)) expect(status).not.toBe("error");
    const phone = await page.evaluate(
      () => window.matchMedia("(max-width: 699px), (pointer: coarse) and (max-height: 499px)").matches,
    );
    if (phone) expect(fonts["IM Fell English"]).toBe("loaded");
    else expect(fonts.adventor).toBe("unloaded");
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
