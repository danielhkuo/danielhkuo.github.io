// The minimal version in WebKit, the engine Safari is built on: Playwright
// opens the built static export, served the way GitHub Pages serves it, at
// phone and desktop sizes, and checks what a phone depends on.
//
//   npm run build && npm run test:minimal
//
// What this can see: the static HTML with JavaScript off; that the document
// is the only scroller and the prompt is its last line; that nothing is
// pinned to the bottom while the prompt has focus; the input's 16px text; and
// what a tapped or typed command does to the page and to focus.
//
// What it cannot: Playwright's WebKit is a desktop build with no on-screen
// keyboard, so the keyboard cases are measured in the iOS Simulator by hand
// (docs/superpowers/research/2026-11-19-minimal-terminal-mobile.md) and the
// scroll arithmetic they depend on is pinned in
// src/components/minimal/reveal.test.ts.

import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { devices, webkit } from "playwright";
import { LINKS, PROFILE } from "../src/components/terminal/content.ts";
import { SITE_PAGES, TEXT_PAGE } from "../src/lib/site-content.ts";
import { hasExport, origin, serveExport } from "./serve-export.mjs";

if (!(await hasExport())) {
  console.error("No static export in out/. Run `npm run build` first.");
  process.exit(2);
}

/** An iPhone as Safari presents it: the visible area measured in the Simulator, a touch screen, Safari's user agent. */
const PHONE = {
  viewport: { width: 390, height: 699 },
  deviceScaleFactor: 2,
  isMobile: true,
  hasTouch: true,
  userAgent: devices["iPhone 15"].userAgent,
};
const DESKTOP = { viewport: { width: 1280, height: 800 } };

let server;
let browser;
let base;

before(async () => {
  server = await serveExport();
  base = origin(server);
  browser = await webkit.launch();
});

after(async () => {
  await browser?.close();
  server?.close();
});

/** Open the page in a fresh context; the test closes it. Page errors fail the test that caused them. */
async function open(options, path = TEXT_PAGE) {
  const context = await browser.newContext({ reducedMotion: "reduce", ...options });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(base + path, { waitUntil: "networkidle" });
  return {
    page,
    close: async () => {
      await context.close();
      assert.deepEqual(errors, [], "the page threw");
    },
  };
}

/** A command's button in the row above the prompt. */
const offer = (page, name) => page.locator(".mt-offers button", { hasText: name }).first();

/** How far the page can be scrolled sideways: 0 when nothing overflows. */
const sideways = (page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

/** What has focus: the prompt, or the tag of whatever else. */
const focused = (page) => page.evaluate(() => document.activeElement?.id || document.activeElement?.tagName);

// ---- The static HTML: what a crawler, a reader and a no-JavaScript visitor get ----

test("with JavaScript off, the page has one h1, the name, and a heading for each section", async () => {
  const { page, close } = await open({ ...PHONE, javaScriptEnabled: false });
  assert.deepEqual(await page.locator("h1").allTextContents(), [PROFILE.name]);
  assert.deepEqual(await page.locator("h2").allTextContents(), ["Projects", "Contact", "Elsewhere on this site"]);
  await close();
});

test("with JavaScript off, every profile fact is on the page", async () => {
  const { page, close } = await open({ ...PHONE, javaScriptEnabled: false });
  const text = await page.locator("main").innerText();
  for (const value of Object.values(PROFILE)) assert.ok(text.includes(value), value);
  await close();
});

test("with JavaScript off, every way to get in touch and every other page is a link", async () => {
  const { page, close } = await open({ ...PHONE, javaScriptEnabled: false });
  const hrefs = await page.locator("main a").evaluateAll((links) => links.map((a) => a.getAttribute("href")));
  for (const href of Object.values(LINKS)) assert.ok(hrefs.includes(href), href);
  for (const other of SITE_PAGES.filter((p) => p.path !== TEXT_PAGE)) assert.ok(hrefs.includes(other.path), other.path);
  await close();
});

test("with JavaScript off, the projects are there, or the pointer to GitHub that stands in for them", async () => {
  const { page, close } = await open({ ...PHONE, javaScriptEnabled: false });
  const projects = page.locator("section[aria-labelledby=projects]");
  assert.ok((await projects.locator(`a[href^="${LINKS.github}"]`).count()) >= 1);
  await close();
});

test("with JavaScript off, a line says the prompt needs it, and no dead control is offered", async () => {
  const { page, close } = await open({ ...PHONE, javaScriptEnabled: false });
  assert.match(await page.locator(".mt-note").innerText(), /needs JavaScript/);
  // Nothing that could be pressed and do nothing: no button, no field, no link to the prompt.
  for (const selector of ["button", "input", ".mt-jump", ".mt-skip"]) {
    const shown = await page.locator(selector).evaluateAll((els) => els.filter((el) => el.getClientRects().length).length);
    assert.equal(shown, 0, selector);
  }
  await close();
});

test("each section is named by its heading, and the command lines read as commands", async () => {
  const { page, close } = await open({ ...PHONE, javaScriptEnabled: false });
  for (const id of ["about", "projects", "contact", "elsewhere"]) {
    assert.equal(await page.locator(`section[aria-labelledby=${id}] #${id}`).count(), 1, id);
  }
  // The prompt before it is decoration, hidden from a screen reader.
  assert.match(await page.locator(".mt-cmd").first().textContent(), /Command: neofetch$/);
  assert.equal(await page.locator(".mt-cmd .mt-ps").first().getAttribute("aria-hidden"), "true");
  await close();
});

test("the page carries its canonical address and the person as JSON-LD", async () => {
  const { page, close } = await open({ ...PHONE, javaScriptEnabled: false });
  assert.match(await page.locator("link[rel=canonical]").getAttribute("href"), new RegExp(`${TEXT_PAGE}$`));
  const person = JSON.parse(await page.locator('script[type="application/ld+json"]').textContent());
  assert.equal(person.name, PROFILE.name);
  await close();
});

test("the old address forwards to this page, with or without JavaScript", async () => {
  // A meta refresh, since a static export has no server to redirect; and a link, for anything that follows neither.
  const html = await (await fetch(`${base}/recruiter`)).text();
  assert.ok(html.includes(`<meta http-equiv="refresh" content="0; url=${TEXT_PAGE}"/>`));
  assert.match(html, new RegExp(`<a[^>]* href="${TEXT_PAGE}"`));
  assert.match(html, /<meta name="robots" content="noindex"\/>/);

  for (const javaScriptEnabled of [false, true]) {
    const { page, close } = await open({ ...PHONE, javaScriptEnabled }, "/recruiter");
    await page.waitForURL(`**${TEXT_PAGE}`);
    assert.deepEqual(await page.locator("h1").allTextContents(), [PROFILE.name]);
    await close();
  }
});

// ---- The layout a phone's keyboard depends on ----------------------------------

for (const width of [320, 375, 390]) {
  test(`at ${width}px nothing scrolls sideways, before or after commands print`, async () => {
    const { page, close } = await open({ ...PHONE, viewport: { width, height: 699 } });
    assert.equal(await sideways(page), 0, "as loaded");
    for (const line of ["help", "ls -la", "neofetch", "cat projects/README.md", "cat about.md"]) {
      await page.locator("#prompt").fill(line);
      await page.locator("#prompt").press("Enter");
      assert.equal(await sideways(page), 0, `after ${line}`);
    }
    await close();
  });
}

test("the document is the only thing that scrolls", async () => {
  const { page, close } = await open(PHONE);
  const scrollers = await page.evaluate(() => {
    const found = [];
    for (const el of document.querySelectorAll("body, body *")) {
      const { overflowY } = getComputedStyle(el);
      if ((overflowY === "auto" || overflowY === "scroll") && el.scrollHeight > el.clientHeight + 1) found.push(el.className);
    }
    const root = getComputedStyle(document.documentElement);
    const body = getComputedStyle(document.body);
    return { found, root: root.overflowY, body: body.overflowY, position: body.position, tall: document.documentElement.scrollHeight > innerHeight };
  });
  assert.deepEqual(scrollers.found, []);
  assert.notEqual(scrollers.root, "hidden");
  assert.notEqual(scrollers.body, "hidden");
  assert.notEqual(scrollers.position, "fixed");
  assert.ok(scrollers.tall);
  await close();
});

test("the prompt row is the last thing in the document", async () => {
  const { page, close } = await open(PHONE);
  const gap = async () =>
    page.evaluate(() => {
      const form = document.querySelector(".mt-form");
      return document.documentElement.scrollHeight - (form.getBoundingClientRect().bottom + scrollY);
    });
  // Under it: the page's own bottom padding, and nothing else.
  assert.ok((await gap()) <= 16, `gap ${await gap()}`);
  await offer(page, "help").tap();
  assert.ok((await gap()) <= 16, `gap after help ${await gap()}`);
  await close();
});

test("the prompt's text is 16px on a phone, so Safari does not zoom to it", async () => {
  for (const width of [320, 390]) {
    const { page, close } = await open({ ...PHONE, viewport: { width, height: 699 } });
    const size = await page.locator("#prompt").evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
    assert.ok(size >= 16, `${size}px at ${width}`);
    await close();
  }
});

test("the page does not turn zooming off", async () => {
  const { page, close } = await open(PHONE);
  const viewport = await page.locator("meta[name=viewport]").getAttribute("content");
  assert.doesNotMatch(viewport, /user-scalable|maximum-scale/);
  await close();
});

test("nothing takes focus when the page opens", async () => {
  const { page, close } = await open(PHONE);
  assert.equal(await focused(page), "BODY");
  assert.equal(await page.evaluate(() => Math.round(scrollY)), 0);
  await close();
});

test("with the prompt focused, the only thing pinned is the title bar, at the top", async () => {
  const { page, close } = await open(PHONE);
  const pinned = () =>
    page.evaluate(() =>
      [...document.querySelectorAll("body *")]
        .filter((el) => ["fixed", "sticky"].includes(getComputedStyle(el).position) && el.getClientRects().length)
        .map((el) => el.className.split(" ").pop()),
    );
  // Scrolled a little, without focus: the jump button floats in the corner.
  await page.evaluate(() => window.scrollTo(0, 600));
  assert.deepEqual(await pinned(), ["mt-bar", "mt-jump"]);
  await page.locator("#prompt").focus();
  assert.deepEqual(await pinned(), ["mt-bar"]);
  await close();
});

test("the suggestions are finger-sized on a phone", async () => {
  const { page, close } = await open(PHONE);
  const boxes = await page.locator(".mt-offers button").evaluateAll((buttons) =>
    buttons.map((b) => {
      const r = b.getBoundingClientRect();
      return [Math.round(r.width), Math.round(r.height)];
    }),
  );
  assert.ok(boxes.length >= 6);
  for (const [w, h] of boxes) assert.ok(w >= 44 && h >= 44, `${w}x${h}`);
  await close();
});

// ---- Commands by tap ------------------------------------------------------------

test("the jump button brings the prompt on screen without focusing it, then goes away", async () => {
  const { page, close } = await open(PHONE);
  await page.locator(".mt-jump").tap();
  await page.waitForFunction(() => document.querySelector(".mt-form").getBoundingClientRect().bottom <= innerHeight + 1);
  assert.equal(await focused(page), "BODY");
  await page.waitForFunction(() => document.querySelector(".mt-jump").hidden);
  await close();
});

test("a tapped command prints above the prompt, says so in one line, and leaves the prompt unfocused", async () => {
  const { page, close } = await open(PHONE);
  await page.locator(".mt-jump").tap();
  await offer(page, "help").tap();
  const echo = page.locator(".mt-log .mt-cmd").last();
  assert.equal(await echo.locator(".mt-typed-cmd").textContent(), "help");
  // On a phone the prompt is the short one: user@host is not shown.
  assert.equal((await echo.locator(".mt-ps").innerText()).trim(), "~ %");
  assert.ok((await page.locator(".mt-log .mt-help dt").count()) >= 12);
  assert.match(await page.locator("[role=status]").textContent(), /^help: printed \d+ lines above the prompt\.$/);
  // Focus is not on the prompt: on a phone the keyboard stays shut and the screen is left to the output.
  assert.notEqual(await focused(page), "prompt");
  await close();
});

test("output taller than the screen starts at the top, under the title bar", async () => {
  const { page, close } = await open(PHONE);
  await page.locator(".mt-jump").tap();
  await offer(page, "help").tap();
  const top = await page.locator(".mt-log .mt-cmd").last().evaluate((el) => el.getBoundingClientRect().top);
  assert.ok(top >= 32 && top < 60, `echo at ${top}`);
  await close();
});

test("a command that needs a file goes on the prompt, and the row becomes the files", async () => {
  const { page, close } = await open(PHONE);
  await page.locator(".mt-jump").tap();
  await offer(page, "cat").tap();
  assert.equal(await page.locator("#prompt").inputValue(), "cat ");
  const files = await page.locator(".mt-offers button").allTextContents();
  assert.ok(files.includes("about.md") && files.includes("projects/"), files.join(" "));
  // Still no focus, so still no keyboard: the next word can be tapped too.
  assert.notEqual(await focused(page), "prompt");

  await offer(page, "projects/").tap();
  assert.equal(await page.locator("#prompt").inputValue(), "cat projects/");
  await offer(page, "README.md").tap();
  assert.equal(await page.locator("#prompt").inputValue(), "");
  assert.equal(await page.locator(".mt-log h2").last().textContent(), "Projects");
  await close();
});

test("a name that ls printed can be tapped: a file is read, a directory listed", async () => {
  const { page, close } = await open(PHONE);
  await page.locator(".mt-jump").tap();
  await offer(page, "ls").tap();
  await page.locator(".mt-log button", { hasText: "contact.md" }).tap();
  assert.equal(await page.locator(".mt-log h2").last().textContent(), "Contact");
  await page.locator(".mt-log button", { hasText: "projects/" }).tap();
  assert.equal(await page.locator(".mt-log .mt-typed-cmd").last().textContent(), "ls projects");
  await close();
});

test("every command help lists is a button", async () => {
  const { page, close } = await open(PHONE);
  await page.locator(".mt-jump").tap();
  await offer(page, "help").tap();
  const rows = await page.locator(".mt-log .mt-help dt").count();
  assert.equal(await page.locator(".mt-log .mt-help dt button").count(), rows);
  await page.locator(".mt-log .mt-help dt button", { hasText: "pwd" }).tap();
  assert.equal(await page.locator("[role=status]").textContent(), "/Users/daniel");
  await close();
});

test("a command help lists with its usage runs as the command alone, or goes on the prompt for its file", async () => {
  const { page, close } = await open(PHONE);
  await page.locator(".mt-jump").tap();
  await offer(page, "help").tap();
  // `ls [-la] [path]` is `ls`: the placeholders are not something to run.
  await page.locator(".mt-log .mt-help dt button", { hasText: "ls [-la] [path]" }).tap();
  assert.equal(await page.locator(".mt-log .mt-typed-cmd").last().textContent(), "ls");
  assert.match(await page.locator("[role=status]").textContent(), /^ls: printed \d+ lines? above the prompt\.$/);
  // `cat <file>` needs its file: it goes on the prompt and the row offers the files.
  await page.locator(".mt-log .mt-help dt button", { hasText: "cat <file>" }).tap();
  assert.equal(await page.locator("#prompt").inputValue(), "cat ");
  assert.ok((await page.locator(".mt-offers button").allTextContents()).includes("about.md"));
  await close();
});

test("clear clears what the session printed and leaves the page's own sections", async () => {
  const { page, close } = await open(PHONE);
  await page.locator("#prompt").fill("help");
  await page.locator("#prompt").press("Enter");
  await page.locator("#prompt").fill("clear");
  await page.locator("#prompt").press("Enter");
  assert.equal(await page.locator(".mt-log > *").count(), 0);
  assert.deepEqual(await page.locator("h2").allTextContents(), ["Projects", "Contact", "Elsewhere on this site"]);
  assert.equal(await page.locator("[role=status]").textContent(), "clear: done.");
  await close();
});

// ---- Commands by typing -----------------------------------------------------------

test("a typed command runs on Enter and keeps focus in the prompt", async () => {
  const { page, close } = await open(PHONE);
  await page.locator("#prompt").tap();
  await page.keyboard.type("pwd");
  await page.keyboard.press("Enter");
  assert.equal(await page.locator(".mt-log .mt-line").last().textContent(), "/Users/daniel");
  assert.equal(await focused(page), "prompt");
  assert.equal(await page.locator("#prompt").inputValue(), "");
  await close();
});

test("after a typed command the prompt is still on screen, at the bottom", async () => {
  const { page, close } = await open(PHONE);
  await page.locator("#prompt").tap();
  await page.keyboard.type("help");
  await page.keyboard.press("Enter");
  const { bottom, height } = await page.evaluate(() => ({
    bottom: document.querySelector(".mt-form").getBoundingClientRect().bottom,
    height: visualViewport.height,
  }));
  assert.ok(bottom <= height && bottom > height - 40, `prompt bottom ${bottom} of ${height}`);
  await close();
});

test("an unknown command is reported the way zsh reports it", async () => {
  const { page, close } = await open(DESKTOP);
  await page.locator("#prompt").fill("nope");
  await page.locator("#prompt").press("Enter");
  assert.equal(await page.locator("[role=status]").textContent(), "zsh: command not found: nope");
  await close();
});

test("Tab completes when there is something to complete, and otherwise moves on", async () => {
  const { page, close } = await open(DESKTOP);
  await page.locator("#prompt").focus();
  await page.keyboard.type("neo");
  await page.keyboard.press("Tab");
  assert.equal(await page.locator("#prompt").inputValue(), "neofetch");
  assert.equal(await focused(page), "prompt");
  // Nothing left to complete: Tab leaves the prompt. It is not a keyboard trap.
  await page.keyboard.press("Tab");
  assert.notEqual(await focused(page), "prompt");
  await close();
});

test("Shift+Tab always leaves the prompt, back to the suggestions", async () => {
  const { page, close } = await open(DESKTOP);
  await page.locator("#prompt").focus();
  await page.keyboard.type("neo");
  await page.keyboard.press("Shift+Tab");
  assert.equal(await page.evaluate(() => document.activeElement?.className), "mt-offer");
  await close();
});

test("the suggestions are one Tab stop, and the arrow keys move inside them", async () => {
  const { page, close } = await open(DESKTOP);
  await page.locator("#prompt").focus();
  await page.keyboard.press("Shift+Tab");
  assert.equal(await page.evaluate(() => document.activeElement?.textContent), "help");
  await page.keyboard.press("ArrowRight");
  assert.equal(await page.evaluate(() => document.activeElement?.textContent), "ls");
  await page.keyboard.press("Tab");
  assert.equal(await focused(page), "prompt");
  await close();
});

test("the arrow keys recall earlier lines, and the right arrow accepts the suggestion", async () => {
  const { page, close } = await open(DESKTOP);
  await page.locator("#prompt").focus();
  await page.keyboard.type("whoami");
  await page.keyboard.press("Enter");
  await page.keyboard.press("ArrowUp");
  assert.equal(await page.locator("#prompt").inputValue(), "whoami");
  await page.keyboard.press("ArrowDown");
  assert.equal(await page.locator("#prompt").inputValue(), "");
  await page.keyboard.type("cbon");
  await page.keyboard.press("ArrowRight");
  assert.equal(await page.locator("#prompt").inputValue(), "cbonsai ");
  await close();
});

test("a command clicked with a mouse leaves the keys with the prompt, and long output starts at the top", async () => {
  // A short window, so that the projects file is taller than it.
  const { page, close } = await open({ viewport: { width: 1280, height: 520 } });
  await page.locator(".mt-jump").click();
  await page.waitForFunction(() => document.activeElement?.id === "prompt");
  await offer(page, "help").click();
  await page.waitForFunction(() => document.activeElement?.id === "prompt");
  await page.locator(".mt-log button", { hasText: "cat <file>" }).click();
  assert.equal(await page.locator("#prompt").inputValue(), "cat ");
  assert.equal(await focused(page), "prompt");
  // Read from its first line, with the prompt below the fold, though the prompt has the keys.
  await offer(page, "projects/").click();
  await offer(page, "README.md").click();
  const top = await page.locator(".mt-log .mt-cmd").last().evaluate((el) => el.getBoundingClientRect().top);
  assert.ok(top >= 32 && top < 60, `echo at ${top}`);
  assert.equal(await focused(page), "prompt");
  await close();
});

test("a command pressed with the keyboard leaves focus on its button", async () => {
  const { page, close } = await open(DESKTOP);
  await page.locator("#prompt").focus();
  await page.keyboard.press("Shift+Tab");
  await page.keyboard.press("Enter");
  assert.match(await page.locator("[role=status]").textContent(), /^help: printed/);
  assert.equal(await page.evaluate(() => document.activeElement?.textContent), "help");
  await close();
});

test("⌘K goes to the prompt from anywhere on the page", async () => {
  const { page, close } = await open(DESKTOP);
  await page.keyboard.press("Meta+k");
  assert.equal(await focused(page), "prompt");
  const bottom = await page.locator(".mt-form").evaluate((el) => el.getBoundingClientRect().bottom);
  assert.ok(bottom <= 800, `prompt bottom ${bottom}`);
  await close();
});

// ---- Programs -------------------------------------------------------------------

test("a full-screen program takes the prompt's place, whole on screen, and gives it back", async () => {
  const { page, close } = await open(PHONE);
  await page.locator(".mt-jump").tap();
  await offer(page, "cbonsai").tap();
  await page.waitForSelector(".mt-screen .term-grid-row");
  assert.equal(await page.locator(".mt-form").count(), 0);
  await page.waitForFunction(() => {
    const r = document.querySelector(".mt-screen").getBoundingClientRect();
    return r.top >= 32 && r.bottom <= innerHeight;
  });
  // Nothing pinned at the bottom while it runs, either.
  assert.equal(await page.locator(".mt-jump").isVisible(), false);
  assert.match(await page.locator("[role=status]").textContent(), /^cbonsai is running\./);

  await page.locator(".mt-quit").tap();
  await page.waitForSelector(".mt-form");
  assert.equal(await page.locator(".mt-screen").count(), 0);
  await close();
});

test("a program that reads text keeps its hidden field at the top of its pane, and a press gives it the keys", async () => {
  const { page, close } = await open(PHONE);
  await page.locator(".mt-jump").tap();
  await offer(page, "claude").tap();
  await page.waitForSelector(".mt-screen .term-grid-row");
  // At the top, the field is on screen with the keyboard up or down, so Safari never pans to it.
  const { field, pane } = await page.evaluate(() => ({
    field: document.querySelector(".mt-screen .term-hidden-input").getBoundingClientRect().top,
    pane: document.querySelector(".mt-screen").getBoundingClientRect().top,
  }));
  assert.ok(field - pane >= 0 && field - pane < 60, `field ${field}, pane ${pane}`);
  await page.locator(".mt-screen .term-grid").tap();
  assert.equal(await page.evaluate(() => document.activeElement?.className), "term-hidden-input");
  await page.locator(".mt-quit").tap();
  await page.waitForSelector(".mt-form");
  await close();
});

test("Escape leaves a program, and the prompt takes the keys back", async () => {
  const { page, close } = await open(DESKTOP);
  await page.locator("#prompt").focus();
  await page.keyboard.type("cbonsai");
  await page.keyboard.press("Enter");
  await page.waitForSelector(".mt-screen .term-grid-row");
  await page.keyboard.press("Escape");
  await page.waitForSelector(".mt-form");
  await page.waitForFunction(() => document.activeElement?.id === "prompt");
  await close();
});

// ---- The desktop window ------------------------------------------------------------

test("on a desktop the window is centred on the page and no wider than the old header's", async () => {
  const { page, close } = await open(DESKTOP);
  const box = await page.locator(".mt-win").boundingBox();
  assert.equal(box.width, 896);
  assert.equal(Math.round(box.x), Math.round((1280 - 896) / 2));
  // The prompt is the size of the text around it where a mouse types.
  const sizes = await page.evaluate(() => [
    getComputedStyle(document.querySelector("#prompt")).fontSize,
    getComputedStyle(document.querySelector(".mt-cmd")).fontSize,
  ]);
  assert.equal(sizes[0], sizes[1]);
  await close();
});

test("the close light goes back to the title menu", async () => {
  const { page, close } = await open(DESKTOP);
  const light = page.locator(".mt-bar .lights a");
  assert.equal(await light.getAttribute("href"), "/");
  assert.match(await light.getAttribute("aria-label"), /title menu/);
  await close();
});
