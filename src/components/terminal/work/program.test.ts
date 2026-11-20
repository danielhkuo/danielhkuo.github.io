import assert from "node:assert/strict";
import { test } from "node:test";
import type { Project } from "../../../lib/projects.ts";
import type { ProgramHost, TerminalLine } from "../types";
import type { Screen } from "../tty/screen.ts";
import { WorkProgram, hostOf, longDate } from "./program.ts";

const EXAMPLE: Project = {
  slug: "example-project",
  name: "example-project",
  summary: "A sample project showcasing modern web development",
  body: "",
  order: 1,
  repo: "danielhkuo/example-project",
  repoUrl: "https://github.com/danielhkuo/example-project",
  link: "https://example.com",
  image: null,
  github: {
    stars: 42,
    forks: 7,
    language: { name: "TypeScript", color: "#3178c6" },
    languages: [
      { name: "TypeScript", color: "#3178c6", percentage: 65.4 },
      { name: "JavaScript", color: "#f1e05a", percentage: 20.3 },
      { name: "CSS", color: "#563d7c", percentage: 14.3 },
    ],
    updatedAt: "2026-09-08T12:00:00Z",
  },
};

/** On GitHub, with nothing to show there: no language, no stars, no forks. No link. */
const EMPTY: Project = {
  slug: "empty-state-repo",
  name: "empty-state-repo",
  summary: "Nothing to report",
  body: "",
  order: 2,
  repo: "danielhkuo/empty-state-repo",
  repoUrl: "https://github.com/danielhkuo/empty-state-repo",
  link: null,
  image: null,
  github: { stars: 0, forks: 0, language: null, languages: [], updatedAt: "2026-09-08T12:00:00Z" },
};

/** Built without GitHub's stats, as a build without a token is. */
const NO_STATS: Project = {
  ...EMPTY,
  slug: "no-stats-project",
  name: "no-stats-project",
  summary: "Built without stats",
  order: 3,
  repo: "danielhkuo/no-stats-project",
  repoUrl: "https://github.com/danielhkuo/no-stats-project",
  github: null,
};

const REPOS: Project[] = [EXAMPLE, EMPTY, NO_STATS];

function host() {
  let paints = 0;
  const exits: (TerminalLine[] | undefined)[] = [];
  const h: ProgramHost = {
    paint: () => {
      paints++;
    },
    exit: (out) => exits.push(out),
  };
  return { h, get paints() { return paints; }, exits };
}

function boot(rows = 30, cols = 100, projects: Project[] = REPOS) {
  const opened: string[] = [];
  const p = new WorkProgram(projects, { openUrl: (u) => opened.push(u) });
  const h = host();
  const screen = p.start({ rows, cols }, h.h);
  return { p, h, screen, opened };
}

function rows(screen: Screen): string[] {
  const out: string[] = [];
  for (let y = 0; y < screen.rows; y++) out.push(screen.rowRuns(y).map((r) => r.text).join("").trimEnd());
  return out;
}

function inverseRows(screen: Screen): number[] {
  const out: number[] = [];
  for (let y = 0; y < screen.rows; y++) if (screen.rowRuns(y).some((r) => r.inverse && r.fg === -1)) out.push(y);
  return out;
}

test("split layout: header, list pane with the first project selected, detail pane, keybar", () => {
  const { p, screen } = boot();
  const t = rows(screen);
  assert.match(t[0], /^ work — projects .*github\.com\/danielhkuo/);
  assert.match(t[2], /\[1\] projects ─ 3/);
  assert.match(t[3], /^ › example-project +★42 │/);
  assert.match(t[4], /^ {3}empty-state-repo +★ 0 │/);
  // No stats, no count.
  assert.match(t[5], /^ {3}no-stats-project +│/);
  assert.doesNotMatch(t[5], /★/);
  assert.deepEqual(inverseRows(screen), [3]);
  assert.match(t[2], /\[2\] detail/);
  const detail = t.join("\n");
  assert.match(detail, /│ example-project\n/);
  assert.match(detail, /A sample project showcasing modern web development/);
  assert.match(detail, /stars {5}42/);
  assert.match(detail, /updated {3}8 Sep 2026/);
  assert.match(detail, /repo {6}danielhkuo\/example-project/);
  assert.match(detail, /link {6}example\.com/);
  assert.match(detail, /TypeScript {2}█+░+ 65\.4%/);
  assert.match(t[29], /↑↓ move {3}⏎ open {3}o link {3}\/ filter {3}q quit/);
  assert.equal(p.textInput, false);
  assert.equal(p.title, "work");
});

test("arrows move the selection and the detail follows; Enter opens the repository and o the link", () => {
  const { p, screen, opened } = boot();
  p.key("ArrowDown", false);
  assert.equal(p.selected?.name, "empty-state-repo");
  assert.deepEqual(inverseRows(screen), [4]);
  assert.match(rows(screen).join("\n"), /Nothing to report/);
  assert.match(rows(screen).join("\n"), /none reported/);
  p.key("Enter", false);
  assert.deepEqual(opened, ["https://github.com/danielhkuo/empty-state-repo"]);
  p.key("o", false); // no link: nothing happens
  assert.equal(opened.length, 1);
  p.key("k", false);
  p.key("o", false);
  assert.equal(opened[1], "https://example.com");
  p.key("End", false);
  assert.equal(p.selected?.name, "no-stats-project");
  p.key("ArrowDown", false);
  assert.equal(p.selected?.name, "no-stats-project");
});

test("a project built without GitHub's stats shows no counts or date, and no language mix", () => {
  const { p, screen } = boot();
  p.key("End", false);
  const detail = rows(screen).join("\n");
  assert.match(detail, /Built without stats/);
  assert.match(detail, /repo {6}danielhkuo\/no-stats-project/);
  assert.doesNotMatch(detail, /stars|forks|updated/);
  assert.match(detail, /none reported/);
});

test("Enter opens a project's link when it has no repository, and nothing when it has neither", () => {
  const site: Project = { ...NO_STATS, slug: "site", name: "site", repo: null, repoUrl: null, link: "https://example.com/site" };
  const novel: Project = { ...site, slug: "novel", name: "novel", link: null };
  const { p, opened } = boot(30, 100, [site, novel]);
  p.key("Enter", false);
  assert.deepEqual(opened, ["https://example.com/site"]);
  p.key("ArrowDown", false);
  p.key("Enter", false);
  p.key("o", false);
  assert.deepEqual(opened, ["https://example.com/site"]);
});

test("/ opens the filter, which wants the keyboard; typing narrows the list; Escape cancels", () => {
  const { p, screen } = boot();
  p.key("/", false);
  assert.equal(p.textInput, true);
  for (const ch of "no-s") p.key(ch, false);
  const t = rows(screen);
  assert.match(t[2], /projects ─ 1/);
  assert.match(t[3], /› no-stats-project/);
  assert.match(t[29], /^ \/ no-s .*esc cancel/);
  assert.equal(p.selected?.name, "no-stats-project");
  // The match is picked out in yellow, not inverse.
  const runs = screen.rowRuns(3);
  assert.ok(runs.some((r) => r.text === "no-s" && r.fg === 3 && !r.inverse));
  p.key("Enter", false);
  assert.equal(p.textInput, false);
  assert.equal(p.filterText, "no-s");
  assert.match(rows(screen).join("\n"), /2 hidden by filter/);
  p.key("Escape", false);
  assert.equal(p.filterText, "");
  assert.equal(p.selected?.name, "example-project");
  p.key("/", false);
  for (const ch of "zz") p.key(ch, false);
  assert.equal(p.selected, null);
  assert.match(rows(screen).join("\n"), /no project matches/);
  p.key("Escape", false);
  assert.equal(p.textInput, false);
  assert.equal(p.filterText, "");
});

test("q exits to the shell; Escape with nothing to back out of is declined so the window closes", () => {
  const { p, h } = boot();
  assert.equal(p.key("Escape", false), false);
  assert.equal(h.exits.length, 0);
  p.key("q", false);
  assert.deepEqual(h.exits, [undefined]);
});

test("many projects: the list scrolls to keep the selection in view", () => {
  const twelve = Array.from({ length: 12 }, (_, i) => ({ ...EXAMPLE, slug: `project-${i + 1}`, name: `project-${i + 1}` }));
  const { p, screen } = boot(12, 100, twelve);
  assert.match(rows(screen)[2], /\[1\] projects ─ 12/);
  p.key("End", false);
  assert.equal(p.selected?.name, "project-12");
  assert.ok(rows(screen).some((row) => /^ › project-12 /.test(row)));
  p.key("Home", false);
  assert.match(rows(screen)[3], /^ › project-1 /);
});

test("narrow: 52pt rows with meta, Enter drills into the detail, Escape comes back", () => {
  const { p, screen, opened } = boot(40, 48);
  assert.equal(p.isNarrow, true);
  const t = rows(screen);
  assert.match(t[0], /^ work — 3 projects .*github\.com\/danielhkuo/);
  assert.match(t[2], /^ › example-project/);
  assert.match(t[3], /^ {3}■ TypeScript · ★ 42 · ⑂ 7/);
  assert.match(t[5], /^ {3}empty-state-repo/);
  assert.match(t[6], /^ {3}no language data · ★ 0 · ⑂ 0/);
  // Without stats, the summary stands in for them.
  assert.match(t[8], /^ {3}no-stats-project/);
  assert.match(t[9], /^ {3}Built without stats$/);
  assert.deepEqual(inverseRows(screen), [2, 3]);
  assert.match(t[38], /⏎ open.*│.*o link.*│.*\/ filter.*│.*q quit/);

  p.key("Enter", false);
  assert.equal(p.screenName, "detail");
  assert.equal(opened.length, 0);
  const d = rows(screen);
  assert.match(d[0], /^ ‹ work \/ example-project .*1\/3/);
  assert.match(d[2], /^ {2}example-project/);
  const body = d.join("\n");
  assert.match(body, /TypeScript +65\.4%\n {2}█+░+/);
  assert.match(d[38], /esc back.*⏎ open.*o link/);
  p.key("Enter", false);
  assert.deepEqual(opened, ["https://github.com/danielhkuo/example-project"]);
  p.key("Escape", false);
  assert.equal(p.screenName, "list");
});

test("narrow: one project is counted as one", () => {
  const { screen } = boot(40, 48, [EXAMPLE]);
  assert.match(rows(screen)[0], /^ work — 1 project /);
});

test("narrow: taps select a row, a second tap opens it, and the keybar buttons act", () => {
  const { p, h, screen, opened } = boot(40, 48);
  p.tap(6, 10); // second row block (rows 5–7)
  assert.equal(p.selected?.name, "empty-state-repo");
  assert.deepEqual(inverseRows(screen), [5, 6]);
  p.tap(5, 10);
  assert.equal(p.screenName, "detail");
  p.tap(0, 3); // header ‹ goes back
  assert.equal(p.screenName, "list");
  p.tap(38, 2); // ⏎ open
  assert.equal(p.screenName, "detail");
  p.tap(39, 20); // ⏎ open, on the blank padding row of the keybar
  assert.deepEqual(opened, ["https://github.com/danielhkuo/empty-state-repo"]);
  p.tap(38, 2); // esc back
  p.tap(38, 46); // q quit
  assert.deepEqual(h.exits, [undefined]);
});

test("resize switches between the split and the drill-down", () => {
  const { p } = boot();
  const narrow = p.resize({ rows: 40, cols: 48 });
  assert.equal(p.isNarrow, true);
  assert.match(rows(narrow)[3], /■ TypeScript/);
  p.key("Enter", false);
  assert.equal(p.screenName, "detail");
  const wide = p.resize({ rows: 30, cols: 100 });
  assert.equal(p.screenName, "list");
  assert.match(rows(wide)[3], /› example-project/);
});

test("date and host helpers", () => {
  assert.equal(longDate("2026-09-08T00:00:00Z"), "8 Sep 2026");
  assert.equal(longDate("nope"), "—");
  assert.equal(hostOf("https://www.example.com/x"), "example.com");
  assert.equal(hostOf("not a url"), "not a url");
});
