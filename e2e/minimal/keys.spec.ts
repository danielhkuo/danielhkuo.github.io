// nano's keys at a desk: ^G Help, ^/ Go To Line, ^F Where Is and ^X Exit, with Esc closing what is open. Only
// Control alone is taken; the browser keeps its own.

import { PROFILE } from "../../src/components/terminal/content.ts";
import { TEXT_PAGE } from "../../src/lib/site-content.ts";
import { expect, offline, test } from "../support";
import { focused, goTo, help, isOpen, openMinimal, searchField, selected, selectionPlace, status } from "./minimal";

test.describe("the keys", { tag: "@desktop" }, () => {
  test("^G opens Help and takes focus into it; ^X closes it and stays on the page", async ({ page }) => {
    await openMinimal(page);
    await page.keyboard.press("Control+g");
    expect(await isOpen(help(page))).toBe(true);
    expect(await page.evaluate(() => document.activeElement?.closest("#nano-help") !== null)).toBe(true);
    await page.keyboard.press("Control+x");
    expect(await isOpen(help(page))).toBe(false);
    expect(new URL(page.url()).pathname).toBe(TEXT_PAGE);
  });

  test("Esc closes Help; with nothing open, Esc leaves for the title", async ({ page }) => {
    await offline(page);
    await openMinimal(page);
    await page.keyboard.press("Control+g");
    await page.keyboard.press("Escape");
    expect(await isOpen(help(page))).toBe(false);
    expect(new URL(page.url()).pathname).toBe(TEXT_PAGE);
    await page.keyboard.press("Escape");
    await page.waitForURL((url) => url.pathname === "/");
  });

  test("^X with nothing open leaves for the title", async ({ page }) => {
    await offline(page);
    await openMinimal(page);
    await page.keyboard.press("Control+x");
    await page.waitForURL((url) => url.pathname === "/");
  });

  test("^/ lists the sections; choosing one goes there and takes focus to its heading", async ({ page }) => {
    await openMinimal(page);
    await page.keyboard.press("Control+/");
    expect(await isOpen(goTo(page))).toBe(true);
    await goTo(page).getByRole("link", { name: /CONTACT/ }).click();
    expect(await isOpen(goTo(page))).toBe(false);
    expect(new URL(page.url()).hash).toBe("#contact");
    expect(await focused(page)).toBe("contact");
    const { top, bar, end } = await page.evaluate(() => ({
      top: document.getElementById("contact")?.getBoundingClientRect().top ?? NaN,
      bar: document.querySelector(".nano > .nano-bar")?.getBoundingClientRect().bottom ?? NaN,
      end: scrollY >= document.documentElement.scrollHeight - innerHeight - 1,
    }));
    // Clear of the title bar, and just under it, unless the page ran out first: a build without repos is short.
    expect(top).toBeGreaterThanOrEqual(bar);
    if (!end) expect(top).toBeLessThan(bar + 60);
  });

  test("^F finds a word: it is selected, brought on screen, and announced", async ({ page }) => {
    await openMinimal(page);
    await page.keyboard.press("Control+f");
    await expect(searchField(page)).toBeFocused();
    await expect(page.locator(".nano-find label")).toHaveText("Search:");
    await page.keyboard.type(PROFILE.location);
    await page.keyboard.press("Enter");
    await expect(searchField(page)).toHaveCount(0);
    expect(await selected(page)).toBe(PROFILE.location);
    await expect(status(page).locator(".nano-message")).toHaveText("[ This is the only occurrence ]");
    await expect(status(page).locator(".nano-sr")).toHaveText(`Found “${PROFILE.location}”, 1 of 1.`);
    const place = await selectionPlace(page);
    expect(place.top).toBeGreaterThanOrEqual(place.barBottom);
    expect(place.bottom).toBeLessThanOrEqual(place.footTop);
  });

  test("an empty Enter repeats the last search, from the last match on, and wraps at the end", async ({ page }) => {
    await openMinimal(page);
    // "site" is in the summaries of the site's other pages, more than once, whatever the repos say.
    await page.keyboard.press("Control+f");
    await page.keyboard.type("site");
    await page.keyboard.press("Enter");
    expect((await selected(page)).toLowerCase()).toBe("site");
    const where = () => page.evaluate(() => window.getSelection()?.getRangeAt(0).getBoundingClientRect().top ?? NaN);
    const starts: number[] = [await page.evaluate(() => scrollY + (window.getSelection()?.getRangeAt(0).getBoundingClientRect().top ?? 0))];
    let wrapped = false;
    for (let i = 0; i < 30 && !wrapped; i++) {
      await page.keyboard.press("Control+f");
      await expect(page.locator(".nano-find label")).toHaveText("Search [site]:");
      await page.keyboard.press("Enter");
      expect((await selected(page)).toLowerCase()).toBe("site");
      wrapped = (await status(page).locator(".nano-message").count()) > 0 && (await status(page).innerText()).includes("Search Wrapped");
      if (!wrapped) starts.push(await page.evaluate(() => scrollY + (window.getSelection()?.getRangeAt(0).getBoundingClientRect().top ?? 0)));
    }
    expect(wrapped, "the search wrapped").toBe(true);
    expect(starts.length).toBeGreaterThanOrEqual(2);
    // Each repeat went on down the page; the wrap went back to the first.
    for (let i = 1; i < starts.length; i++) expect(starts[i]).toBeGreaterThanOrEqual(starts[i - 1]);
    expect(Number.isFinite(await where())).toBe(true);
  });

  test("a word that is not there is reported, and Esc cancels a search", async ({ page }) => {
    await openMinimal(page);
    await page.keyboard.press("Control+f");
    await page.keyboard.type("zzqqx");
    await page.keyboard.press("Enter");
    await expect(status(page).locator(".nano-message")).toHaveText('[ "zzqqx" not found ]');
    await page.keyboard.press("Control+f");
    await page.keyboard.press("Escape");
    await expect(searchField(page)).toHaveCount(0);
    await expect(status(page).locator(".nano-message")).toHaveText("[ Cancelled ]");
    expect(new URL(page.url()).pathname).toBe(TEXT_PAGE);
  });

  test("in the search field ^X is the field's own, and leaves nothing", async ({ page }) => {
    await openMinimal(page);
    await page.keyboard.press("Control+f");
    await page.keyboard.type("abc");
    await page.keyboard.press("Control+x");
    await expect(searchField(page)).toBeFocused();
    expect(new URL(page.url()).pathname).toBe(TEXT_PAGE);
  });

  test("the browser's own Command keys are left alone", async ({ page }) => {
    await openMinimal(page);
    for (const k of ["Meta+g", "Meta+f", "Meta+x", "Alt+g"]) await page.keyboard.press(k);
    expect(await isOpen(help(page))).toBe(false);
    await expect(searchField(page)).toHaveCount(0);
    expect(new URL(page.url()).pathname).toBe(TEXT_PAGE);
  });

  test("a mouse on the keys: Help, Go To Line and Where Is open, Exit leaves", async ({ page }) => {
    await offline(page);
    await openMinimal(page);
    const keys = page.locator(".nano-keys");
    await keys.getByRole("button", { name: "Help", exact: true }).click();
    expect(await isOpen(help(page))).toBe(true);
    await help(page).getByRole("button", { name: "Close" }).click();
    await keys.getByRole("button", { name: "Go To Line" }).click();
    expect(await isOpen(goTo(page))).toBe(true);
    await goTo(page).getByRole("button", { name: "Close" }).click();
    await keys.getByRole("button", { name: "Where Is" }).click();
    await expect(searchField(page)).toBeFocused();
    await page.keyboard.press("Escape");
    // Focus goes back to the key that opened the search.
    expect(await page.evaluate(() => document.activeElement?.textContent?.trim())).toBe("^F Where Is");
    await keys.getByRole("link", { name: /^Exit/ }).click();
    await page.waitForURL((url) => url.pathname === "/");
  });

  test("on a desktop all twelve of nano's shortcuts are shown, in nano's two rows", async ({ page }) => {
    await openMinimal(page);
    const tops = await page.locator(".nano-keys > *").evaluateAll((els) => els.map((el) => Math.round(el.getBoundingClientRect().top)));
    expect(tops).toHaveLength(12);
    expect(new Set(tops).size).toBe(2);
    expect(await page.evaluate(() => parseFloat(getComputedStyle(document.querySelector(".nano") as Element).fontSize))).toBe(15);
  });
});
