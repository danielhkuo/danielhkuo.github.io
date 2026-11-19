// The static HTML: what a crawler, a reader and a visitor without JavaScript get. Everything the site says is here
// before any script runs, as headings, lists and links.

import { LINKS, PROFILE } from "../../src/components/terminal/content.ts";
import { SITE_PAGES, TEXT_PAGE } from "../../src/lib/site-content.ts";
import { expect, test } from "../support";
import { openMinimal } from "./minimal";

test.describe("with JavaScript off", () => {
  test.use({ javaScriptEnabled: false });

  test("the page has one h1, the name, and a heading for each section", async ({ page }) => {
    await openMinimal(page);
    await expect(page.locator("h1")).toHaveText([PROFILE.name]);
    await expect(page.locator("h2")).toHaveText(["Projects", "Contact", "Elsewhere on this site"]);
  });

  test("every profile fact is on the page", async ({ page }) => {
    await openMinimal(page);
    const text = await page.locator("main").innerText();
    for (const value of Object.values(PROFILE)) expect(text, value).toContain(value);
  });

  test("every way to get in touch and every other page is a link", async ({ page }) => {
    await openMinimal(page);
    const hrefs = await page.locator("main a").evaluateAll((links) => links.map((a) => a.getAttribute("href")));
    for (const href of Object.values(LINKS)) expect(hrefs, href).toContain(href);
    for (const other of SITE_PAGES.filter((p) => p.path !== TEXT_PAGE)) expect(hrefs, other.path).toContain(other.path);
  });

  test("the projects are there, or the pointer to GitHub that stands in for them", async ({ page }) => {
    await openMinimal(page);
    const projects = page.locator("section[aria-labelledby=projects]");
    expect(await projects.locator(`a[href^="${LINKS.github}"]`).count()).toBeGreaterThanOrEqual(1);
  });

  test("a line says the prompt needs JavaScript, and no dead control is offered", async ({ page }) => {
    await openMinimal(page);
    await expect(page.locator(".mt-note")).toContainText("needs JavaScript");
    // Nothing that could be pressed and do nothing: no button, no field, no link to the prompt.
    for (const selector of ["button", "input", ".mt-jump", ".mt-skip"]) {
      const shown = await page.locator(selector).evaluateAll((els) => els.filter((el) => el.getClientRects().length).length);
      expect(shown, selector).toBe(0);
    }
  });

  test("each section is named by its heading, and the command lines read as commands", async ({ page }) => {
    await openMinimal(page);
    for (const id of ["about", "projects", "contact", "elsewhere"]) {
      await expect(page.locator(`section[aria-labelledby=${id}] #${id}`), id).toHaveCount(1);
    }
    // The prompt before it is decoration, hidden from a screen reader.
    await expect(page.locator(".mt-cmd").first()).toHaveText(/Command: neofetch$/);
    await expect(page.locator(".mt-cmd .mt-ps").first()).toHaveAttribute("aria-hidden", "true");
  });

  test("the page carries its canonical address and the person as JSON-LD", async ({ page }) => {
    await openMinimal(page);
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
