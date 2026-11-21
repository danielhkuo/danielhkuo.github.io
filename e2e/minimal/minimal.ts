// What the minimal version's specs share: opening the page, and the parts of nano's screen they keep asking about.
//
// These run in WebKit only, the engine Safari is built on, as a phone and as a desktop window (playwright.config.ts).
// What they cannot see: Playwright's WebKit is a desktop build with no on-screen keyboard and no Safari toolbar. The
// phone's keyboard and toolbar are checked by hand in the iOS Simulator (the spec, section 13.5).

import type { Locator, Page } from "@playwright/test";
import { TEXT_PAGE } from "../../src/lib/site-content.ts";

/**
 * Opens the minimal version. With JavaScript on (`live`, the default) it also waits for the page's script to have
 * hydrated, which is when Where Is becomes a button: by then the Control keys are listened for. A quiet network is
 * not enough on a busy machine, where React may still be hydrating.
 */
export async function openMinimal(page: Page, { live = true }: { live?: boolean } = {}): Promise<void> {
  await page.goto(TEXT_PAGE, { waitUntil: "networkidle" });
  if (live) await page.locator(".nano-keys").getByRole("button", { name: "Where Is" }).waitFor();
}

/** One of the shortcuts that work, by its accessible name: Help, Where Is, Exit, Go To Line. */
export function key(page: Page, name: "Help" | "Where Is" | "Exit" | "Go To Line"): Locator {
  const keys = page.locator(".nano-keys");
  return name === "Exit" ? keys.getByRole("link", { name: /^Exit/ }) : keys.getByRole("button", { name, exact: true });
}

/** The status line: nano's messages, and what a screen reader is told. */
export function status(page: Page): Locator {
  return page.locator(".nano-status");
}

/** The Help screen (^G). */
export function help(page: Page): Locator {
  return page.locator("#nano-help");
}

/** The Go To Line screen (^/). */
export function goTo(page: Page): Locator {
  return page.locator("#nano-goto");
}

/** The Search prompt's field (^F). */
export function searchField(page: Page): Locator {
  return page.locator("#nano-find");
}

/** The text the page has selected: where a search put nano's cursor. */
export function selected(page: Page): Promise<string> {
  return page.evaluate(() => window.getSelection()?.toString() ?? "");
}

/** How far the page can be scrolled sideways: 0 when nothing overflows. */
export function sideways(page: Page): Promise<number> {
  return page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
}

/** What has focus: an id, or else the tag. */
export function focused(page: Page): Promise<string> {
  return page.evaluate(() => document.activeElement?.id || document.activeElement?.tagName || "");
}

/** Whether a popover is open. */
export function isOpen(panel: Locator): Promise<boolean> {
  return panel.evaluate((el) => el.matches(":popover-open"));
}

/** Waits until the page has stopped scrolling: the same place for a fifth of a second. */
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

/**
 * The lines of the text that the title bar or the foot (the status line and the keys) cut: each line box of each run
 * of text that is neither wholly between the two nor wholly behind one. nano shows whole lines only.
 */
export function cutLines(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const bar = document.querySelector(".nano > .nano-bar")?.getBoundingClientRect().bottom ?? NaN;
    const foot = document.querySelector(".nano-foot")?.getBoundingClientRect().top ?? NaN;
    const main = document.querySelector("main");
    if (!main) throw new Error("no text");
    const cut: string[] = [];
    const walker = document.createTreeWalker(main, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const text = n.textContent?.trim() ?? "";
      if (!text) continue;
      const range = document.createRange();
      range.selectNodeContents(n);
      for (const r of range.getClientRects()) {
        if (r.height === 0) continue;
        const behind = r.bottom <= bar + 0.5 || r.top >= foot - 0.5;
        const whole = r.top >= bar - 0.5 && r.bottom <= foot + 0.5;
        if (!behind && !whole) cut.push(`"${text.slice(0, 24)}" at ${r.top.toFixed(1)} to ${r.bottom.toFixed(1)} (bar ends ${bar.toFixed(1)}, foot starts ${foot.toFixed(1)})`);
      }
    }
    return cut;
  });
}

/** Where the selection is on screen, and the space between the title bar and the foot that it should be in. */
export function selectionPlace(page: Page): Promise<{ top: number; bottom: number; barBottom: number; footTop: number }> {
  return page.evaluate(() => {
    const range = window.getSelection()?.getRangeAt(0);
    const rect = range?.getBoundingClientRect();
    return {
      top: rect?.top ?? NaN,
      bottom: rect?.bottom ?? NaN,
      barBottom: document.querySelector(".nano-bar")?.getBoundingClientRect().bottom ?? NaN,
      footTop: document.querySelector(".nano-foot")?.getBoundingClientRect().top ?? NaN,
    };
  });
}
