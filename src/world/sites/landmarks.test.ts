import assert from "node:assert/strict";
import { test } from "node:test";
import { CRUISE } from "../runtime/flight.ts";
import { discoveryOf, entryOf, kindName, landmarksFor, registerFrom, stickyFrom, stickyText, type ProjectEntry } from "./landmarks.ts";

const N = 6400;
const SITES = [
  { id: "abbey-0", type: "abbey", x: 1000, y: 1000 },
  { id: "town-0", type: "town", x: 1300, y: 1800 },
  { id: "lighthouse-0", type: "lighthouse", x: 3000, y: 500 },
  { id: "lighthouse-1", type: "lighthouse", x: 5800, y: 5900 },
  { id: "windmill-0", type: "windmill", x: 2500, y: 3000 },
  { id: "cathedral-0", type: "cathedral", x: 3500, y: 5200 },
];
const MANIFEST = { worldId: "w1", n: N, sites: SITES };

function repo(name: string) {
  return {
    name,
    description: `${name} does things`,
    url: `https://github.com/someone/${name}`,
    homepageUrl: null,
    primaryLanguage: { name: "Rust", color: "#dea584" },
    stargazerCount: 3,
    forkCount: 1,
    updatedAt: "2026-10-01T00:00:00Z",
  };
}
const PROJECTS: ProjectEntry[] = ["alpha", "beta", "gamma"].map((name) => entryOf(repo(name)));

test("the abbey holds About Me, never a project", () => {
  const { set } = landmarksFor(MANIFEST, PROJECTS, {}, null);
  const abbey = set.landmarks.find((l) => l.type === "abbey")!;
  assert.deepEqual(abbey.holds, { kind: "about" });
});

test("each pinned project stands at one site, carrying its own data", () => {
  const { set } = landmarksFor(MANIFEST, PROJECTS, {}, null);
  const held = set.landmarks.flatMap((l) => (l.holds.kind === "project" ? [l.holds.project] : []));
  assert.deepEqual(held.map((p) => p.name).sort(), ["alpha", "beta", "gamma"]);
  for (const p of held) assert.deepEqual(p, PROJECTS.find((q) => q.name === p.name));
});

test("the other sites are landmarks that hold nothing", () => {
  const { set } = landmarksFor(MANIFEST, PROJECTS, {}, null);
  assert.equal(set.landmarks.length, SITES.length);
  assert.equal(set.landmarks.filter((l) => l.holds.kind === "none").length, SITES.length - 1 - PROJECTS.length);
  assert.deepEqual([set.worldId, set.n], ["w1", N]);
});

test("the sticky file keeps a project where it stood", () => {
  const sticky = { worldId: "w1", bySite: { "windmill-0": "alpha", "lighthouse-1": "gamma" } };
  const { set } = landmarksFor(MANIFEST, PROJECTS, {}, sticky);
  const siteOf = (name: string) => set.landmarks.find((l) => l.holds.kind === "project" && l.holds.project.name === name)!.id;
  assert.equal(siteOf("alpha"), "windmill-0");
  assert.equal(siteOf("gamma"), "lighthouse-1");
});

test("a sticky file from another world is ignored", () => {
  const sticky = { worldId: "older", bySite: { "windmill-0": "alpha" } };
  assert.deepEqual(landmarksFor(MANIFEST, PROJECTS, {}, sticky), landmarksFor(MANIFEST, PROJECTS, {}, null));
});

test("changed says when the sticky file no longer matches", () => {
  const fresh = landmarksFor(MANIFEST, PROJECTS, {}, null);
  assert.equal(fresh.changed, true);
  const kept = landmarksFor(MANIFEST, PROJECTS, {}, { worldId: "w1", bySite: fresh.bySite });
  assert.equal(kept.changed, false);
  const unpinned = landmarksFor(MANIFEST, PROJECTS.slice(1), {}, { worldId: "w1", bySite: fresh.bySite });
  assert.equal(unpinned.changed, true);
});

test("a malformed sticky file counts as none", () => {
  assert.equal(stickyFrom("nope", "w1"), null);
  assert.equal(stickyFrom(null, "w1"), null);
  assert.equal(stickyFrom({ worldId: "w1", bySite: [] }, "w1"), null);
  assert.deepEqual(stickyFrom({ worldId: "w1", bySite: { a: "x", b: 3 } }, "w1"), { bySite: { a: "x" }, features: {} });
});

test("the sticky text lists sites in order and reads back", () => {
  const text = stickyText("w1", { "windmill-0": "alpha", "abbey-x": "beta", "lighthouse-1": "gamma" });
  assert.deepEqual(Object.keys(JSON.parse(text).bySite), ["abbey-x", "lighthouse-1", "windmill-0"]);
  assert.deepEqual(stickyFrom(JSON.parse(text), "w1")?.bySite, { "abbey-x": "beta", "lighthouse-1": "gamma", "windmill-0": "alpha" });
  assert.ok(text.endsWith("\n"));
});

test("sites of kinds that are not landmarks are left out", () => {
  const { set } = landmarksFor({ ...MANIFEST, sites: [...SITES, { id: "baths-0", type: "baths", x: 10, y: 10 }] }, PROJECTS, {}, null);
  assert.ok(!set.landmarks.some((l) => l.id === "baths-0"));
});

test("an entry keeps what the Codex shows, and an empty homepage is none", () => {
  const e = entryOf({ ...repo("leaf"), homepageUrl: "" });
  assert.deepEqual(e, {
    name: "leaf",
    description: "leaf does things",
    url: "https://github.com/someone/leaf",
    homepageUrl: null,
    language: "Rust",
    stars: 3,
    forks: 1,
    updatedAt: "2026-10-01T00:00:00Z",
  });
  assert.equal(entryOf({ ...repo("x"), primaryLanguage: null }).language, null);
});

test("the register points from here to the abbey and every project, nearest first", () => {
  const { set } = landmarksFor(MANIFEST, PROJECTS, {}, null);
  const here = set.landmarks.find((l) => l.id === "town-0")!;
  const reg = registerFrom(here, set);
  assert.equal(reg.length, 1 + PROJECTS.length - (here.holds.kind === "project" ? 1 : 0));
  assert.ok(!reg.some((r) => r.id === here.id));
  for (let i = 1; i < reg.length; i++) assert.ok(reg[i - 1].seconds <= reg[i].seconds);
  const abbey = reg.find((r) => r.id === "abbey-0")!;
  // The abbey is 300 west and 800 north of the town: 21° off north.
  assert.equal(abbey.compass, "north");
  assert.equal(abbey.seconds, Math.round(Math.hypot(300, 800) / CRUISE));
  assert.equal(abbey.title, "About me");
});

test("the register measures across the world's edge", () => {
  const sites = [
    { id: "abbey-0", type: "abbey", x: 6300, y: 100 },
    { id: "windmill-0", type: "windmill", x: 100, y: 6300 },
  ];
  const { set } = landmarksFor({ worldId: "w", n: N, sites }, [], {}, null);
  const reg = registerFrom(set.landmarks[1], set);
  // From (100, 6300) the abbey is 200 west and 200 south, the short way round.
  assert.equal(reg[0].compass, "south-west");
  assert.equal(reg[0].seconds, Math.round(Math.hypot(200, 200) / CRUISE));
});

test("a landing is logged by repository, so a new world keeps it; the abbey and empty landmarks by their own names", () => {
  const { set } = landmarksFor(MANIFEST, PROJECTS, {}, null);
  const project = set.landmarks.find((l) => l.holds.kind === "project")!;
  const name = project.holds.kind === "project" ? project.holds.project.name : "";
  assert.deepEqual(discoveryOf(project), { id: `landmark:repo:${name}`, label: `${name}, at the ${kindName(project.type)}` });
  assert.deepEqual(discoveryOf(set.landmarks.find((l) => l.type === "abbey")!), { id: "landmark:abbey", label: "The abbey: About me" });
  const empty = set.landmarks.find((l) => l.holds.kind === "none")!;
  assert.deepEqual(discoveryOf(empty), { id: `landmark:site:${empty.id}`, label: `The ${kindName(empty.type)}` });
});

test("every kind of landmark has a name to show", () => {
  assert.equal(kindName("cathedral"), "ruined cathedral");
  assert.equal(kindName("yew"), "churchyard yew");
  for (const t of ["abbey", "town", "lighthouse", "windmill", "bridge"] as const) assert.equal(kindName(t), t);
});
