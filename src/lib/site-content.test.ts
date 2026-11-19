import assert from "node:assert/strict";
import { test } from "node:test";
import { EMAIL, LINKS, PROFILE } from "../components/terminal/content.ts";
import {
  SITE_PAGES,
  TEXT_PAGE,
  absoluteUrl,
  bareUrl,
  contactLinks,
  formatDay,
  otherPages,
  personJsonLd,
  profileFacts,
  profileSummary,
  projectFacts,
  publishedProjects,
  withScheme,
  type Project,
} from "./site-content.ts";

const ZETA: Project = {
  name: "zeta-tool",
  description: "A sample project showcasing modern web development",
  url: "https://github.com/danielhkuo/zeta-tool",
  homepageUrl: "https://www.example.com/",
  primaryLanguage: { name: "TypeScript" },
  languages: [
    { name: "TypeScript", percentage: 65.44 },
    { name: "JavaScript", percentage: 34.52 },
  ],
  stargazerCount: 42,
  forkCount: 7,
  updatedAt: "2026-09-08T12:00:00Z",
};

const BARE: Project = {
  name: "Alpha",
  description: "",
  url: "https://github.com/danielhkuo/Alpha",
  homepageUrl: null,
  primaryLanguage: null,
  languages: [],
  stargazerCount: 0,
  forkCount: 0,
  updatedAt: "2026-08-29T12:00:00Z",
};

test("an address is shown without its scheme, www or trailing slash", () => {
  assert.equal(bareUrl("https://www.linkedin.com/in/someone/"), "linkedin.com/in/someone");
  assert.equal(bareUrl("http://example.com"), "example.com");
  assert.equal(bareUrl("https://github.com/someone/repo"), "github.com/someone/repo");
});

test("a path on the site becomes an address on the live site; other addresses are kept", () => {
  assert.equal(absoluteUrl("/minimal"), "https://danielhkuo.github.io/minimal");
  assert.equal(absoluteUrl("/"), "https://danielhkuo.github.io/");
  assert.equal(absoluteUrl("https://github.com/someone"), "https://github.com/someone");
  assert.equal(absoluteUrl("mailto:someone@example.com"), "mailto:someone@example.com");
});

test("an address without a scheme gets https; one with a scheme is kept", () => {
  assert.equal(withScheme("example.com/app"), "https://example.com/app");
  assert.equal(withScheme("http://example.com"), "http://example.com");
  assert.equal(withScheme("https://example.com/"), "https://example.com/");
});

test("a date reads as day, month and year, in UTC", () => {
  assert.equal(formatDay("2026-09-08T12:00:00Z"), "8 Sep 2026");
  // Still the old year in UTC, though it is New Year's Day where it was written.
  assert.equal(formatDay("2026-01-01T00:30:00+01:00"), "31 Dec 2025");
});

test("the contacts are the mailbox, GitHub, LinkedIn and the résumé, as content.ts gives them", () => {
  assert.deepEqual(
    contactLinks().map((c) => c.href),
    [LINKS.email, LINKS.github, LINKS.linkedin, LINKS.resume],
  );
});

test("the mailbox contact shows the address itself", () => {
  const email = contactLinks().find((c) => c.href === LINKS.email);
  assert.equal(email?.text, EMAIL);
});

test("a project's facts give its language, stars, forks and last update", () => {
  assert.equal(projectFacts(ZETA), "TypeScript · 42 stars · 7 forks · updated 8 Sep 2026");
});

test("one star and one fork are singular", () => {
  const one = { ...ZETA, primaryLanguage: { name: "Rust" }, stargazerCount: 1, forkCount: 1 };
  assert.equal(projectFacts(one), "Rust · 1 star · 1 fork · updated 8 Sep 2026");
});

test("with no language, stars or forks, the facts are only the update, capitalised", () => {
  assert.equal(projectFacts(BARE), "Updated 29 Aug 2026");
});

test("pinned repos fetched from GitHub are published as they are", () => {
  assert.deepEqual(publishedProjects({ repos: [ZETA, BARE], source: "github" }), [ZETA, BARE]);
});

test("the offline sample repos are never published", () => {
  assert.deepEqual(publishedProjects({ repos: [ZETA, BARE], source: "sample" }), []);
});

test("the one-line summary names the title, school, location and what is being built", () => {
  const summary = profileSummary();
  for (const part of [PROFILE.title, PROFILE.school, PROFILE.location, PROFILE.building]) {
    assert.ok(summary.includes(part), `missing ${part}`);
  }
});

test("the profile facts are every field of the profile but the name and title, labelled by field", () => {
  const facts = profileFacts();
  const values = facts.map((f) => f.value);
  assert.ok(!values.includes(PROFILE.name) && !values.includes(PROFILE.title));
  assert.deepEqual(new Set(values), new Set([PROFILE.previously, PROFILE.school, PROFILE.location, PROFILE.building]));
  assert.equal(facts.find((f) => f.value === PROFILE.previously)?.label, "Previously");
});

test("the text version is a page of the site, at the address its route folder has", async () => {
  const { existsSync } = await import("node:fs");
  assert.ok(SITE_PAGES.some((page) => page.path === TEXT_PAGE && page.isText));
  assert.ok(existsSync(new URL(`../app${TEXT_PAGE}/page.tsx`, import.meta.url)), `no page at src/app${TEXT_PAGE}`);
});

test("the terminal has no page of its own: the text version is where it is", () => {
  assert.ok(!SITE_PAGES.some((page) => page.title === "Terminal"));
  assert.match(SITE_PAGES.find((page) => page.path === TEXT_PAGE)?.summary ?? "", /terminal/);
});

test("a page's list of the others leaves itself out, and carries what a sitemap prints", () => {
  for (const from of [TEXT_PAGE, "/world"]) {
    const others = otherPages(from);
    assert.equal(others.length, SITE_PAGES.length - 1, from);
    assert.ok(!others.some((page) => page.path === from), from);
    for (const page of others) assert.deepEqual(Object.keys(page), ["title", "path", "summary"]);
  }
  // Flight is a page of the site: were it renamed, /world's terminal would list the page it is on.
  assert.ok(SITE_PAGES.some((page) => page.path === "/world"));
});

test("the JSON-LD names the person, the title, the text version and the mailbox", () => {
  const person = personJsonLd();
  assert.equal(person["@type"], "Person");
  assert.equal(person.name, PROFILE.name);
  assert.equal(person.jobTitle, PROFILE.title);
  assert.equal(person.url, `https://danielhkuo.github.io${TEXT_PAGE}`);
  assert.equal(person.email, LINKS.email);
  assert.deepEqual(person.sameAs, [LINKS.github]);
});
