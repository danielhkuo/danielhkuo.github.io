// What the minimal version's specs share: opening the page, and reading the things they keep asking about.
//
// These run in WebKit only, the engine Safari is built on, as a phone and as a desktop window (playwright.config.ts).
// What they can see: the static HTML with JavaScript off; that the document is the only scroller and the prompt is
// its last line; that nothing is pinned to the bottom while the prompt has focus; the prompt's 16px text; and what a
// tapped or typed command does to the page and to focus.
//
// What they cannot: Playwright's WebKit is a desktop build with no on-screen keyboard. The keyboard cases are measured
// in the iOS Simulator by hand (docs/superpowers/research/2026-11-19-minimal-terminal-mobile.md), and the scroll
// arithmetic they depend on is pinned in src/components/minimal/reveal.test.ts.

import type { Locator, Page } from "@playwright/test";
import { TEXT_PAGE } from "../../src/lib/site-content.ts";

/**
 * Opens the minimal version (or `path`) and waits for the network to go quiet: by then the page's script has loaded
 * and taken over the prompt. A tap before that would be the browser's own, a link followed or a form sent.
 */
export async function openMinimal(page: Page, path: string = TEXT_PAGE): Promise<void> {
  await page.goto(path, { waitUntil: "networkidle" });
}

/** A command's button in the row above the prompt. */
export function offer(page: Page, name: string): Locator {
  return page.locator(".mt-offers button", { hasText: name }).first();
}

/** The prompt's field. */
export function prompt(page: Page): Locator {
  return page.locator("#prompt");
}

/** The line that tells a screen reader what a command did. */
export function status(page: Page): Locator {
  return page.locator("[role=status]");
}

/** The last command the session ran, as it was entered. */
export function lastCommand(page: Page): Locator {
  return page.locator(".mt-log .mt-typed-cmd").last();
}

/** How far the page can be scrolled sideways: 0 when nothing overflows. */
export function sideways(page: Page): Promise<number> {
  return page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
}

/** What has focus: the prompt's id, or the tag of whatever else. */
export function focused(page: Page): Promise<string> {
  return page.evaluate(() => document.activeElement?.id || document.activeElement?.tagName || "");
}

/**
 * Waits until the page has stopped scrolling: the same place for a fifth of a second. A browser may move the page
 * again a moment after a script has (WebKit, to a focused field whose value a script changed), so where something
 * rests is read only after this.
 */
export async function settled(page: Page): Promise<void> {
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        let at = scrollY;
        let still = 0;
        const frame = () => {
          still = scrollY === at ? still + 1 : 0;
          at = scrollY;
          if (still >= 12) resolve();
          else requestAnimationFrame(frame);
        };
        requestAnimationFrame(frame);
      }),
  );
}

/** How far the last command's line is from the top of the window, once the page has settled. */
export async function restingTop(page: Page): Promise<number> {
  await settled(page);
  return page.locator(".mt-log .mt-cmd").last().evaluate((el) => el.getBoundingClientRect().top);
}

/**
 * How tall the last command's output is: from its own line to the prompt. The same wherever the page is scrolled.
 * A test of where long output comes to rest checks this first: output shorter than the window cannot be brought to
 * the top, and the page rightly leaves it resting on the prompt instead.
 */
export function outputHeight(page: Page): Promise<number> {
  return page.evaluate(() => {
    const echo = [...document.querySelectorAll(".mt-log .mt-cmd")].pop();
    const form = document.querySelector(".mt-form");
    if (!echo || !form) throw new Error("no command's line, or no prompt");
    return form.getBoundingClientRect().top - echo.getBoundingClientRect().top;
  });
}

/** Types a line at the prompt and enters it. */
export async function enter(page: Page, line: string): Promise<void> {
  await prompt(page).fill(line);
  await prompt(page).press("Enter");
}
