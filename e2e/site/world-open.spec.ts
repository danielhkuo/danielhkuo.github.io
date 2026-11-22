// Opening the world: it loads, the land shows with no haze once the first view is in, and the frame fills the window
// edge to edge in hard pixels at desktop and phone sizes, with nothing to scroll.

import type { Page } from "@playwright/test";
import { fitFrame, FRAME_PIXELS } from "../../src/world/runtime/fit.ts";
import { expect, openWorld, probe, skipLesson, takeWing, test } from "../support";

/** The window's sizes the frame is checked at on a desktop; a phone is checked upright and turned. */
const DESKTOP = [
  { width: 1920, height: 1080 },
  { width: 1440, height: 900 },
  { width: 2560, height: 1080 },
];

/** How the canvas sits in the window, and whether the page can scroll. */
function measure(page: Page) {
  return page.evaluate(() => {
    const c = document.querySelector("canvas");
    if (!c) throw new Error("no canvas");
    const r = c.getBoundingClientRect();
    const v = window.visualViewport;
    const se = document.scrollingElement ?? document.documentElement;
    return {
      vw: v ? Math.round(v.width) : window.innerWidth,
      vh: v ? Math.round(v.height) : window.innerHeight,
      dpr: window.devicePixelRatio || 1,
      w: c.width,
      h: c.height,
      left: r.left,
      top: r.top,
      right: r.right,
      bottom: r.bottom,
      cssW: r.width,
      cssH: r.height,
      scrollW: se.scrollWidth,
      scrollH: se.scrollHeight,
      innerW: window.innerWidth,
      innerH: window.innerHeight,
    };
  });
}

/** Checks the frame covers the window from its top-left corner, at a whole number of device pixels per frame pixel. */
async function expectFills(page: Page) {
  // The frame is fitted again on resize, and the canvas follows on the next frame.
  await expect
    .poll(async () => {
      const m = await measure(page);
      const want = fitFrame(m.vw, m.vh, m.dpr);
      return `${m.w}x${m.h}` === `${want.w}x${want.h}` && Math.abs(m.cssW * m.dpr - m.w * want.scale) < 0.5;
    })
    .toBe(true);
  const m = await measure(page);
  const label = `${m.vw}x${m.vh} at ${m.dpr}x`;
  const px = m.cssW / m.w;
  expect(m.w * m.h, `${label}: frame pixels`).toBeLessThanOrEqual(FRAME_PIXELS);
  expect(m.left, `${label}: left edge`).toBe(0);
  expect(m.top, `${label}: top edge`).toBe(0);
  expect(m.right, `${label}: right edge`).toBeGreaterThanOrEqual(m.vw - 0.01);
  expect(m.bottom, `${label}: bottom edge`).toBeGreaterThanOrEqual(m.vh - 0.01);
  expect(m.right - m.vw, `${label}: overhang right`).toBeLessThan(px);
  expect(m.bottom - m.vh, `${label}: overhang bottom`).toBeLessThan(px);
  // Square pixels: as many CSS pixels per frame pixel down as across.
  expect(Math.abs(m.cssH / m.h - px), `${label}: square pixels`).toBeLessThan(1e-3);
  expect(m.scrollW, `${label}: nothing to scroll across`).toBeLessThanOrEqual(m.innerW);
  expect(m.scrollH, `${label}: nothing to scroll down`).toBeLessThanOrEqual(m.innerH);
}

/** Distinct colours on the canvas, and the share of the commonest: a blank or hazy frame has few, and one dominates. */
function colours(page: Page) {
  return page.evaluate(() => {
    const c = document.querySelector("canvas");
    const ctx = c?.getContext("2d");
    if (!c || !ctx) throw new Error("no canvas");
    const data = new Uint32Array(ctx.getImageData(0, 0, c.width, c.height).data.buffer);
    const counts = new Map<number, number>();
    for (const v of data) counts.set(v, (counts.get(v) ?? 0) + 1);
    return { distinct: counts.size, top: Math.max(...counts.values()) / data.length };
  });
}

test.describe("opening the world", () => {
  test("loads, and shows the land with no haze", { tag: "@phone" }, async ({ page, isMobile }) => {
    await skipLesson(page);
    await openWorld(page);
    if (isMobile) await takeWing(page);
    // The first full view is in; within a few seconds a whole second goes by with every frame clear of haze.
    await expect
      .poll(
        async () => {
          const a = await probe(page);
          await page.waitForTimeout(1000);
          const b = await probe(page);
          return b.frames > a.frames && b.hazeFrames === a.hazeFrames;
        },
        { timeout: 20_000, intervals: [0] },
      )
      .toBe(true);
    const c = await colours(page);
    expect(c.distinct, "colours on the land").toBeGreaterThan(200);
    expect(c.top, "the commonest colour's share").toBeLessThan(0.5);
  });

  test("the frame fills the window", { tag: "@phone" }, async ({ page, isMobile }) => {
    await skipLesson(page);
    await openWorld(page);
    await expectFills(page);
    if (isMobile) {
      // Upright behind the first card, sideways in flight, and upright again under "turn your phone". (Take wing puts
      // an Android phone in fullscreen, locked sideways: only an iPhone can be turned back.)
      const upright = page.viewportSize();
      if (!upright) throw new Error("no viewport");
      await takeWing(page);
      await expectFills(page);
      if (await page.evaluate(() => document.fullscreenElement !== null)) return;
      await page.setViewportSize(upright);
      await expect(page.getByRole("dialog", { name: "turn your phone" })).toBeVisible();
      await expectFills(page);
      return;
    }
    for (const size of DESKTOP) {
      await page.setViewportSize(size);
      await expectFills(page);
    }
  });

  test("the page does not scroll", async ({ page }) => {
    await skipLesson(page);
    await openWorld(page);
    await page.mouse.move(400, 300);
    await page.mouse.wheel(0, 800);
    await page.mouse.wheel(600, 0);
    await page.evaluate(() => window.scrollTo(300, 600));
    await page.waitForTimeout(200);
    expect(await page.evaluate(() => [window.scrollX, window.scrollY])).toEqual([0, 0]);
  });
});
