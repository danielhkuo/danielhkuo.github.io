// What every end-to-end spec shares: a test that fails on any console error or uncaught exception, and the world
// page opened with ?stats, read through the probe it sets on window.__flight (src/app/world/session.ts).

import { expect, test as base, type Page } from "@playwright/test";
import { LESSON_KEY } from "../src/world/controls/lesson.ts";

/** What /world?stats reports on window.__flight: only what the suite reads. */
export interface Probe {
  readyAt: number | null;
  error: string | null;
  workerErrors: string[];
  frames: number;
  hazeFrames: number;
  state?: () => FlierState;
  landmarks?: { id: string; holds: string; name: string | null }[];
}

export interface FlierState {
  x: number;
  y: number;
  heading: number;
  speed: number;
  phase: string;
}

/** The world at noon in clear weather, so a run does not depend on the hour it is run at. */
export const WORLD = "/world?stats&time=noon&weather=clear";

export const test = base.extend<{ errors: string[] }>({
  // Every page is checked: a console error or an uncaught exception fails the test. A test that expects one takes it
  // out of `errors` before it ends.
  errors: [
    async ({ page }, use) => {
      const errors: string[] = [];
      page.on("console", (m) => {
        if (m.type() === "error") errors.push(`console: ${m.text()}`);
      });
      page.on("pageerror", (e) => errors.push(`exception: ${e.message}`));
      await use(errors);
      expect(errors, "errors in the page").toEqual([]);
    },
    { auto: true },
  ],
});

export { expect };

/** Keeps a page on this machine: third-party requests (the contact form's hCaptcha) get an empty reply. */
export async function offline(page: Page): Promise<void> {
  await page.route(/^https?:\/\/(?!127\.0\.0\.1[:/])/, (route) => route.fulfill({ status: 200, body: "" }));
}

/** The probe, read in the page. */
export function probe(page: Page): Promise<Omit<Probe, "state"> & { state: FlierState | null }> {
  return page.evaluate(() => {
    const f = (window as unknown as { __flight?: Probe }).__flight;
    if (!f) throw new Error("no window.__flight: open the world with ?stats");
    return {
      readyAt: f.readyAt,
      error: f.error,
      workerErrors: [...f.workerErrors],
      frames: f.frames,
      hazeFrames: f.hazeFrames,
      landmarks: f.landmarks,
      state: f.state ? f.state() : null,
    };
  });
}

/** Where the dragon is and what it is doing. */
export async function flier(page: Page): Promise<FlierState> {
  const s = (await probe(page)).state;
  if (!s) throw new Error("the probe has no state()");
  return s;
}

/** Marks the first-flight lesson learned before the page opens, so it does not take the place by the dragon. */
export async function skipLesson(page: Page): Promise<void> {
  await page.addInitScript((key) => {
    try {
      window.localStorage.setItem(key, "learned");
    } catch {
      // storage refused: the lesson shows
    }
  }, LESSON_KEY);
}

/** Opens the world (`query` is added to WORLD) and waits for its first full view of the land. */
export async function openWorld(page: Page, query = ""): Promise<void> {
  await page.goto(`${WORLD}${query}`);
  await page.waitForFunction(
    () => {
      const f = (window as unknown as { __flight?: Probe }).__flight;
      return !!f && (f.readyAt !== null || f.error !== null);
    },
    null,
    { timeout: 30_000 },
  );
  const p = await probe(page);
  expect(p.error, "the world failed to load").toBeNull();
  expect(p.workerErrors, "bake worker errors").toEqual([]);
}

/** The guide by the dragon, in words: the live region the page keeps for screen readers. */
export function guide(page: Page) {
  return page.locator("p[aria-live]");
}

/** Holds `key` down for `ms`, then lets go. */
export async function hold(page: Page, key: string, ms: number): Promise<void> {
  await page.keyboard.down(key);
  await page.waitForTimeout(ms);
  await page.keyboard.up(key);
}

/** The signed difference b − a between two headings, in (−π, π]. */
export function turned(a: number, b: number): number {
  let d = (b - a) % (2 * Math.PI);
  if (d > Math.PI) d -= 2 * Math.PI;
  if (d <= -Math.PI) d += 2 * Math.PI;
  return d;
}
