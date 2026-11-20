// axe on what `npm run a11y` cannot see: the page with each of its screens open. (npm run a11y checks it as it
// loads, at phone and desktop widths, light and dark.)

import { readFileSync } from "node:fs";
import type { Page } from "@playwright/test";
import { expect, test } from "../support";
import { key, openMinimal, searchField } from "./minimal";

// Playwright loads the specs as CommonJS, so `require` is there to resolve the package.
const AXE = readFileSync(require.resolve("axe-core/axe.min.js"), "utf8");

/** axe's violations on the page as it is now: each as its rule and where. */
async function violations(page: Page): Promise<string[]> {
  await page.addScriptTag({ content: AXE });
  return page.evaluate(async () => {
    const axe = (window as unknown as { axe: { run: (c: Document, o: object) => Promise<{ violations: { id: string; nodes: { target: string[] }[] }[] }> } }).axe;
    const { violations } = await axe.run(document, { resultTypes: ["violations"] });
    return violations.flatMap((v) => v.nodes.map((n) => `${v.id} at ${n.target.join(" ")}`));
  });
}

test.describe("axe with a screen open", () => {
  test("Help", async ({ page }) => {
    await openMinimal(page);
    await key(page, "Help").click();
    expect(await violations(page)).toEqual([]);
  });

  test("Go To Line", async ({ page }) => {
    await openMinimal(page);
    await key(page, "Go To Line").click();
    expect(await violations(page)).toEqual([]);
  });

  test("the search prompt, and its answer", async ({ page }) => {
    await openMinimal(page);
    await key(page, "Where Is").click();
    await expect(searchField(page)).toBeFocused();
    expect(await violations(page), "prompt open").toEqual([]);
    await page.keyboard.type("zzqqx");
    await page.keyboard.press("Enter");
    expect(await violations(page), "not found").toEqual([]);
  });
});
