// The title window's `neofetch` lists the projects under "Projects". A project without GitHub stats (any build without
// a token, and every project the owner adds without a repository) shows its name and one-line summary, never a made-up
// "n/a ★ 0 ⑂ 0".

import assert from "node:assert/strict";
import { test } from "node:test";
import type { Project } from "../lib/projects.ts";
import { HEADER_PROJECTS, headerProjects } from "./headerProjects.ts";

function project(over: Partial<Project>): Project {
  return {
    slug: "p", name: "P", summary: "A project.", body: "", order: 1,
    repo: null, repoUrl: null, link: null, image: null, github: null,
    ...over,
  };
}

const GITHUB: NonNullable<Project["github"]> = {
  stars: 3,
  forks: 1,
  language: { name: "Rust", color: "#dea584" },
  languages: [{ name: "Rust", color: "#dea584", percentage: 100 }],
  updatedAt: "2026-11-01T00:00:00Z",
};

test("a project without GitHub stats keeps its name and summary, and has no stats at all", () => {
  const [row] = headerProjects([
    project({ name: "Leaf", summary: "A small Discord bot.", repo: "o/leaf", repoUrl: "https://github.com/o/leaf" }),
  ]);
  assert.deepEqual(row, { name: "Leaf", url: "https://github.com/o/leaf", summary: "A small Discord bot.", stats: null });
});

test("a project with GitHub stats has its language, stars and forks", () => {
  const [row] = headerProjects([project({ name: "Leaf", repoUrl: "https://github.com/o/leaf", github: GITHUB })]);
  assert.deepEqual(row.stats, { language: { name: "Rust", color: "#dea584" }, stars: 3, forks: 1 });
  const [none] = headerProjects([project({ repoUrl: "https://github.com/o/x", github: { ...GITHUB, language: null } })]);
  assert.deepEqual(none.stats, { language: null, stars: 3, forks: 1 }, "a repository GitHub gives no language still has its counts");
});

test("the name links to the repository, else to the project's link, else nowhere, and every project is listed", () => {
  const rows = headerProjects([
    project({ name: "A", repoUrl: "https://github.com/o/a", link: "https://a.example" }),
    project({ name: "B", link: "https://b.example" }),
    project({ name: "C" }),
  ]);
  assert.deepEqual(rows.map((r) => [r.name, r.url]), [["A", "https://github.com/o/a"], ["B", "https://b.example"], ["C", null]]);
});

test("the window lists the first six, in the order they come", () => {
  assert.equal(HEADER_PROJECTS, 6);
  const names = "abcdefgh".split("").map((n) => n.toUpperCase());
  const rows = headerProjects(names.map((name, i) => project({ name, slug: name, order: i })));
  assert.deepEqual(rows.map((r) => r.name), ["A", "B", "C", "D", "E", "F"]);
});
