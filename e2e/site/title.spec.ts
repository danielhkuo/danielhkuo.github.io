// The title on `/`: the site's terminal window over the world, held behind it. It opens on blank paper as the
// terminal's intro does, the world arrives after, and then the ways in: Enter world (or ⏎) minimizes the window into
// the world and the dragon sets off, in place; Back brings the title back; Minimal version grows the window into the
// nano page; agents.md is the agent file; Settings opens the options. Esc, or any key, skips the opening. A phone gets
// its own title, with the minimal version first.

import type { Page } from "@playwright/test";
import { PROFILE, WORLD_LINES } from "../../src/components/terminal/content.ts";
import { expect, flier, guide, offline, openWorld, probe, skipLesson, test } from "../support";

/** The title with the world's probe (?stats), at noon in clear weather, as the world's own tests open it. */
const TITLE = "/?stats&time=noon&weather=clear";

function title(page: Page) {
  return page.locator("[data-title]");
}

/** Waits for the title to settle: the intro over, the world arrived, the ways in shown. */
async function settled(page: Page): Promise<void> {
  await expect(title(page)).toHaveAttribute("data-title", "title", { timeout: 30_000 });
  await expect(page.locator("html")).not.toHaveAttribute("data-intro", "play", { timeout: 15_000 });
  await expect(page.locator("[data-arrival]")).toHaveAttribute("data-arrived", "true", { timeout: 30_000 });
  await expect(page.getByRole("button", { name: "Enter world" })).toBeVisible();
}

test.describe("the title", () => {
  test.beforeEach(async ({ page }) => {
    await offline(page);
    await skipLesson(page);
  });

  test("opens on blank paper, plays the terminal's intro, then the world arrives behind it", async ({ page }) => {
    await page.goto(TITLE);
    // A new tab plays the intro: the world is still paper while the window opens.
    await expect(page.locator("html")).toHaveAttribute("data-intro", "play");
    await expect(page.locator("[data-arrival]")).not.toHaveAttribute("data-arrived", "true");
    // The terminal says how to start, in the words content.ts keeps.
    for (const line of WORLD_LINES) await expect(page.locator("header#about").getByText(line, { exact: false })).toBeAttached();
    await settled(page);
    // The world is held behind the title: the dragon does not fly until asked.
    const s = await flier(page);
    expect(s.speed, "held still behind the title").toBe(0);
  });

  test("Esc skips the opening", async ({ page }) => {
    await page.goto(TITLE);
    await expect(page.locator("html")).toHaveAttribute("data-intro", "play");
    await page.keyboard.press("Escape");
    await expect(page.locator("html")).not.toHaveAttribute("data-intro", "play");
    await expect(page.locator("[data-arrival]")).toHaveAttribute("data-arrived", "true", { timeout: 30_000 });
    await expect(page.getByRole("button", { name: "Enter world" })).toBeVisible();
  });

  test("⏎ enters the world in place, and Back brings the title back", async ({ page }) => {
    await page.goto(TITLE);
    await settled(page);
    await page.keyboard.press("Enter");
    await expect(title(page)).toHaveAttribute("data-title", "flying", { timeout: 5_000 });
    await expect(page).toHaveURL(/\/world(\?|$)/);
    await expect.poll(async () => (await flier(page)).speed, { message: "flying after ⏎" }).toBeGreaterThan(0);
    await expect(page.locator("header#about")).toBeHidden();
    await page.goBack();
    await expect(page).toHaveURL(/\/(\?|$)/);
    await expect(title(page)).toHaveAttribute("data-title", "title", { timeout: 5_000 });
    await expect(page.locator("header#about")).toBeVisible();
    await expect.poll(async () => (await flier(page)).speed, { message: "held again" }).toBe(0);
  });

  test("the Enter world button does the same as ⏎", async ({ page }) => {
    await page.goto(TITLE);
    await settled(page);
    await page.getByRole("button", { name: "Enter world" }).click();
    await expect(title(page)).toHaveAttribute("data-title", "flying", { timeout: 5_000 });
    await expect(page).toHaveURL(/\/world(\?|$)/);
  });

  test("Esc on the title leaves the world held, and Esc in flight brings the title back", async ({ page }) => {
    await page.goto(TITLE);
    await settled(page);
    await page.keyboard.press("Escape");
    await page.waitForTimeout(500);
    await expect(page).toHaveURL(/\/(\?|$)/);
    await expect(title(page)).toHaveAttribute("data-title", "title");
    expect((await flier(page)).speed, "still held").toBe(0);
    await page.keyboard.press("Enter");
    await expect(title(page)).toHaveAttribute("data-title", "flying", { timeout: 5_000 });
    await page.keyboard.press("Escape");
    await expect(title(page)).toHaveAttribute("data-title", "title", { timeout: 5_000 });
    await expect(page).toHaveURL(/\/(\?|$)/);
    await expect(page.locator("header#about")).toBeVisible();
  });

  test("held, the world draws nothing of its own over the title; flying, its corner and sound come back", async ({ page }) => {
    await page.goto(TITLE);
    await settled(page);
    expect((await flier(page)).held, "the probe says held").toBe(true);
    await expect(page.getByRole("navigation", { name: "Leave or open the options" })).toHaveCount(0);
    await expect(page.getByRole("switch", { name: "Sound" })).toHaveCount(0);
    await page.keyboard.press("Enter");
    await expect(title(page)).toHaveAttribute("data-title", "flying", { timeout: 5_000 });
    expect((await flier(page)).held).toBe(false);
    await expect(page.getByRole("navigation", { name: "Leave or open the options" })).toHaveCount(1);
    await expect(page.getByRole("switch", { name: "Sound" })).toHaveCount(1);
  });

  test("the window's lights: yellow minimizes into the world, green grows into the minimal version", async ({ page }) => {
    await page.goto(TITLE);
    await settled(page);
    const lights = page.locator("header#about .lights");
    await expect(lights.getByRole("button")).toHaveCount(2);
    await lights.getByRole("button", { name: "Minimize" }).click();
    await expect(title(page)).toHaveAttribute("data-title", "flying", { timeout: 5_000 });
    await page.goBack();
    await expect(title(page)).toHaveAttribute("data-title", "title", { timeout: 5_000 });
    await lights.getByRole("button", { name: "Zoom" }).click();
    await expect(page).toHaveURL(/\/minimal$/);
  });

  test("Minimal version grows the window into the nano page", async ({ page }) => {
    await page.goto(TITLE);
    await settled(page);
    const link = page.getByRole("link", { name: "Minimal version" });
    await expect(link).toHaveAttribute("href", "/minimal");
    await link.click();
    await expect(page).toHaveURL(/\/minimal$/);
    await expect(page.getByText("GNU nano", { exact: false }).first()).toBeVisible();
  });

  test("agents.md is the agent file, and Settings opens the options", async ({ page }) => {
    await page.goto(TITLE);
    await settled(page);
    await expect(page.getByRole("link", { name: "agents.md" })).toHaveAttribute("href", "/agents.md");
    await page.getByRole("button", { name: "Settings" }).click();
    const options = page.getByRole("dialog", { name: /options/i });
    await expect(options).toBeVisible();
    // The options are open: ⏎ belongs to them, not to the title.
    await page.keyboard.press("Escape");
    await expect(options).toBeHidden();
    await expect(title(page)).toHaveAttribute("data-title", "title");
  });

  test("projects without GitHub stats show their name and summary, never n/a or zero counts", async ({ page }) => {
    // npm run e2e builds without GITHUB_TOKEN, so no project has stats: the rows are the first six fixtures by order.
    await page.goto(TITLE);
    const list = page.locator("header#about .nf-pins");
    await expect(list.locator(".nf-pin")).toHaveCount(6);
    await expect(list).not.toContainText("n/a");
    await expect(list).not.toContainText("★");
    await expect(list).not.toContainText("⑂");
    await expect(list.locator(".nf-pin-dot")).toHaveCount(0);
    const first = list.locator(".nf-pin").first();
    await expect(first).toContainText("Alpha");
    await expect(first).toContainText("The first fixture, with a repository and a live site.");
    await expect(first.getByRole("link", { name: "Alpha" })).toHaveAttribute("href", "https://github.com/example/alpha");
  });

  test("a phone opens its own title, with the minimal version first and preselected", { tag: "@phone" }, async ({ page }) => {
    const size = page.viewportSize();
    test.skip(!size || size.width >= 700, "phones only");
    await page.goto("/");
    const first = page.locator("[data-side=phone] a").first();
    await expect(first).toBeVisible();
    await expect(first).toHaveAttribute("href", "/minimal");
    await expect(page.locator("[data-title]")).toBeHidden();
  });
});

/** The live prompt under `./world`: the title's window is the one terminal on a desktop. */
function prompt(page: Page) {
  return page.locator("header#about").getByRole("textbox", { name: "terminal input" });
}

/**
 * The first landmark that holds `holds`, read from the world's probe on its own page. It waits for the world's first
 * full view, as the landing tests do, so leaving the page straight after cancels no load.
 */
async function landmarkId(page: Page, holds: string): Promise<string> {
  await openWorld(page);
  const id = (await probe(page)).landmarks?.find((l) => l.holds === holds)?.id;
  if (!id) throw new Error(`no landmark holds ${holds}`);
  return id;
}

test.describe("the title's window is the terminal", () => {
  test.beforeEach(async ({ page }) => {
    await offline(page);
    await skipLesson(page);
  });

  test("a click on the window makes the prompt live: a labelled input takes the focus, and no second window opens", async ({ page }) => {
    await page.goto(TITLE);
    await settled(page);
    await expect(prompt(page)).toHaveCount(0);
    await page.locator("header#about .nf-face-path").click();
    await expect(prompt(page)).toBeFocused();
    await expect(page.getByRole("dialog", { name: "interactive terminal" })).toHaveCount(0);
    await expect(page.locator(".term-launch"), "no corner button on the title").toHaveCount(0);
  });

  test("typing a printable key makes the prompt live and types it; ⌘K and backtick focus it", async ({ page }) => {
    await page.goto(TITLE);
    await settled(page);
    await page.keyboard.press("l");
    await expect(prompt(page)).toBeFocused();
    await expect(prompt(page)).toHaveValue("l");
    await page.keyboard.press("Escape");
    await expect(prompt(page)).toHaveValue("");
    await page.locator("header#about .nf-face-path").click();
    await page.keyboard.press("Tab");
    await expect(prompt(page)).not.toBeFocused();
    await page.keyboard.press("`");
    await expect(prompt(page)).toBeFocused();
    await expect(prompt(page)).toHaveValue("");
    await page.keyboard.press("Tab");
    await page.keyboard.press("ControlOrMeta+k");
    await expect(prompt(page)).toBeFocused();
    await expect(page.getByRole("dialog", { name: "interactive terminal" })).toHaveCount(0);
  });

  test("the prompt goes live in place: nothing above it moves, and it keeps the window's type", async ({ page }) => {
    await page.goto(TITLE);
    await settled(page);
    const world = page.locator("header#about .nf-cmd.nf-world");
    const idle = page.locator("header#about .nf-cmd.nf-idle");
    const typeOf = (el: Element) => [getComputedStyle(el).fontSize, getComputedStyle(el).lineHeight];
    const worldBefore = await world.boundingBox();
    const idleBox = await idle.boundingBox();
    const idleType = await idle.evaluate(typeOf);
    await page.keyboard.press("h");
    await expect(prompt(page)).toBeFocused();
    const row = page.locator("header#about .term-inputrow");
    const worldAfter = await world.boundingBox();
    const rowBox = await row.boundingBox();
    expect(Math.abs((worldAfter?.y ?? 0) - (worldBefore?.y ?? 0)), "the rows above stay put").toBeLessThan(0.5);
    expect(Math.abs((rowBox?.y ?? 0) - (idleBox?.y ?? 0)), "the prompt stands where the idle one did").toBeLessThan(0.5);
    expect(Math.abs((rowBox?.height ?? 0) - (idleBox?.height ?? 0)), "and is as tall").toBeLessThan(0.5);
    expect(await row.evaluate(typeOf), "in the type of the window's command rows").toEqual(idleType);
    expect(await page.locator("header#about .nf-body").evaluate((b) => b.scrollTop), "not scrolled").toBe(0);
  });

  test("commands run in the window, which scrolls within itself: the neofetch goes up and out", async ({ page }) => {
    await page.goto(TITLE);
    await settled(page);
    const frame = page.locator("header#about .nf-frame");
    const before = await frame.boundingBox();
    await page.keyboard.type("help");
    await page.keyboard.press("Enter");
    await expect(page.locator("header#about").getByText(/ls \[-la\]/)).toBeVisible();
    for (let i = 0; i < 3; i++) {
      await page.keyboard.type("help");
      await page.keyboard.press("Enter");
    }
    const body = page.locator("header#about .nf-body");
    await expect.poll(() => body.evaluate((b) => b.scrollTop), { message: "scrolled within the window" }).toBeGreaterThan(0);
    await expect(page.locator("header#about .nf-face img")).not.toBeInViewport();
    await expect(prompt(page)).toBeInViewport();
    const after = await frame.boundingBox();
    expect(Math.abs((after?.height ?? 0) - (before?.height ?? 0)), "the window keeps its size").toBeLessThan(2);
    expect((await flier(page)).speed, "the world stays held").toBe(0);
  });

  test("./world goes into the world exactly as Enter world does", async ({ page }) => {
    await page.goto(TITLE);
    await settled(page);
    await page.keyboard.type("./world");
    await page.keyboard.press("Enter");
    await expect(title(page)).toHaveAttribute("data-title", "flying", { timeout: 5_000 });
    await expect(page).toHaveURL(/\/world(\?|$)/);
    await expect.poll(async () => (await flier(page)).speed, { message: "flying after ./world" }).toBeGreaterThan(0);
  });

  test("⏎ on an empty prompt goes into the world; Back brings the window back with its prompt focused", async ({ page }) => {
    await page.goto(TITLE);
    await settled(page);
    await page.locator("header#about .nf-face-path").click();
    await expect(prompt(page)).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(title(page)).toHaveAttribute("data-title", "flying", { timeout: 5_000 });
    await page.goBack();
    await expect(title(page)).toHaveAttribute("data-title", "title", { timeout: 5_000 });
    await expect(prompt(page)).toBeFocused();
  });

  test("Esc clears a typed line, and on an empty line leaves the title as it was", async ({ page }) => {
    await page.goto(TITLE);
    await settled(page);
    await page.keyboard.type("cat about");
    await expect(prompt(page)).toHaveValue("cat about");
    await page.keyboard.press("Escape");
    await expect(prompt(page)).toHaveValue("");
    await expect(prompt(page)).toBeFocused();
    await page.keyboard.press("Escape");
    await page.waitForTimeout(400);
    await expect(title(page)).toHaveAttribute("data-title", "title");
    await expect(page).toHaveURL(/\/(\?|$)/);
    expect((await flier(page)).speed).toBe(0);
  });

  test("the abbey's Open the terminal brings this window back, held; leaving again flies on from the abbey", async ({ page }) => {
    const abbey = await landmarkId(page, "about");
    await page.goto(`${TITLE}&at=${abbey}`);
    await settled(page);
    await page.keyboard.press("Enter");
    await expect(title(page)).toHaveAttribute("data-title", "flying", { timeout: 5_000 });
    // Come up on the abbey slowly, so the prompt is not missed, and land.
    await page.keyboard.down("ArrowDown");
    await expect(guide(page)).toHaveText("Press Space to land: about me.", { timeout: 20_000 });
    await page.keyboard.up("ArrowDown");
    await page.keyboard.press(" ");
    const codex = page.getByRole("dialog", { name: PROFILE.name, exact: true });
    await expect(codex).toBeVisible({ timeout: 20_000 });
    await codex.getByRole("button", { name: "Open the terminal" }).click();
    // The same window comes back (no second one), its prompt focused, and the world is held.
    await expect(title(page)).toHaveAttribute("data-title", "title", { timeout: 5_000 });
    await expect(prompt(page)).toBeFocused();
    await expect(page.getByRole("dialog", { name: "interactive terminal" })).toHaveCount(0);
    await expect(page).toHaveURL(/\/(\?|$)/);
    await expect.poll(async () => (await flier(page)).speed, { message: "held again" }).toBe(0);
    const held = await flier(page);
    expect(held.held).toBe(true);
    // Leaving again resumes from where it is held, by the abbey: not a fresh start.
    await page.keyboard.press("Enter");
    await expect(title(page)).toHaveAttribute("data-title", "flying", { timeout: 5_000 });
    const off = await flier(page);
    expect(Math.hypot(off.x - held.x, off.y - held.y), "flies on from where it was held").toBeLessThan(40);
  });
});
