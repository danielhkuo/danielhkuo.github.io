// Commands by typing: on a phone's keyboard, and with a real one and a mouse in the desktop window. Focus follows
// what the visitor is using: keys and a mouse get the prompt, a finger does not.

import { expect, test } from "../support";
import { enter, focused, lastCommand, offer, openMinimal, outputHeight, prompt, restingTop, settled, status } from "./minimal";

test.describe("typing on a phone", () => {
  test("a typed command runs on Enter and keeps focus in the prompt", async ({ page }) => {
    await openMinimal(page);
    await prompt(page).tap();
    await page.keyboard.type("pwd");
    await page.keyboard.press("Enter");
    await expect(page.locator(".mt-log .mt-line").last()).toHaveText("/Users/daniel");
    expect(await focused(page)).toBe("prompt");
    await expect(prompt(page)).toHaveValue("");
  });

  test("after a typed command the prompt is still on screen, at the bottom", async ({ page }) => {
    await openMinimal(page);
    await prompt(page).tap();
    await page.keyboard.type("help");
    await page.keyboard.press("Enter");
    await expect(lastCommand(page)).toHaveText("help");
    await settled(page);
    const { bottom, height } = await page.evaluate(() => ({
      bottom: document.querySelector(".mt-form")?.getBoundingClientRect().bottom ?? Infinity,
      height: window.visualViewport?.height ?? innerHeight,
    }));
    expect(bottom, "the prompt rests on the bottom of the visible area").toBeLessThanOrEqual(height);
    expect(bottom).toBeGreaterThan(height - 40);
  });
});

test.describe("typing at a desk", { tag: "@desktop" }, () => {
  test("an unknown command is reported the way zsh reports it", async ({ page }) => {
    await openMinimal(page);
    await enter(page, "nope");
    await expect(status(page)).toHaveText("zsh: command not found: nope");
  });

  test("Tab completes when there is something to complete, and otherwise moves on", async ({ page }) => {
    await openMinimal(page);
    await prompt(page).focus();
    await page.keyboard.type("neo");
    await page.keyboard.press("Tab");
    await expect(prompt(page)).toHaveValue("neofetch");
    expect(await focused(page)).toBe("prompt");
    // Nothing left to complete: Tab leaves the prompt. It is not a keyboard trap.
    await page.keyboard.press("Tab");
    expect(await focused(page)).not.toBe("prompt");
  });

  test("Shift+Tab always leaves the prompt, back to the suggestions", async ({ page }) => {
    await openMinimal(page);
    await prompt(page).focus();
    await page.keyboard.type("neo");
    await page.keyboard.press("Shift+Tab");
    expect(await page.evaluate(() => document.activeElement?.className)).toBe("mt-offer");
  });

  test("the suggestions are one Tab stop, and the arrow keys move inside them", async ({ page }) => {
    await openMinimal(page);
    await prompt(page).focus();
    await page.keyboard.press("Shift+Tab");
    expect(await page.evaluate(() => document.activeElement?.textContent)).toBe("help");
    await page.keyboard.press("ArrowRight");
    expect(await page.evaluate(() => document.activeElement?.textContent)).toBe("ls");
    await page.keyboard.press("Tab");
    expect(await focused(page)).toBe("prompt");
  });

  test("the arrow keys recall earlier lines, and the right arrow accepts the suggestion", async ({ page }) => {
    await openMinimal(page);
    await prompt(page).focus();
    await page.keyboard.type("whoami");
    await page.keyboard.press("Enter");
    await expect(lastCommand(page)).toHaveText("whoami");
    await page.keyboard.press("ArrowUp");
    await expect(prompt(page)).toHaveValue("whoami");
    await page.keyboard.press("ArrowDown");
    await expect(prompt(page)).toHaveValue("");
    await page.keyboard.type("cbon");
    await page.keyboard.press("ArrowRight");
    await expect(prompt(page)).toHaveValue("cbonsai ");
  });

  test("a command pressed with the keyboard leaves focus on its button", async ({ page }) => {
    await openMinimal(page);
    await prompt(page).focus();
    await page.keyboard.press("Shift+Tab");
    await page.keyboard.press("Enter");
    await expect(status(page)).toHaveText(/^help: printed/);
    expect(await page.evaluate(() => document.activeElement?.textContent)).toBe("help");
  });

  test("⌘K goes to the prompt from anywhere on the page", async ({ page }) => {
    await openMinimal(page);
    await page.keyboard.press("Meta+k");
    await expect.poll(() => focused(page)).toBe("prompt");
    const bottom = await page.locator(".mt-form").evaluate((el) => el.getBoundingClientRect().bottom);
    expect(bottom).toBeLessThanOrEqual(page.viewportSize()?.height ?? 0);
  });
});

test.describe("a mouse in a short window", { tag: "@desktop" }, () => {
  // Short, so that help's output is taller than the window. help is the longest output that depends on neither the
  // pinned repos nor content.ts: 559px at this width. The projects file is one line long in a build without
  // GITHUB_TOKEN, which has no repos, and the longest file from content.ts is 338px.
  test.use({ viewport: { width: 1280, height: 440 } });

  test("a clicked command leaves the keys with the prompt, and long output starts at the top", async ({ page }) => {
    await openMinimal(page);
    await page.locator(".mt-jump").click();
    await expect.poll(() => focused(page)).toBe("prompt");
    await offer(page, "help").click();
    await expect.poll(() => focused(page)).toBe("prompt");
    await page.locator(".mt-log button", { hasText: "cat <file>" }).click();
    await expect(prompt(page)).toHaveValue("cat ");
    expect(await focused(page)).toBe("prompt");
    // A change of mind: help again, clicked in its own list while "cat " is on the prompt. Running it empties the
    // prompt, and WebKit scrolls to a focused field whose value a script changes. The page must still be at the top
    // of the output once it has settled, with the prompt below the fold, though the prompt has the keys.
    await page.locator(".mt-log .mt-help dt button", { hasText: /^help$/ }).first().click();
    await expect(page.locator(".mt-log .mt-typed-cmd")).toHaveText(["help", "help"]);
    await expect(prompt(page)).toHaveValue("");
    const height = page.viewportSize()?.height ?? 0;
    expect(
      await outputHeight(page),
      `the premise: help prints more than the ${height}px window holds, or the page cannot bring its first line to the top. If this fails, help got shorter: make the window shorter.`,
    ).toBeGreaterThan(height);
    const top = await restingTop(page);
    expect(top).toBeGreaterThanOrEqual(32);
    expect(top).toBeLessThan(60);
    const below = await page.locator(".mt-form").evaluate((el) => el.getBoundingClientRect().top - innerHeight);
    expect(below, "the prompt is below the fold").toBeGreaterThan(0);
    expect(await focused(page)).toBe("prompt");
  });
});
