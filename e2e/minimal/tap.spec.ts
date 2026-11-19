// Commands by tap. Every command can be run without a keyboard: from the row above the prompt, and from the command
// and file names in the terminal's own output. A tap gives the prompt no focus, so a phone's keyboard stays shut.

import { expect, test } from "../support";
import { enter, focused, lastCommand, offer, openMinimal, outputHeight, prompt, restingTop, status } from "./minimal";

test.describe("commands by tap", () => {
  test("the jump button brings the prompt on screen without focusing it, then goes away", async ({ page }) => {
    await openMinimal(page);
    await page.locator(".mt-jump").tap();
    await page.waitForFunction(() => (document.querySelector(".mt-form")?.getBoundingClientRect().bottom ?? Infinity) <= innerHeight + 1);
    expect(await focused(page)).toBe("BODY");
    await expect(page.locator(".mt-jump")).toBeHidden();
  });

  test("a tapped command prints above the prompt, says so in one line, and leaves the prompt unfocused", async ({ page }) => {
    await openMinimal(page);
    await page.locator(".mt-jump").tap();
    await offer(page, "help").tap();
    await expect(lastCommand(page)).toHaveText("help");
    // On a phone the prompt is the short one: user@host is not shown.
    expect((await page.locator(".mt-log .mt-cmd .mt-ps").last().innerText()).trim()).toBe("~ %");
    expect(await page.locator(".mt-log .mt-help dt").count()).toBeGreaterThanOrEqual(12);
    await expect(status(page)).toHaveText(/^help: printed \d+ lines above the prompt\.$/);
    // Focus is not on the prompt: on a phone the keyboard stays shut and the screen is left to the output.
    expect(await focused(page)).not.toBe("prompt");
  });

  test("output taller than the screen starts at the top, under the title bar", async ({ page }) => {
    await openMinimal(page);
    await page.locator(".mt-jump").tap();
    await offer(page, "help").tap();
    await expect(lastCommand(page)).toHaveText("help");
    const height = page.viewportSize()?.height ?? 0;
    expect(
      await outputHeight(page),
      `the premise: help prints more than the ${height}px screen holds. If this fails, help got shorter: use a longer output that does not depend on the pinned repos.`,
    ).toBeGreaterThan(height);
    // Under the title bar (32px), with nothing of it cut off.
    const top = await restingTop(page);
    expect(top).toBeGreaterThanOrEqual(32);
    expect(top).toBeLessThan(60);
  });

  test("a command that needs a file goes on the prompt, and the row becomes the files", async ({ page }) => {
    await openMinimal(page);
    await page.locator(".mt-jump").tap();
    await offer(page, "cat").tap();
    await expect(prompt(page)).toHaveValue("cat ");
    const files = await page.locator(".mt-offers button").allTextContents();
    expect(files).toEqual(expect.arrayContaining(["about.md", "projects/"]));
    // Still no focus, so still no keyboard: the next word can be tapped too.
    expect(await focused(page)).not.toBe("prompt");

    await offer(page, "projects/").tap();
    await expect(prompt(page)).toHaveValue("cat projects/");
    await offer(page, "README.md").tap();
    await expect(prompt(page)).toHaveValue("");
    await expect(page.locator(".mt-log h2").last()).toHaveText("Projects");
  });

  test("a name that ls printed can be tapped: a file is read, a directory listed", async ({ page }) => {
    await openMinimal(page);
    await page.locator(".mt-jump").tap();
    await offer(page, "ls").tap();
    await page.locator(".mt-log button", { hasText: "contact.md" }).tap();
    await expect(page.locator(".mt-log h2").last()).toHaveText("Contact");
    await page.locator(".mt-log button", { hasText: "projects/" }).tap();
    await expect(lastCommand(page)).toHaveText("ls projects");
  });

  test("every command help lists is a button", async ({ page }) => {
    await openMinimal(page);
    await page.locator(".mt-jump").tap();
    await offer(page, "help").tap();
    await expect(page.locator(".mt-log .mt-help dt")).not.toHaveCount(0);
    const rows = await page.locator(".mt-log .mt-help dt").count();
    await expect(page.locator(".mt-log .mt-help dt button")).toHaveCount(rows);
    await page.locator(".mt-log .mt-help dt button", { hasText: "pwd" }).tap();
    await expect(status(page)).toHaveText("/Users/daniel");
  });

  test("a command help lists with its usage runs as the command alone, or goes on the prompt for its file", async ({ page }) => {
    await openMinimal(page);
    await page.locator(".mt-jump").tap();
    await offer(page, "help").tap();
    // `ls [-la] [path]` is `ls`: the placeholders are not something to run.
    await page.locator(".mt-log .mt-help dt button", { hasText: "ls [-la] [path]" }).tap();
    await expect(lastCommand(page)).toHaveText("ls");
    await expect(status(page)).toHaveText(/^ls: printed \d+ lines? above the prompt\.$/);
    // `cat <file>` needs its file: it goes on the prompt and the row offers the files.
    await page.locator(".mt-log .mt-help dt button", { hasText: "cat <file>" }).tap();
    await expect(prompt(page)).toHaveValue("cat ");
    expect(await page.locator(".mt-offers button").allTextContents()).toContain("about.md");
  });

  test("clear clears what the session printed and leaves the page's own sections", async ({ page }) => {
    await openMinimal(page);
    await enter(page, "help");
    await expect(page.locator(".mt-log > *")).not.toHaveCount(0);
    await enter(page, "clear");
    await expect(page.locator(".mt-log > *")).toHaveCount(0);
    await expect(page.locator("h2")).toHaveText(["Projects", "Contact", "Elsewhere on this site"]);
    await expect(status(page)).toHaveText("clear: done.");
  });
});
