// Landing: ?at=<site> starts the flight just south of a landmark, the land prompt offers it, Space lands, the Codex
// opens with what is kept there, and the dragon takes off again. At the abbey the Codex is About me, and it opens the
// terminal.

import type { Page } from "@playwright/test";
import { PROFILE } from "../src/components/terminal/content.ts";
import { expect, flier, guide, hold, openWorld, probe, skipLesson, test, WORLD, type Probe } from "./support";

/** The first landmark that holds `holds` ("project" or "about"), read from the world's probe. */
async function landmark(page: Page, holds: string): Promise<{ id: string; name: string | null }> {
  await skipLesson(page);
  await openWorld(page);
  const site = (await probe(page)).landmarks?.find((l) => l.holds === holds);
  if (!site) throw new Error(`no landmark holds ${holds}`);
  return site;
}

/** Starts the flight just south of `id` and lands there once the prompt offers `offer`. */
async function landAt(page: Page, id: string, offer: string): Promise<void> {
  await page.goto(`${WORLD}&at=${id}`);
  // The flight starts heading for the site: hold Down to come up on it slowly, so the prompt is not missed.
  await page.waitForFunction(() => ((window as unknown as { __flight?: Probe }).__flight?.state?.().speed ?? 0) > 0);
  await page.keyboard.down("ArrowDown");
  await expect(guide(page)).toHaveText(`Press Space to land: ${offer}.`);
  await page.keyboard.up("ArrowDown");
  await page.keyboard.press(" ");
}

test.describe("landing", () => {
  test("lands at a project's landmark, opens its Codex, and takes off", async ({ page }) => {
    const site = await landmark(page, "project");
    if (!site.name) throw new Error("the project has no name");
    await landAt(page, site.id, site.name);

    // Named by the project, whole: the illuminated initial once split it ("E mpty-state-repo").
    const codex = page.getByRole("dialog", { name: site.name, exact: true });
    await expect(codex).toBeVisible({ timeout: 20_000 });
    await expect(codex.getByRole("heading", { level: 2, name: site.name, exact: true })).toBeVisible();
    expect((await flier(page)).phase).toBe("landed");
    await expect(codex.getByText(/Kept at the /)).toBeVisible();
    await expect(codex.getByRole("link", { name: "Read the source" })).toHaveAttribute("href", /^https:\/\/github\.com\//);
    // The Codex is set in IM Fell English, served with the page.
    const fell = await page.evaluate(async () => {
      await document.fonts.ready;
      return [...document.fonts].filter((f) => /Fell/i.test(f.family) && !/Fallback/i.test(f.family)).map((f) => f.status);
    });
    expect(fell).toContain("loaded");

    // The Codex has the focus, and Space takes off from it.
    await page.keyboard.press(" ");
    await expect(codex).toBeHidden();
    expect((await flier(page)).phase).toBe("flying");
    await expect.poll(async () => (await flier(page)).speed).toBeGreaterThan(0);
  });

  test("the abbey's Codex reads down by keyboard and opens the terminal", async ({ page }) => {
    // A short window, so the Codex has more than shows.
    await page.setViewportSize({ width: 1280, height: 560 });
    const abbey = await landmark(page, "about");
    await landAt(page, abbey.id, "about me");

    const codex = page.getByRole("dialog", { name: PROFILE.name, exact: true });
    await expect(codex).toBeVisible({ timeout: 20_000 });
    // Landed, the arrow keys read down the Codex. (Held: WebKit's keyboard scrolling eases in over frames, and a tap
    // whose key goes up in the frame it went down in scrolls nothing.)
    const leaf = codex.locator("[tabindex='-1']");
    await expect(leaf).toBeFocused();
    expect(await leaf.evaluate((l) => l.scrollHeight > l.clientHeight), "the Codex overflows").toBe(true);
    await hold(page, "ArrowDown", 400);
    await expect.poll(() => leaf.evaluate((l) => l.scrollTop)).toBeGreaterThan(0);
    expect((await flier(page)).phase).toBe("landed");

    // The terminal takes every key while it is open: what is typed is run, and Esc puts it away.
    await codex.getByRole("button", { name: "Open the terminal" }).click();
    const input = page.getByRole("textbox", { name: "terminal input" });
    await expect(input).toBeFocused();
    await page.keyboard.type("help");
    await page.keyboard.press("Enter");
    await expect(page.getByRole("dialog", { name: "interactive terminal" }).getByText(/ls \[-la\]/)).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog", { name: "interactive terminal" })).toBeHidden();
    expect((await flier(page)).phase).toBe("landed");

    // Then Esc takes off.
    await page.keyboard.press("Escape");
    await expect(codex).toBeHidden();
    expect((await flier(page)).phase).toBe("flying");
  });
});
