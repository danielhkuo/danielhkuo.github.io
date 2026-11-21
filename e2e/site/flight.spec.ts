// Flight by keyboard: the keys steer and set the speed, the first-flight guide teaches and fades, the options panel
// opens and closes, and Esc leaves the world.

import { LESSON_KEY } from "../../src/world/controls/lesson.ts";
import { QUEST_KEY } from "../../src/world/story/quest.ts";
import { CRUISE } from "../../src/world/runtime/flight.ts";
import { expect, flier, guide, hold, offline, openWorld, skipLesson, test, turned } from "../support";

test.describe("flight", () => {
  test("the keys steer the dragon and set its speed", async ({ page }) => {
    await skipLesson(page);
    await openWorld(page);
    const a = await flier(page);
    expect(a.phase).toBe("flying");

    // Left turns anticlockwise on screen (the heading falls), right clockwise.
    await hold(page, "ArrowLeft", 700);
    const b = await flier(page);
    expect(turned(a.heading, b.heading), "heading after Left").toBeLessThan(-0.2);
    await hold(page, "d", 1200);
    const c = await flier(page);
    expect(turned(b.heading, c.heading), "heading after D").toBeGreaterThan(0.2);

    // Boost while held, slow while held.
    await page.keyboard.down("ArrowUp");
    await expect.poll(async () => (await flier(page)).speed, { message: "speed while Up is held" }).toBeGreaterThan(CRUISE * 1.3);
    await page.keyboard.up("ArrowUp");
    await page.keyboard.down("s");
    await expect.poll(async () => (await flier(page)).speed, { message: "speed while S is held" }).toBeLessThan(CRUISE * 0.8);
    await page.keyboard.up("s");

    // The camera follows: the dragon has crossed the world since the first reading.
    const d = await flier(page);
    expect(Math.hypot(d.x - a.x, d.y - a.y), "cells flown").toBeGreaterThan(CRUISE);
  });

  test("the first-flight guide teaches, then fades", async ({ page }) => {
    await openWorld(page);
    await expect(guide(page)).toHaveText("Steer with A and D, or the arrow keys.");
    await hold(page, "a", 500);
    await hold(page, "d", 500);
    await expect(guide(page)).toHaveText("W, Up or Shift to boost; S or Down to slow down.");
    await hold(page, "ArrowUp", 800);
    await hold(page, "ArrowDown", 800);
    await expect(guide(page)).toHaveText("Esc to leave the world, O for the options.");
    // It shows for a few seconds, then fades, and is not taught again.
    await expect(guide(page)).toHaveText("", { timeout: 10_000 });
    expect(await page.evaluate((key) => window.localStorage.getItem(key), LESSON_KEY)).toBe("learned");
  });

  test("the options panel opens and closes", async ({ page }) => {
    await skipLesson(page);
    await openWorld(page);
    const panel = page.getByRole("dialog", { name: "options" });
    await expect(panel).toBeHidden();

    await page.keyboard.press("o");
    await expect(panel).toBeVisible();
    // Each choice reads on one line, its name at the left and centred on its plates at the right. (WebKit once drew
    // the name on a line of its own above them.)
    for (const name of ["boost", "pace", "motion"]) {
      const row = panel.getByRole("group", { name, exact: true });
      const word = await row.locator("legend svg").boundingBox();
      const plates = await row.locator(":scope > span").boundingBox();
      if (!word || !plates) throw new Error(`the ${name} row is not drawn`);
      expect(Math.abs(word.y + word.height / 2 - (plates.y + plates.height / 2)), `${name}: centred on its plates`).toBeLessThan(1);
      expect(word.x + word.width, `${name}: left of its plates`).toBeLessThan(plates.x);
    }
    // The panel holds the keys: Esc closes it and does not leave the world.
    await page.keyboard.press("Escape");
    await expect(panel).toBeHidden();
    await expect(page).toHaveURL(/\/world\?/);

    // The corner shows while the pointer moves; its button opens the panel, and Close closes it.
    await page.mouse.move(300, 300);
    await page.mouse.move(320, 310);
    await page.getByRole("button", { name: "Options", exact: true }).click();
    await expect(panel).toBeVisible();
    await page.getByRole("button", { name: "Close the options" }).click();
    await expect(panel).toBeHidden();
    expect((await flier(page)).phase).toBe("flying");
  });

  test("the quest is offered once the lesson is learned", async ({ page }) => {
    await skipLesson(page);
    await page.addInitScript((key) => {
      try {
        window.localStorage.removeItem(key);
      } catch {
        // storage refused: nothing stored is the same as not yet asked
      }
    }, QUEST_KEY);
    await openWorld(page);
    const card = page.getByRole("dialog", { name: "the quest" });
    await expect(card).toBeVisible({ timeout: 8_000 });
    await card.getByRole("button", { name: "follow the quest" }).click();
    await expect(card).toBeHidden();
    const raw = await page.evaluate((key) => window.localStorage.getItem(key), QUEST_KEY);
    expect(JSON.parse(raw ?? "").mode).toBe("on");
    await page.keyboard.press("o");
    await expect(page.getByRole("dialog", { name: "options" }).getByRole("button", { name: "leave the quest" })).toBeVisible();
  });

  test("Esc leaves the world", async ({ page }) => {
    await offline(page);
    await skipLesson(page);
    await openWorld(page);
    await page.keyboard.press("Escape");
    await expect(page).toHaveURL(/\/$/);
  });
});
