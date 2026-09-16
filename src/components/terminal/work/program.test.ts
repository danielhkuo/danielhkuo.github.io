import assert from "node:assert/strict";
import { test } from "node:test";
import type { ProgramHost, SlimProject, TerminalLine } from "../types";
import type { Screen } from "../tty/screen.ts";
import { WorkProgram, hostOf, longDate } from "./program.ts";

const REPOS: SlimProject[] = [
  {
    name: "example-project",
    description: "A sample project showcasing modern web development",
    url: "https://github.com/danielhkuo/example-project",
    homepageUrl: "https://example.com",
    primaryLanguage: { name: "TypeScript", color: "#3178c6" },
    languages: [
      { name: "TypeScript", percentage: 65.4 },
      { name: "JavaScript", percentage: 20.3 },
      { name: "CSS", percentage: 14.3 },
    ],
    stargazerCount: 42,
    forkCount: 7,
    updatedAt: "2026-09-08T12:00:00Z",
  },
  {
    name: "empty-state-repo",
    description: "",
    url: "https://github.com/danielhkuo/empty-state-repo",
    homepageUrl: null,
    primaryLanguage: null,
    languages: [],
    stargazerCount: 0,
    forkCount: 0,
    updatedAt: "2026-09-08T12:00:00Z",
  },
  {
    name: "third-pinned-repo",
    description: "Placeholder",
    url: "https://github.com/danielhkuo/third",
    homepageUrl: null,
    primaryLanguage: { name: "Python", color: "#3572A5" },
    languages: [
      { name: "Python", percentage: 78 },
      { name: "Shell", percentage: 22 },
    ],
    stargazerCount: 18,
    forkCount: 3,
    updatedAt: "2026-08-29T12:00:00Z",
  },
];

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

function boot(rows = 30, cols = 100) {
  const opened: string[] = [];
  const p = new WorkProgram(REPOS, { openUrl: (u) => opened.push(u) });
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

test("split layout: header, list pane with the first repo selected, detail pane, keybar", () => {
  const { p, screen } = boot();
  const t = rows(screen);
  assert.match(t[0], /^ work — pinned repositories .*github\.com\/danielhkuo/);
  assert.match(t[2], /\[1\] repos ─ 3/);
  assert.match(t[3], /^ › example-project +★42 │/);
  assert.match(t[4], /^ {3}empty-state-repo +★ 0 │/);
  assert.deepEqual(inverseRows(screen), [3]);
  assert.match(t[2], /\[2\] detail/);
  const detail = t.join("\n");
  assert.match(detail, /│ example-project\n/);
  assert.match(detail, /stars {5}42/);
  assert.match(detail, /updated {3}8 Sep 2026/);
  assert.match(detail, /homepage {2}example\.com/);
  assert.match(detail, /TypeScript {2}█+░+ 65\.4%/);
  assert.match(t[29], /↑↓ move {3}⏎ repository {3}o homepage {3}\/ filter {3}q quit/);
  assert.equal(p.textInput, false);
  assert.equal(p.title, "work");
});

test("arrows move the selection and the detail follows; Enter and o open links", () => {
  const { p, screen, opened } = boot();
  p.key("ArrowDown", false);
  assert.equal(p.selected?.name, "empty-state-repo");
  assert.deepEqual(inverseRows(screen), [4]);
  assert.match(rows(screen).join("\n"), /no description/);
  assert.match(rows(screen).join("\n"), /none reported/);
  p.key("Enter", false);
  assert.deepEqual(opened, ["https://github.com/danielhkuo/empty-state-repo"]);
  p.key("o", false); // no homepage: nothing happens
  assert.equal(opened.length, 1);
  p.key("k", false);
  p.key("o", false);
  assert.equal(opened[1], "https://example.com");
  p.key("End", false);
  assert.equal(p.selected?.name, "third-pinned-repo");
  p.key("ArrowDown", false);
  assert.equal(p.selected?.name, "third-pinned-repo");
});

test("/ opens the filter, which wants the keyboard; typing narrows the list; Escape cancels", () => {
  const { p, screen } = boot();
  p.key("/", false);
  assert.equal(p.textInput, true);
  for (const ch of "thi") p.key(ch, false);
  const t = rows(screen);
  assert.match(t[2], /repos ─ 1/);
  assert.match(t[3], /› third-pinned-repo/);
  assert.match(t[29], /^ \/ thi .*esc cancel/);
  assert.equal(p.selected?.name, "third-pinned-repo");
  // The match is picked out in yellow, not inverse.
  const runs = screen.rowRuns(3);
  assert.ok(runs.some((r) => r.text === "thi" && r.fg === 3 && !r.inverse));
  p.key("Enter", false);
  assert.equal(p.textInput, false);
  assert.equal(p.filterText, "thi");
  assert.match(rows(screen).join("\n"), /2 hidden by filter/);
  p.key("Escape", false);
  assert.equal(p.filterText, "");
  assert.equal(p.selected?.name, "example-project");
  p.key("/", false);
  for (const ch of "zz") p.key(ch, false);
  assert.equal(p.selected, null);
  assert.match(rows(screen).join("\n"), /no repo matches/);
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

test("narrow: 52pt rows with meta, Enter drills into the detail, Escape comes back", () => {
  const { p, screen, opened } = boot(40, 48);
  assert.equal(p.isNarrow, true);
  const t = rows(screen);
  assert.match(t[0], /^ work — 3 pinned .*github\.com\/danielhkuo/);
  assert.match(t[2], /^ › example-project/);
  assert.match(t[3], /^ {3}■ TypeScript · ★ 42 · ⑂ 7/);
  assert.match(t[5], /^ {3}empty-state-repo/);
  assert.match(t[6], /^ {3}no language data · ★ 0 · ⑂ 0/);
  assert.deepEqual(inverseRows(screen), [2, 3]);
  assert.match(t[38], /⏎ open.*│.*o site.*│.*\/ filter.*│.*q quit/);

  p.key("Enter", false);
  assert.equal(p.screenName, "detail");
  assert.equal(opened.length, 0);
  const d = rows(screen);
  assert.match(d[0], /^ ‹ work \/ example-project .*1\/3/);
  assert.match(d[2], /^ {2}example-project/);
  const body = d.join("\n");
  assert.match(body, /TypeScript +65\.4%\n {2}█+░+/);
  assert.match(d[38], /esc back.*⏎ repository.*o homepage/);
  p.key("Enter", false);
  assert.deepEqual(opened, ["https://github.com/danielhkuo/example-project"]);
  p.key("Escape", false);
  assert.equal(p.screenName, "list");
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
  p.tap(39, 20); // ⏎ repository, on the blank padding row of the keybar
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
