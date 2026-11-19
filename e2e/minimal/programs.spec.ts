// Full-screen programs (work, cbonsai, claude) run in the prompt's place and give it back.

import { expect, test } from "../support";
import { focused, offer, openMinimal, prompt, status } from "./minimal";

test.describe("programs on a phone", () => {
  test("a full-screen program takes the prompt's place, whole on screen, and gives it back", async ({ page }) => {
    await openMinimal(page);
    await page.locator(".mt-jump").tap();
    await offer(page, "cbonsai").tap();
    await expect(page.locator(".mt-screen .term-grid-row").first()).toBeAttached();
    await expect(page.locator(".mt-form")).toHaveCount(0);
    await page.waitForFunction(() => {
      const r = document.querySelector(".mt-screen")?.getBoundingClientRect();
      return !!r && r.top >= 32 && r.bottom <= innerHeight;
    });
    // Nothing pinned at the bottom while it runs, either.
    await expect(page.locator(".mt-jump")).toBeHidden();
    await expect(status(page)).toHaveText(/^cbonsai is running\./);

    await page.locator(".mt-quit").tap();
    await expect(page.locator(".mt-form")).toHaveCount(1);
    await expect(page.locator(".mt-screen")).toHaveCount(0);
  });

  test("a program that reads text keeps its hidden field at the top of its pane, and a press gives it the keys", async ({ page }) => {
    await openMinimal(page);
    await page.locator(".mt-jump").tap();
    await offer(page, "claude").tap();
    await expect(page.locator(".mt-screen .term-grid-row").first()).toBeAttached();
    // At the top, the field is on screen with the keyboard up or down, so Safari never pans to it.
    const { field, pane } = await page.evaluate(() => ({
      field: document.querySelector(".mt-screen .term-hidden-input")?.getBoundingClientRect().top ?? NaN,
      pane: document.querySelector(".mt-screen")?.getBoundingClientRect().top ?? NaN,
    }));
    expect(field - pane).toBeGreaterThanOrEqual(0);
    expect(field - pane).toBeLessThan(60);
    await page.locator(".mt-screen .term-grid").tap();
    expect(await page.evaluate(() => document.activeElement?.className)).toBe("term-hidden-input");
    await page.locator(".mt-quit").tap();
    await expect(page.locator(".mt-form")).toHaveCount(1);
  });
});

test.describe("programs at a desk", { tag: "@desktop" }, () => {
  test("Escape leaves a program, and the prompt takes the keys back", async ({ page }) => {
    await openMinimal(page);
    await prompt(page).focus();
    await page.keyboard.type("cbonsai");
    await page.keyboard.press("Enter");
    await expect(page.locator(".mt-screen .term-grid-row").first()).toBeAttached();
    await page.keyboard.press("Escape");
    await expect(page.locator(".mt-form")).toHaveCount(1);
    await expect.poll(() => focused(page)).toBe("prompt");
  });
});
