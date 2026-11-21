// The world's cards and sheets on a phone held sideways, at the size Safari gives an iPhone 17 with one tab open
// (874 × 338, measured in the iOS 26.5 Simulator): each stays inside the visible area and its safe areas, nothing in it
// scrolls sideways, and every control in it is a finger's size, 44 px each way (Apple's least). Chromium also stands
// in for the iPhone's safe areas (62 px each side for the Dynamic Island and the rounded corners, 20 px for the home
// indicator), which WebKit's automation cannot; in WebKit they are zero. And the phone's title sets nothing smaller than
// 16 px. The rest (Safari's own toolbars, the keyboard, a real thumb) is the Simulator's: ios-pass in the notes.

import type { Locator, Page } from "@playwright/test";
import { PROFILE } from "../../src/components/terminal/content.ts";
import { QUEST_KEY } from "../../src/world/story/quest.ts";
import { STOPS } from "../../src/world/story/stops.ts";
import { expect, flier, openWorld, probe, skipLesson, takeWing, test, WORLD, type Probe } from "../support";

/** Safari on an iPhone 17 held sideways, one tab. */
const SIDEWAYS = { width: 874, height: 338 };
/** The iPhone 17's safe areas held sideways, CSS px. */
const IPHONE_INSETS = { top: 0, right: 62, bottom: 20, left: 62 };
const NO_INSETS = { top: 0, right: 0, bottom: 0, left: 0 };
type Insets = typeof NO_INSETS;
/** Apple's least for a target, pt. */
const FINGER = 44;

/** Holds the phone sideways at the iPhone's size, with its safe areas where the browser can stand them in. */
async function sideways(page: Page, browserName: string): Promise<Insets> {
  await page.setViewportSize(SIDEWAYS);
  if (browserName !== "chromium") return NO_INSETS;
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Emulation.setSafeAreaInsetsOverride", { insets: IPHONE_INSETS });
  return IPHONE_INSETS;
}

/** The quest answered before the page opens, so its offer does not come up over what a test looks at. */
async function questAnswered(page: Page): Promise<void> {
  await page.addInitScript((key) => {
    try {
      window.localStorage.setItem(key, JSON.stringify({ mode: "off", found: [] }));
    } catch {
      // storage refused: the offer shows
    }
  }, QUEST_KEY);
}

/** All five panes found before the page opens: the hall shows the quest's ending. */
async function questDone(page: Page): Promise<void> {
  await page.addInitScript(
    ({ key, found }) => {
      try {
        window.localStorage.setItem(key, JSON.stringify({ mode: "on", found }));
      } catch {
        // storage refused: the quest is not begun
      }
    },
    { key: QUEST_KEY, found: STOPS.map((s) => s.key) },
  );
}

/** Starts just south of the hall, lands there, and returns its Codex. */
async function landAtHall(page: Page): Promise<Locator> {
  await openWorld(page);
  const hall = (await probe(page)).landmarks?.find((l) => l.holds === "hall");
  if (!hall) throw new Error("no hall in the world");
  await page.goto(`${WORLD}&at=${hall.id}`);
  await page.waitForFunction(() => (window as unknown as { __flight?: Probe }).__flight?.readyAt != null, null, { timeout: 30_000 });
  await takeWing(page);
  await expect
    .poll(
      async () => {
        await page.keyboard.press(" ");
        return (await flier(page)).phase;
      },
      { timeout: 20_000, message: "landing at the hall" },
    )
    .not.toBe("flying");
  const codex = page.getByRole("dialog", { name: "Projects", exact: true });
  await expect(codex).toBeVisible({ timeout: 20_000 });
  return codex;
}

/** Checks each of `els` lies whole inside the sheet `codex`: none is hidden under its foot or cut off by it. */
async function expectInSheet(codex: Locator, els: Locator, label: string): Promise<void> {
  const box = await codex.boundingBox();
  if (!box) throw new Error("no Codex box");
  for (const el of await els.all()) {
    const r = await el.boundingBox();
    if (!r) throw new Error(`${label}: no box`);
    expect(r.y, `${label}: top inside the sheet`).toBeGreaterThanOrEqual(box.y - 0.5);
    expect(r.y + r.height, `${label}: foot inside the sheet`).toBeLessThanOrEqual(box.y + box.height + 0.5);
  }
}

/** Checks the register's heading is whole: on a short sheet its count gives way, not its words. */
async function expectWholeHeading(codex: Locator): Promise<void> {
  const heading = codex.getByRole("heading", { level: 3, name: /^Glass for the rose window/ });
  expect(await heading.evaluate((h) => h.scrollWidth - h.clientWidth), "the register's heading is cut short").toBeLessThanOrEqual(0);
}

/** Waits for `el` and everything in it to finish arriving: a sheet steps in by a transform, which a box would catch. */
async function arrived(el: Locator): Promise<void> {
  await el.evaluate((node) => Promise.all(node.getAnimations({ subtree: true }).map((a) => a.finished)));
}

/** Checks `el` lies inside the visible area less `insets` and `margin`. */
async function expectInside(page: Page, el: Locator, insets: Insets, label: string, margin = 0): Promise<void> {
  await arrived(el);
  const box = await el.boundingBox();
  if (!box) throw new Error(`${label}: no box`);
  const vv = await page.evaluate(() => ({ w: window.visualViewport?.width ?? innerWidth, h: window.visualViewport?.height ?? innerHeight }));
  const at = `${label} at ${Math.round(box.x)},${Math.round(box.y)} ${Math.round(box.width)}×${Math.round(box.height)} in ${vv.w}×${vv.h}`;
  expect(box.x, `${at}: left`).toBeGreaterThanOrEqual(insets.left + margin - 0.5);
  expect(box.y, `${at}: top`).toBeGreaterThanOrEqual(insets.top + margin - 0.5);
  expect(box.x + box.width, `${at}: right`).toBeLessThanOrEqual(vv.w - insets.right - margin + 0.5);
  expect(box.y + box.height, `${at}: bottom`).toBeLessThanOrEqual(vv.h - insets.bottom - margin + 0.5);
}

/** Checks every element `els` finds is at least a finger's size each way. */
async function expectFingers(els: Locator, label: string): Promise<void> {
  const boxes = await els.evaluateAll((list) =>
    list.map((el) => {
      const r = el.getBoundingClientRect();
      return { name: (el.textContent ?? "").trim().replace(/\s+/g, " ").slice(0, 40), w: r.width, h: r.height };
    }),
  );
  expect(boxes.length, `${label}: controls found`).toBeGreaterThan(0);
  for (const b of boxes) {
    expect(b.w, `${label}: "${b.name}" wide`).toBeGreaterThanOrEqual(FINGER - 0.5);
    expect(b.h, `${label}: "${b.name}" tall`).toBeGreaterThanOrEqual(FINGER - 0.5);
  }
}

test.describe("a phone held sideways", { tag: "@phone" }, () => {
  test.beforeEach(({ isMobile }) => {
    test.skip(!isMobile, "phones only");
  });

  test("the quest offer stands inside the safe area, its sentence whole, its buttons a finger's size, and holds the flight until it is answered", async ({ page, browserName }) => {
    const insets = await sideways(page, browserName);
    await skipLesson(page);
    await openWorld(page);
    await takeWing(page);
    const offer = page.getByRole("dialog", { name: "the rose window" });
    await expect(offer).toBeVisible({ timeout: 15_000 });
    await expectInside(page, offer, insets, "the offer");
    expect(await offer.evaluate((d) => d.scrollWidth - d.clientWidth), "the offer scrolls sideways").toBeLessThanOrEqual(0);
    expect(await offer.evaluate((d) => d.scrollHeight - d.clientHeight), "the offer scrolls").toBeLessThanOrEqual(0);
    await expectFingers(offer.getByRole("button"), "the offer");
    await expect.poll(async () => (await flier(page)).paused, { message: "held while the offer is up" }).toBe(true);
    await offer.getByRole("button", { name: "not now" }).tap();
    await expect(offer).toBeHidden();
    await expect.poll(async () => (await flier(page)).paused, { message: "flying once it is answered" }).toBe(false);
  });

  test("the options panel stands inside the visible area, clear of the home indicator, and every choice in it is a finger's size", async ({ page, browserName }) => {
    const insets = await sideways(page, browserName);
    await skipLesson(page);
    await questAnswered(page);
    await openWorld(page);
    await takeWing(page);
    await page.getByRole("button", { name: "Options", exact: true }).tap();
    const panel = page.getByRole("dialog", { name: "options" });
    await expect(panel).toBeVisible();
    // Inside the safe areas, and off the window's edges where there are none.
    await expectInside(page, panel, insets, "the panel");
    if (insets === NO_INSETS) await expectInside(page, panel, insets, "the panel", 16);
    expect(await panel.evaluate((d) => d.scrollWidth - d.clientWidth), "the panel scrolls sideways").toBeLessThanOrEqual(0);
    await expectFingers(panel.locator("label"), "the panel's choices");
    await expectFingers(panel.locator("button, a"), "the panel's actions");
  });

  test("the Codex stands inside the safe areas, clear of the island and the home indicator, with a finger's buttons and links", async ({ page, browserName }) => {
    const insets = await sideways(page, browserName);
    await skipLesson(page);
    await questAnswered(page);
    await openWorld(page);
    const abbey = (await probe(page)).landmarks?.find((l) => l.holds === "about");
    if (!abbey) throw new Error("no abbey in the world");
    await page.goto(`${WORLD}&at=${abbey.id}`);
    await page.waitForFunction(() => (window as unknown as { __flight?: Probe }).__flight?.readyAt != null, null, { timeout: 30_000 });
    await takeWing(page);
    // Space lands once the prompt offers the abbey: the flight starts just south of it, heading for it.
    await expect
      .poll(
        async () => {
          await page.keyboard.press(" ");
          return (await flier(page)).phase;
        },
        { timeout: 20_000, message: "landing at the abbey" },
      )
      .not.toBe("flying");
    const codex = page.getByRole("dialog", { name: PROFILE.name, exact: true });
    await expect(codex).toBeVisible({ timeout: 20_000 });
    await expectInside(page, codex, insets, "the Codex");
    await expectFingers(codex.getByRole("button", { name: /^(Take off|Read the minimal version)/ }), "the Codex's buttons");
    await expectFingers(codex.getByRole("link"), "the Codex's links");
  });

  for (const height of [SIDEWAYS.height, 292]) {
    test(`the hall keeps Take off and Look for the glass whole at ${height} px tall`, async ({ page, browserName }) => {
      // 338 px is Safari with one tab, 292 px with its tab bar showing.
      const insets = await sideways(page, browserName);
      await page.setViewportSize({ width: SIDEWAYS.width, height });
      await skipLesson(page);
      await questAnswered(page);
      const codex = await landAtHall(page);
      await expectInside(page, codex, insets, "the hall");
      const buttons = codex.getByRole("button", { name: /^(Take off|Look for the glass)/ });
      await expect(buttons).toHaveCount(2);
      await expectFingers(buttons, "the hall's buttons");
      await expectInSheet(codex, buttons, "a button");
      await expectWholeHeading(codex);
    });

    test(`the hall with all five panes found keeps Take off and Write to Daniel whole at ${height} px tall`, async ({ page, browserName }) => {
      const insets = await sideways(page, browserName);
      await page.setViewportSize({ width: SIDEWAYS.width, height });
      await skipLesson(page);
      await questDone(page);
      const codex = await landAtHall(page);
      await expectInside(page, codex, insets, "the hall");
      // The ending's one link, in reach: not behind a scroll, and not twice for a reader.
      const write = codex.getByRole("link", { name: "Write to Daniel" });
      await expect(write).toHaveCount(1);
      const shown = codex.getByRole("button", { name: /^Take off/ }).or(write);
      await expect(shown).toHaveCount(2);
      await expectFingers(shown, "the hall's ending");
      await expectInSheet(codex, shown, "Take off or Write to Daniel");
      await expectWholeHeading(codex);
    });
  }
});

test("the phone's title sets every word at 16 px or more", { tag: "@phone" }, async ({ page }) => {
  const size = page.viewportSize();
  test.skip(!size || size.width >= 700, "phones only");
  await page.goto("/");
  const sizes = await page.locator("[data-side=phone]").evaluate((root) => {
    const out: { text: string; px: number }[] = [];
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const text = (n.textContent ?? "").trim();
      const el = n.parentElement;
      if (!text || !el || el.getClientRects().length === 0) continue;
      // Words read by a screen reader alone are not set at any size.
      if (getComputedStyle(el).clipPath === "inset(50%)") continue;
      out.push({ text, px: parseFloat(getComputedStyle(el).fontSize) });
    }
    return out;
  });
  expect(sizes.length).toBeGreaterThan(0);
  for (const s of sizes) expect(s.px, `"${s.text}"`).toBeGreaterThanOrEqual(16);
});
