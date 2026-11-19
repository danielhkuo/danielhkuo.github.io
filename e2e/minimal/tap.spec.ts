// nano's keys under a finger: each of the four that work is a tap, and the search field opens at the top of the
// screen, where a phone's keyboard cannot cover it.

import { PROFILE } from "../../src/components/terminal/content.ts";
import { expect, offline, test } from "../support";
import { goTo, help, isOpen, key, openMinimal, searchField, selected, status } from "./minimal";

test.describe("the keys by tap", () => {
  test("Help opens on a tap and closes on its own ^X Close", async ({ page }) => {
    await openMinimal(page);
    await key(page, "Help").tap();
    expect(await isOpen(help(page))).toBe(true);
    await help(page).getByRole("button", { name: "Close" }).tap();
    expect(await isOpen(help(page))).toBe(false);
  });

  test("Go To Line on a tap: a tap on a section goes there", async ({ page }) => {
    await openMinimal(page);
    await key(page, "Go To Line").tap();
    await goTo(page).getByRole("link", { name: /ELSEWHERE/ }).tap();
    expect(await isOpen(goTo(page))).toBe(false);
    expect(new URL(page.url()).hash).toBe("#elsewhere");
    const top = await page.locator("#elsewhere").evaluate((el) => el.getBoundingClientRect().top);
    const bar = await page.locator(".nano > .nano-bar").evaluate((el) => el.getBoundingClientRect().bottom);
    expect(top).toBeGreaterThanOrEqual(bar);
  });

  test("Where Is on a tap: the field opens at the top, focused, with the shortcuts hidden until it is done", async ({ page }) => {
    await openMinimal(page);
    await key(page, "Where Is").tap();
    await expect(searchField(page)).toBeFocused();
    const top = await page.locator(".nano-find").evaluate((el) => el.getBoundingClientRect().top);
    expect(top).toBe(0);
    await expect(page.locator(".nano-keys")).toHaveCSS("visibility", "hidden");
    // 16px: Safari does not zoom to it.
    await expect(searchField(page)).toHaveCSS("font-size", "16px");
    await page.keyboard.type(PROFILE.school.split(" ")[0]);
    await page.keyboard.press("Enter");
    await expect(searchField(page)).toHaveCount(0);
    expect(await selected(page)).toBe(PROFILE.school.split(" ")[0]);
    await expect(page.locator(".nano-keys")).toHaveCSS("visibility", "visible");
    // A finger is not handed the keyboard again: focus is back on the key, not in a field.
    expect(await page.evaluate(() => document.activeElement?.tagName)).not.toBe("INPUT");
  });

  test("putting the keyboard away cancels the search quietly", async ({ page }) => {
    await openMinimal(page);
    await key(page, "Where Is").tap();
    await expect(searchField(page)).toBeFocused();
    await searchField(page).blur();
    await expect(searchField(page)).toHaveCount(0);
    await expect(status(page).locator(".nano-message")).toHaveCount(0);
  });

  test("Exit on a tap goes back to the title", async ({ page }) => {
    await offline(page);
    await openMinimal(page);
    await key(page, "Exit").tap();
    await page.waitForURL((url) => url.pathname === "/");
  });
});
