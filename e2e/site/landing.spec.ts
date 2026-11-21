// Landing: ?at=<site> starts the flight just south of a landmark, the land prompt offers it, Space lands, the Codex
// opens with what is kept there, and the dragon takes off again. At the abbey the Codex is About me, and it opens the
// terminal.

import type { Page } from "@playwright/test";
import { INTERESTS, KEEPSAKE, PROFILE } from "../../src/components/terminal/content.ts";
import { QUEST_KEY } from "../../src/world/story/quest.ts";
import { PIECE_RGB, STOPS } from "../../src/world/story/stops.ts";
import { expect, flier, guide, hold, openWorld, probe, skipLesson, test, WORLD, type Probe } from "../support";

/** The first landmark that holds `holds` ("hall" or "about"), read from the world's probe. */
async function landmark(page: Page, holds: string): Promise<{ id: string; name: string | null }> {
  await skipLesson(page);
  await openWorld(page);
  const site = (await probe(page)).landmarks?.find((l) => l.holds === holds);
  if (!site) throw new Error(`no landmark holds ${holds}`);
  return site;
}

function titled(s: string): string {
  return s.length === 0 ? s : s.charAt(0).toUpperCase() + s.slice(1);
}

/** Red, green, blue of a packed RGBA pixel (red in the low byte), or of a computed CSS colour. */
function rgbOf(color: string | number): { rgb: number[]; alpha: number } {
  if (typeof color === "number") return { rgb: [color & 255, (color >>> 8) & 255, (color >>> 16) & 255], alpha: 1 };
  if (color === "transparent") return { rgb: [0, 0, 0], alpha: 0 };
  const nums = color.match(/\d+(?:\.\d+)?/g);
  if (!nums || nums.length < 3) throw new Error(`unreadable colour ${color}`);
  return { rgb: nums.slice(0, 3).map((n) => Math.round(Number(n))), alpha: nums.length >= 4 ? Number(nums[3]) : 1 };
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
  test("lands at the hall, opens its Codex, and takes off", async ({ page }) => {
    const site = await landmark(page, "hall");
    await landAt(page, site.id, "the projects");

    const codex = page.getByRole("dialog", { name: "Projects", exact: true });
    await expect(codex).toBeVisible({ timeout: 20_000 });
    await expect(codex.getByRole("heading", { level: 2, name: "Projects", exact: true })).toBeVisible();
    expect((await flier(page)).phase).toBe("landed");
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

  test("the hall opens a project and returns focus to its row", async ({ page }) => {
    const site = await landmark(page, "hall");
    await landAt(page, site.id, "the projects");

    const codex = page.getByRole("dialog", { name: "Projects", exact: true });
    await expect(codex).toBeVisible({ timeout: 20_000 });
    await expect(codex.getByRole("heading", { level: 2, name: "Projects", exact: true })).toBeVisible();
    const row = codex.getByRole("list").first().getByRole("button").first();
    await row.click();
    const back = page.getByRole("button", { name: "Back to the hall" });
    await expect(back).toBeVisible();
    await back.click();
    await expect(codex.getByRole("heading", { level: 2, name: "Projects", exact: true })).toBeVisible();
    await expect(row).toBeFocused();

    // A phone's sheet: the row stays a finger's height, and neither the list nor a project spills sideways.
    await page.setViewportSize({ width: 375, height: 812 });
    await expect.poll(() => row.evaluate((el) => el.getBoundingClientRect().height)).toBeGreaterThanOrEqual(44);
    const leaf = codex.locator("[tabindex='-1']");
    await expect.poll(() => leaf.evaluate((el) => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(1);
    await row.click();
    const openLeaf = page.getByRole("dialog").locator("[tabindex='-1']");
    await expect(page.getByRole("button", { name: "Back to the hall" })).toBeVisible();
    await expect.poll(() => openLeaf.evaluate((el) => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(1);
  });

  test("landing at a stop fills one quatrefoil and stores the find", async ({ page }) => {
    const site = await landmark(page, "stop");
    const stop = STOPS.find((item) => item.key === site.name);
    if (!stop) throw new Error(`landmark ${site.id} is not one of the five`);
    await landAt(page, site.id, stop.name);

    const codex = page.getByRole("dialog");
    await expect(codex).toBeVisible({ timeout: 20_000 });
    await expect(codex.getByText("¶ Found", { exact: true })).toBeVisible();
    const many = KEEPSAKE.many;
    await expect(codex.getByRole("heading", { level: 3, name: `${titled(many)} · 1 of 5`, exact: true })).toBeVisible();
    await expect(codex.getByText("One is kept at each of five places. Each tells you something about Daniel.", { exact: true })).toBeVisible();
    const foils = codex.getByRole("group", { name: `1 of 5 ${many} found`, exact: true });
    await expect(foils).toBeVisible();
    await expect(codex.getByRole("button", { name: "Follow the quest" })).toBeVisible();

    const place = titled(stop.name);
    const row = codex.getByRole("listitem").filter({ hasText: place });
    await expect(row).toContainText("found here");
    const fact = INTERESTS.find((item) => item.key === stop.interest)?.line;
    if (!fact) throw new Error(`no line for ${stop.interest}`);
    await expect(row).not.toContainText(fact);
    await expect(codex.getByText(fact, { exact: true })).toBeVisible();
    for (const item of STOPS) {
      const line = codex.getByRole("listitem").filter({ hasText: titled(item.name) });
      await expect(line).toBeVisible();
      if (item.key !== stop.key) await expect(line).toContainText("not yet found");
    }

    const paper = [240, 232, 210];
    const fills = await foils.locator("svg").evaluateAll((nodes) =>
      nodes.map((svg) => getComputedStyle(svg.querySelector("g:last-of-type") ?? svg).fill),
    );
    expect(fills).toHaveLength(STOPS.length);
    const index = STOPS.findIndex((item) => item.key === stop.key);
    STOPS.forEach((item, i) => {
      const got = rgbOf(fills[i]).rgb;
      expect(got).toEqual(i === index ? rgbOf(PIECE_RGB[item.key]).rgb : paper);
    });
    const swatch = await row.locator("span").first().evaluate((el) => getComputedStyle(el).backgroundColor);
    expect(rgbOf(swatch).rgb).toEqual(rgbOf(PIECE_RGB[stop.key]).rgb);
    const other = STOPS.find((item) => item.key !== stop.key);
    if (!other) throw new Error("expected another stop");
    const empty = await codex
      .getByRole("listitem")
      .filter({ hasText: titled(other.name) })
      .locator("span")
      .first()
      .evaluate((el) => getComputedStyle(el).backgroundColor);
    expect(rgbOf(empty).alpha).toBe(0);

    await page.setViewportSize({ width: 375, height: 812 });
    const leaf = codex.locator("[tabindex='-1']");
    await expect.poll(() => leaf.evaluate((el) => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(1);
    const sheet = await codex.evaluate((el) => {
      const r = el.getBoundingClientRect();
      return { left: r.left, right: r.right, width: window.innerWidth };
    });
    expect(sheet.left).toBeGreaterThanOrEqual(-1);
    expect(sheet.right).toBeLessThanOrEqual(sheet.width + 1);

    await expect.poll(() => page.evaluate((key) => window.localStorage.getItem(key), QUEST_KEY)).toContain(`"${site.name}"`);
  });
});
