import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, test, type TestContext } from "node:test";
import { loadProjects, type Project } from "./projects.ts";

// Every test reads a fixture folder made here, never the real projects/: the owner edits that one in the browser, and
// an edit there must never break a test.

const roots: string[] = [];
after(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

/**
 * A fresh fixture laid out as the repository is: `files` under projects/ (a name may hold a subfolder) and `images`
 * under public/projects/. Returns the projects folder, as loadProjects takes it.
 */
function fixture(files: Record<string, string>, images: string[] = []): string {
  const root = mkdtempSync(path.join(tmpdir(), "projects-"));
  roots.push(root);
  const dir = path.join(root, "projects");
  for (const [name, text] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(dir, name)), { recursive: true });
    writeFileSync(path.join(dir, name), text);
  }
  mkdirSync(path.join(root, "public", "projects"), { recursive: true });
  for (const name of images) {
    mkdirSync(path.dirname(path.join(root, "public", "projects", name)), { recursive: true });
    writeFileSync(path.join(root, "public", "projects", name), "");
  }
  return dir;
}

/** A project file: its front matter (YAML lines, as the owner writes them), then its body. */
function md(fields: string, body = ""): string {
  return `---\n${fields}\n---\n${body}`;
}

/** No GitHub: a test that wants it says so. */
const OFFLINE = { token: "" };

/** Quiets the warning a build without GitHub's stats gives, and returns its calls. */
function quiet(t: TestContext) {
  return t.mock.method(console, "warn", () => {});
}

/** The message a load fails with. */
async function failure(dir: string): Promise<string> {
  try {
    await loadProjects({ dir, ...OFFLINE });
  } catch (error) {
    assert.ok(error instanceof Error);
    return error.message;
  }
  assert.fail("the load should have failed");
}

const LAST = Number.MAX_SAFE_INTEGER;

// ---- reading a file -------------------------------------------------------------------------------------------------

test("a project file becomes a Project: its fields, its slug (the file's name) and its body", async (t) => {
  quiet(t);
  const dir = fixture(
    {
      "leaf.md": md(
        "name: Leaf\nsummary: A small Discord bot.\nrepo: danielhkuo/leaf\nlink: https://example.com/leaf\nimage: /projects/leaf.png\norder: 2",
        "\nLike BeReal, but for Discord.\n\nIt asks everyone for a photo at once.\n\n",
      ),
    },
    ["leaf.png"],
  );
  assert.deepEqual(await loadProjects({ dir, ...OFFLINE }), [
    {
      slug: "leaf",
      name: "Leaf",
      summary: "A small Discord bot.",
      body: "Like BeReal, but for Discord.\n\nIt asks everyone for a photo at once.",
      order: 2,
      repo: "danielhkuo/leaf",
      repoUrl: "https://github.com/danielhkuo/leaf",
      link: "https://example.com/leaf",
      image: "/projects/leaf.png",
      github: null,
    } satisfies Project,
  ]);
});

test("only the name and the summary are needed: the rest is null, the body empty and the order last", async () => {
  const dir = fixture({ "bare.md": md("name: Bare\nsummary: Just the two.") });
  assert.deepEqual(await loadProjects({ dir, ...OFFLINE }), [
    {
      slug: "bare",
      name: "Bare",
      summary: "Just the two.",
      body: "",
      order: LAST,
      repo: null,
      repoUrl: null,
      link: null,
      image: null,
      github: null,
    },
  ]);
});

test("a field left blank counts as left out, as a form editor saves it", async () => {
  const dir = fixture({ "blank.md": md("name: Blank\nsummary: Blank fields.\nrepo: ''\nlink:\nimage: \"\"\norder:") });
  const [p] = await loadProjects({ dir, ...OFFLINE });
  assert.deepEqual([p.repo, p.repoUrl, p.link, p.image, p.order], [null, null, null, null, LAST]);
});

test("the name and the summary are each one line, trimmed", async () => {
  const dir = fixture({ "s.md": md("name: '  Spaced   out '\nsummary: >\n  Folded onto\n  two lines.") });
  const [p] = await loadProjects({ dir, ...OFFLINE });
  assert.equal(p.name, "Spaced out");
  assert.equal(p.summary, "Folded onto two lines.");
});

test("a file saved with Windows line ends and a byte-order mark reads the same", async () => {
  const dir = fixture({ "w.md": "﻿---\r\nname: Win\r\nsummary: Saved on Windows.\r\n---\r\nFirst.\r\n\r\nSecond.\r\n" });
  const [p] = await loadProjects({ dir, ...OFFLINE });
  assert.deepEqual([p.name, p.summary, p.body], ["Win", "Saved on Windows.", "First.\n\nSecond."]);
});

test("a name that YAML would read as a number or a date is text once it is quoted", async () => {
  const dir = fixture({ "n.md": md("name: '2048'\nsummary: \"Colons: fine in quotes\"") });
  const [p] = await loadProjects({ dir, ...OFFLINE });
  assert.deepEqual([p.name, p.summary], ["2048", "Colons: fine in quotes"]);
});

test("an image may sit in a folder of its own under public/projects/", async () => {
  const dir = fixture({ "i.md": md("name: I\nsummary: s\nimage: /projects/shots/i.png") }, ["shots/i.png"]);
  assert.equal((await loadProjects({ dir, ...OFFLINE }))[0].image, "/projects/shots/i.png");
});

test("README.md is the folder's how-to, not a project; nor is anything but a .md file directly in the folder", async () => {
  const dir = fixture({
    "README.md": "# How to add a project\n\nNo front matter here.\n",
    "a.md": md("name: A\nsummary: s"),
    "notes.txt": "not a project",
    ".DS_Store": "",
    "drafts/b.md": md("name: B\nsummary: s"),
  });
  assert.deepEqual(
    (await loadProjects({ dir, ...OFFLINE })).map((p) => p.slug),
    ["a"],
  );
});

test("a folder with nothing but its README has no projects", async () => {
  assert.deepEqual(await loadProjects({ dir: fixture({ "README.md": "# How to\n" }), ...OFFLINE }), []);
});

// ---- order ------------------------------------------------------------------------------------------------------------

test("projects come lowest order first, ties by name, and those without an order last, by name", async () => {
  const dir = fixture({
    "c.md": md("name: Charlie\nsummary: s\norder: 2"),
    "b.md": md("name: Bravo\nsummary: s\norder: 1"),
    "d.md": md("name: Delta\nsummary: s\norder: 1"),
    "g.md": md("name: Golf\nsummary: s\norder: 1.5"),
    "f.md": md("name: Foxtrot\nsummary: s\norder: -1"),
    "z.md": md("name: Zulu\nsummary: s"),
    "a.md": md("name: alpha\nsummary: s"),
    "e.md": md("name: Echo\nsummary: s"),
  });
  assert.deepEqual(
    (await loadProjects({ dir, ...OFFLINE })).map((p) => p.name),
    ["Foxtrot", "Bravo", "Delta", "Golf", "Charlie", "alpha", "Echo", "Zulu"],
  );
});

test("names compare as a person reads them: numbers by value; the same name falls back to the file's name", async () => {
  const dir = fixture({
    "p10.md": md("name: Part 10\nsummary: s"),
    "p2.md": md("name: Part 2\nsummary: s"),
    "twin-b.md": md("name: Twin\nsummary: s\norder: 1"),
    "twin-a.md": md("name: Twin\nsummary: s\norder: 1"),
  });
  assert.deepEqual(
    (await loadProjects({ dir, ...OFFLINE })).map((p) => p.slug),
    ["twin-a", "twin-b", "p2", "p10"],
  );
});

// ---- what fails the build -----------------------------------------------------------------------------------------------

test("a missing name or summary fails the load, naming the file and the field", async () => {
  assert.match(await failure(fixture({ "x.md": md("summary: s") })), /projects\/x\.md: "name" is missing/);
  assert.match(await failure(fixture({ "x.md": md("name: X") })), /projects\/x\.md: "summary" is missing/);
});

test("empty front matter is missing both", async () => {
  const message = await failure(fixture({ "x.md": "---\n---\nA body alone.\n" }));
  assert.match(message, /x\.md: "name" is missing/);
  assert.match(message, /x\.md: "summary" is missing/);
});

test("a name that is not text fails, and says to quote it", async () => {
  const message = await failure(fixture({ "x.md": md("name: 2048\nsummary: s") }));
  assert.match(message, /x\.md: "name" must be text, but it is the number 2048/);
  assert.match(message, /name: "2048"/);
});

test("a summary that is a list fails", async () => {
  assert.match(
    await failure(fixture({ "x.md": md("name: X\nsummary:\n  - one\n  - two") })),
    /x\.md: "summary" must be text, but it is a list/,
  );
});

test("an order that is not a number fails", async () => {
  assert.match(
    await failure(fixture({ "x.md": md("name: X\nsummary: s\norder: first") })),
    /x\.md: "order" must be a number, like order: 3, but it is the text "first"/,
  );
  assert.match(await failure(fixture({ "x.md": md("name: X\nsummary: s\norder: .inf") })), /x\.md: "order" must be a number/);
});

test("a repo that is not owner/name fails", async () => {
  assert.match(
    await failure(fixture({ "x.md": md("name: X\nsummary: s\nrepo: https://github.com/danielhkuo/leaf") })),
    /x\.md: "repo" must be a GitHub repository written owner\/name, like danielhkuo\/leaf, but it is "https:\/\/github\.com\/danielhkuo\/leaf"/,
  );
  assert.match(await failure(fixture({ "x.md": md("name: X\nsummary: s\nrepo: leaf") })), /x\.md: "repo" must be/);
});

test("a link that is not a whole web address fails", async () => {
  assert.match(
    await failure(fixture({ "x.md": md("name: X\nsummary: s\nlink: example.com") })),
    /x\.md: "link" must be a whole web address, starting https:\/\/, but it is "example\.com"/,
  );
  assert.match(await failure(fixture({ "x.md": md("name: X\nsummary: s\nlink: ftp://example.com") })), /x\.md: "link" must be/);
});

test("an image with no file in public/projects/ fails, naming the file it looked for", async () => {
  assert.match(
    await failure(fixture({ "x.md": md("name: X\nsummary: s\nimage: /projects/nope.png") })),
    /x\.md: "image" is \/projects\/nope\.png, but there is no file at public\/projects\/nope\.png/,
  );
});

test("an image that is not a path under /projects/ fails", async () => {
  for (const image of ["nope.png", "/images/x.png", "/projects/../secret.txt", "https://example.com/x.png"]) {
    assert.match(
      await failure(fixture({ "x.md": md(`name: X\nsummary: s\nimage: ${image}`) }, ["x.png"])),
      /x\.md: "image" must be a file in public\/projects\/, written \/projects\/<its name>/,
      image,
    );
  }
});

test("an unknown field fails, naming the fields there are", async () => {
  const message = await failure(fixture({ "x.md": md("name: X\nsummary: s\ntitel: Typo") }));
  assert.match(message, /x\.md: unknown field "titel"/);
  assert.match(message, /name, summary, repo, link, image and order/);
});

test("a file name with a space or a symbol fails: it is the project's key", async () => {
  const message = await failure(fixture({ "My Project.md": md("name: X\nsummary: s") }));
  assert.match(message, /My Project\.md: the file name "My Project\.md" may use only letters, numbers, dots, dashes and underscores/);
});

test("a file that does not start with front matter fails", async () => {
  assert.match(
    await failure(fixture({ "x.md": "name: X\nsummary: s\n" })),
    /x\.md: the file must start with front matter: a line of three dashes \(---\)/,
  );
});

test("front matter that never closes fails", async () => {
  assert.match(await failure(fixture({ "x.md": "---\nname: X\nsummary: s\n" })), /x\.md: the front matter is never closed/);
});

test("front matter that is not valid YAML fails, at its line in the file", async () => {
  const message = await failure(fixture({ "x.md": md("name: X\nsummary: Colons: need quotes") }));
  assert.match(message, /x\.md, line 3: the front matter is not valid YAML/);
});

test("front matter that is not a set of fields fails", async () => {
  assert.match(await failure(fixture({ "x.md": md("- name\n- summary") })), /x\.md: the front matter must be fields/);
});

test("every problem in every file is reported at once, with where the format is written", async () => {
  const message = await failure(
    fixture({
      "a.md": md("name: A"),
      "b.md": md("name: B\nsummary: s\ncolour: red"),
      "c.md": md("name: C\nsummary: s"),
    }),
  );
  assert.match(message, /2 problems/);
  assert.match(message, /a\.md: "summary" is missing/);
  assert.match(message, /b\.md: unknown field "colour"/);
  assert.doesNotMatch(message, /c\.md/);
  assert.match(message, /projects\/README\.md/);
});

test("a folder that is not there fails", async () => {
  await assert.rejects(loadProjects({ dir: path.join(tmpdir(), "no-such-folder", "projects"), ...OFFLINE }), /no projects folder/i);
});

// ---- where the folder is --------------------------------------------------------------------------------------------------

test("the folder is projects/ where the build runs, or PROJECTS_DIR when it is set", async (t) => {
  const dir = fixture({ "here.md": md("name: Here\nsummary: s") });
  const was = { cwd: process.cwd(), env: process.env.PROJECTS_DIR };
  t.after(() => {
    process.chdir(was.cwd);
    if (was.env === undefined) delete process.env.PROJECTS_DIR;
    else process.env.PROJECTS_DIR = was.env;
  });

  delete process.env.PROJECTS_DIR;
  process.chdir(path.dirname(dir));
  assert.deepEqual((await loadProjects(OFFLINE)).map((p) => p.slug), ["here"]);

  process.chdir(was.cwd);
  process.env.PROJECTS_DIR = fixture({ "there.md": md("name: There\nsummary: s") });
  assert.deepEqual((await loadProjects(OFFLINE)).map((p) => p.slug), ["there"]);
});

// ---- GitHub's stats ---------------------------------------------------------------------------------------------------------

/** A repository as GitHub's GraphQL API answers for the fields the build asks of it. */
function repository(over: Record<string, unknown> = {}) {
  return {
    stargazerCount: 3,
    forkCount: 1,
    updatedAt: "2026-10-01T00:00:00Z",
    primaryLanguage: { name: "TypeScript", color: "#3178c6" },
    languages: {
      totalSize: 1000,
      edges: [
        { size: 750, node: { name: "TypeScript", color: "#3178c6" } },
        { size: 250, node: { name: "Dockerfile", color: null } },
      ],
    },
    ...over,
  };
}

/** A request the stand-in for GitHub saw. */
interface Seen {
  url: string;
  query: string;
  authorization: string | null;
  /** The repositories asked for, as owner/name, one per alias. */
  asked: string[];
}

/**
 * Stands in for GitHub's GraphQL endpoint. Each alias in the query (`alias: repository(owner: …, name: …)`, the
 * arguments as variables or as literals) is answered from `repos`, by "owner/name"; one not there is a repository
 * GitHub cannot find, answered as GitHub does: null, with an error. Returns the requests it saw.
 */
function github(t: TestContext, repos: Record<string, object>): Seen[] {
  const seen: Seen[] = [];
  t.mock.method(globalThis, "fetch", async (input: string | URL | Request, init?: RequestInit) => {
    const { query, variables = {} } = JSON.parse(String(init?.body)) as { query: string; variables?: Record<string, string> };
    const arg = (v: string) => (v.startsWith("$") ? variables[v.slice(1)] : (JSON.parse(v) as string));
    const data: Record<string, object | null> = {};
    const errors: object[] = [];
    const asked: string[] = [];
    const alias = /(\w+)\s*:\s*repository\s*\(\s*owner\s*:\s*(\$\w+|"[^"]*")\s*,\s*name\s*:\s*(\$\w+|"[^"]*")\s*\)/g;
    for (const [, key, owner, name] of query.matchAll(alias)) {
      const full = `${arg(owner)}/${arg(name)}`;
      asked.push(full);
      data[key] = repos[full] ?? null;
      if (!repos[full]) errors.push({ type: "NOT_FOUND", path: [key], message: `Could not resolve to a Repository with the name '${full}'.` });
    }
    seen.push({ url: String(input), query, authorization: new Headers(init?.headers).get("authorization"), asked });
    return new Response(JSON.stringify(errors.length ? { data, errors } : { data }), {
      status: 200,
      headers: { "content-type": "application/json; charset=utf-8" },
    });
  });
  return seen;
}

const STATS_FIXTURE = {
  "leaf.md": md("name: Leaf\nsummary: s\nrepo: danielhkuo/leaf\norder: 1"),
  "plant.md": md("name: Plant\nsummary: s\nrepo: danielhkuo/project-plant\norder: 2"),
  "novel.md": md("name: Novel\nsummary: s\norder: 3"),
};

test("with a token, one GraphQL request brings every repository's stats, mapped onto its project", async (t) => {
  const seen = github(t, {
    "danielhkuo/leaf": repository(),
    "danielhkuo/project-plant": repository({
      stargazerCount: 0,
      forkCount: 0,
      primaryLanguage: null,
      languages: { totalSize: 0, edges: [] },
    }),
  });
  const warn = quiet(t);
  const [leaf, plant, novel] = await loadProjects({ dir: fixture(STATS_FIXTURE), token: "t0ken" });

  assert.equal(seen.length, 1);
  assert.equal(seen[0].url, "https://api.github.com/graphql");
  assert.match(seen[0].authorization ?? "", /t0ken/);
  assert.deepEqual(seen[0].asked.sort(), ["danielhkuo/leaf", "danielhkuo/project-plant"]);

  assert.deepEqual(leaf.github, {
    stars: 3,
    forks: 1,
    language: { name: "TypeScript", color: "#3178c6" },
    languages: [
      { name: "TypeScript", color: "#3178c6", percentage: 75 },
      { name: "Dockerfile", color: "#858585", percentage: 25 },
    ],
    updatedAt: "2026-10-01T00:00:00Z",
  });
  assert.deepEqual(plant.github, { stars: 0, forks: 0, language: null, languages: [], updatedAt: "2026-10-01T00:00:00Z" });
  // No repository, nothing to ask GitHub.
  assert.equal(novel.github, null);
  assert.equal(warn.mock.callCount(), 0);
});

test("two projects of one repository ask for it once and both get its stats", async (t) => {
  const seen = github(t, { "o/mono": repository() });
  const dir = fixture({
    "front.md": md("name: Front\nsummary: s\nrepo: o/mono"),
    "back.md": md("name: Back\nsummary: s\nrepo: o/mono"),
  });
  const projects = await loadProjects({ dir, token: "t" });
  assert.deepEqual(seen[0].asked, ["o/mono"]);
  for (const p of projects) assert.equal(p.github?.stars, 3);
});

test("a repository GitHub cannot find leaves that project without stats, keeps the others', and warns once", async (t) => {
  github(t, { "danielhkuo/leaf": repository() });
  const warn = quiet(t);
  const dir = fixture({
    ...STATS_FIXTURE,
    "gone.md": md("name: Gone\nsummary: s\nrepo: o/gone"),
    "lost.md": md("name: Lost\nsummary: s\nrepo: o/lost"),
  });
  const bySlug = new Map((await loadProjects({ dir, token: "t" })).map((p) => [p.slug, p]));
  assert.equal(bySlug.get("leaf")?.github?.stars, 3);
  for (const slug of ["plant", "gone", "lost"]) assert.equal(bySlug.get(slug)?.github, null, slug);
  assert.equal(warn.mock.callCount(), 1);
  const said = String(warn.mock.calls[0].arguments[0]);
  for (const repo of ["danielhkuo/project-plant", "o/gone", "o/lost"]) assert.ok(said.includes(repo), `${repo} in: ${said}`);
});

test("when the request fails, every project is built without stats and the build goes on, warned once", async (t) => {
  t.mock.method(globalThis, "fetch", async () => {
    throw new TypeError("fetch failed");
  });
  const warn = quiet(t);
  const projects = await loadProjects({ dir: fixture(STATS_FIXTURE), token: "t" });
  assert.equal(projects.length, 3);
  for (const p of projects) assert.equal(p.github, null);
  assert.equal(warn.mock.callCount(), 1);
});

test("without a token nothing is fetched: every project is built without stats, warned once", async (t) => {
  const fetch = t.mock.method(globalThis, "fetch", async () => {
    throw new Error("nothing should be fetched");
  });
  const warn = quiet(t);
  const projects = await loadProjects({ dir: fixture(STATS_FIXTURE), token: "" });
  assert.equal(fetch.mock.callCount(), 0);
  for (const p of projects) assert.equal(p.github, null);
  assert.equal(warn.mock.callCount(), 1);
  assert.match(String(warn.mock.calls[0].arguments[0]), /GITHUB_TOKEN/);
});

test("the token is GITHUB_TOKEN's unless one is given", async (t) => {
  const was = process.env.GITHUB_TOKEN;
  t.after(() => {
    if (was === undefined) delete process.env.GITHUB_TOKEN;
    else process.env.GITHUB_TOKEN = was;
  });
  process.env.GITHUB_TOKEN = "from-the-environment";
  const seen = github(t, { "danielhkuo/leaf": repository(), "danielhkuo/project-plant": repository() });
  await loadProjects({ dir: fixture(STATS_FIXTURE) });
  assert.equal(seen.length, 1);
  assert.match(seen[0].authorization ?? "", /from-the-environment/);
});

test("with no project naming a repository, nothing is fetched and nothing is warned, token or not", async (t) => {
  const fetch = t.mock.method(globalThis, "fetch", async () => {
    throw new Error("nothing should be fetched");
  });
  const warn = quiet(t);
  const dir = fixture({ "novel.md": md("name: Novel\nsummary: s") });
  for (const token of ["", "t"]) await loadProjects({ dir, token });
  assert.equal(fetch.mock.callCount(), 0);
  assert.equal(warn.mock.callCount(), 0);
});
