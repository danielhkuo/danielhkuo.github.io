// The static HTML: what a crawler, a reader and a visitor without JavaScript get. The whole site is here before any
// script runs, as headings, lists and links, and every shortcut shown either works or is decoration.

import { LINKS, PROFILE } from "../../src/components/terminal/content.ts";
import { TEXT_PAGE, otherPages } from "../../src/lib/site-content.ts";
import { expect, test } from "../support";
import { goTo, help, isOpen, openMinimal, status } from "./minimal";

test.describe("with JavaScript off", () => {
  test.use({ javaScriptEnabled: false });

  test("the page has one h1, the name, and a heading in plain caps for each section", async ({ page }) => {
    await openMinimal(page, { live: false });
    await expect(page.locator("h1")).toHaveText([PROFILE.name]);
    await expect(page.locator("h2")).toHaveText(["PROJECTS", "CONTACT", "ELSEWHERE"]);
    for (const id of ["projects", "contact", "elsewhere"]) {
      await expect(page.locator(`section[aria-labelledby=${id}] h2#${id}`), id).toHaveCount(1);
    }
  });

  test("every profile fact is on the page", async ({ page }) => {
    await openMinimal(page, { live: false });
    const text = await page.locator("main").innerText();
    for (const value of Object.values(PROFILE)) expect(text, value).toContain(value);
  });

  test("every way to get in touch and every other page is a link", async ({ page }) => {
    await openMinimal(page, { live: false });
    const hrefs = await page.locator("main a").evaluateAll((links) => links.map((a) => a.getAttribute("href")));
    for (const href of Object.values(LINKS)) expect(hrefs, href).toContain(href);
    for (const other of otherPages(TEXT_PAGE)) expect(hrefs, other.path).toContain(other.path);
  });

  test("the projects are there, linked to GitHub, or the pointer to GitHub that stands in for them", async ({ page }) => {
    await openMinimal(page, { live: false });
    const projects = page.locator("section[aria-labelledby=projects]");
    expect(await projects.locator(`a[href^="https://github.com/"]`).count()).toBeGreaterThanOrEqual(1);
  });

  test("it is dressed as nano: the title bar names the file, the status line counts its lines", async ({ page }) => {
    await openMinimal(page, { live: false });
    await expect(page.locator(".nano > .nano-bar")).toContainText("GNU nano");
    await expect(page.locator(".nano > .nano-bar")).toContainText("daniel.txt");
    await expect(page.locator(".nano > .nano-bar")).toHaveAttribute("aria-hidden", "true");
    await expect(status(page)).toHaveText(/^\[ Read \d+ lines \]$/);
  });

  test("every shortcut shown either works or is decoration a screen reader skips", async ({ page }) => {
    await openMinimal(page, { live: false });
    const keys = page.locator(".nano-keys");
    // What can be pressed: Help and Go To Line (popovers) and Exit (a link), each named by its word.
    await expect(keys.getByRole("button")).toHaveText([/Help$/, /Go To Line$/]);
    await expect(keys.getByRole("link")).toHaveAttribute("href", "/");
    // Where Is needs JavaScript: here it is decoration, hidden from screen readers, like the eight that never work.
    await expect(keys.getByRole("button", { name: "Where Is" })).toHaveCount(0);
    for (const deco of await keys.locator(":scope > span").all()) {
      await expect(deco).toHaveAttribute("aria-hidden", "true");
      expect(await deco.evaluate((el) => el.matches("a, button, [tabindex]"))).toBe(false);
    }
  });

  test("Help opens and closes with no script", async ({ page }) => {
    await openMinimal(page, { live: false });
    await page.locator(".nano-keys").getByRole("button", { name: "Help" }).click();
    expect(await isOpen(help(page))).toBe(true);
    await expect(help(page)).toContainText("^F");
    await help(page).getByRole("button", { name: "Close" }).click();
    expect(await isOpen(help(page))).toBe(false);
  });

  test("Go To Line opens with no script, and lists each section by its line", async ({ page }) => {
    await openMinimal(page, { live: false });
    await page.locator(".nano-keys").getByRole("button", { name: "Go To Line" }).click();
    expect(await isOpen(goTo(page))).toBe(true);
    const links = goTo(page).getByRole("link");
    await expect(links).toHaveText([/1\s*Daniel Kuo$/, /\d+\s*PROJECTS$/, /\d+\s*CONTACT$/, /\d+\s*ELSEWHERE$/]);
    for (const href of await links.evaluateAll((as) => as.map((a) => a.getAttribute("href") ?? ""))) {
      await expect(page.locator(href), href).toHaveCount(1);
    }
  });

  test("the page carries its canonical address and the person as JSON-LD", async ({ page }) => {
    await openMinimal(page, { live: false });
    await expect(page.locator("link[rel=canonical]")).toHaveAttribute("href", new RegExp(`${TEXT_PAGE}$`));
    const person = JSON.parse((await page.locator('script[type="application/ld+json"]').textContent()) ?? "{}");
    expect(person.name).toBe(PROFILE.name);
  });

  test("the old address forwards here without a script", async ({ page }) => {
    await page.goto("/recruiter");
    await page.waitForURL(`**${TEXT_PAGE}`);
    await expect(page.locator("h1")).toHaveText([PROFILE.name]);
  });
});

test.describe("the old address", () => {
  test("is a forward: a meta refresh, a link, and kept out of search", async ({ request }) => {
    // A meta refresh, since a static export has no server to redirect; and a link, for anything that follows neither.
    const html = await (await request.get("/recruiter")).text();
    expect(html).toContain(`<meta http-equiv="refresh" content="0; url=${TEXT_PAGE}"/>`);
    expect(html).toMatch(new RegExp(`<a[^>]* href="${TEXT_PAGE}"`));
    expect(html).toMatch(/<meta name="robots" content="noindex"\/>/);
  });

  test("forwards here", async ({ page }) => {
    await page.goto("/recruiter");
    await page.waitForURL(`**${TEXT_PAGE}`);
    await expect(page.locator("h1")).toHaveText([PROFILE.name]);
  });
});
