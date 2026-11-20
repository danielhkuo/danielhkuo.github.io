import assert from "node:assert/strict";
import { test } from "node:test";
import type { Project } from "../../lib/projects.ts";
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
/** The landmarks a project can stand at: every site but the abbey. */
const ROOM = SITES.length - 1;
const MANIFEST = { worldId: "w1", n: N, sites: SITES };

function project(slug: string, order = 1): Project {
  return {
    slug,
    name: `The ${slug}`,
    summary: `${slug} does things`,
    body: "",
    order,
    repo: `someone/${slug}`,
    repoUrl: `https://github.com/someone/${slug}`,
    link: null,
    image: null,
    github: { stars: 3, forks: 1, language: { name: "Rust", color: "#dea584" }, languages: [], updatedAt: "2026-10-01T00:00:00Z" },
  };
}
const PROJECTS: ProjectEntry[] = ["alpha", "beta", "gamma"].map((slug, i) => entryOf(project(slug, i + 1)));

/** Where each project stands: slug → site id. */
function sitesOf(set: ReturnType<typeof landmarksFor>["set"]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const l of set.landmarks) if (l.holds.kind === "project") out[l.holds.project.slug] = l.id;
  return out;
}

test("the abbey holds About Me, never a project", () => {
  const { set } = landmarksFor(MANIFEST, PROJECTS, {}, null);
  const abbey = set.landmarks.find((l) => l.type === "abbey")!;
  assert.deepEqual(abbey.holds, { kind: "about" });
});

test("each project stands at one site, carrying its own data", () => {
  const { set } = landmarksFor(MANIFEST, PROJECTS, {}, null);
  const held = set.landmarks.flatMap((l) => (l.holds.kind === "project" ? [l.holds.project] : []));
  assert.deepEqual(held.map((p) => p.slug).sort(), ["alpha", "beta", "gamma"]);
  for (const p of held) assert.deepEqual(p, PROJECTS.find((q) => q.slug === p.slug));
});

test("the other sites are landmarks that hold nothing", () => {
  const { set } = landmarksFor(MANIFEST, PROJECTS, {}, null);
  assert.equal(set.landmarks.length, SITES.length);
  assert.equal(set.landmarks.filter((l) => l.holds.kind === "none").length, ROOM - PROJECTS.length);
  assert.deepEqual([set.worldId, set.n], ["w1", N]);
});

test("more projects than landmarks: the first in order stand at them, and the rest are left for the hall", () => {
  const nine = Array.from({ length: 9 }, (_, i) => entryOf(project(`p${i + 1}`, i + 1)));
  const { set, bySite } = landmarksFor(MANIFEST, nine, {}, null);
  assert.deepEqual(Object.keys(sitesOf(set)).sort(), ["p1", "p2", "p3", "p4", "p5"]);
  assert.equal(Object.keys(bySite).length, ROOM);
  assert.equal(set.landmarks.filter((l) => l.holds.kind === "none").length, 0);
});

test("a project moved up the order takes the last one's landmark; the others stay where they stood", () => {
  const five = ["a", "b", "c", "d", "e"].map((slug, i) => entryOf(project(slug, i + 1)));
  const before = landmarksFor(MANIFEST, five, {}, null);
  const sticky = { worldId: "w1", bySite: before.bySite };
  const after = landmarksFor(MANIFEST, [entryOf(project("new", 0)), ...five], {}, sticky);
  const was = sitesOf(before.set), now = sitesOf(after.set);
  assert.equal(now.e, undefined);
  assert.equal(now.new, was.e);
  for (const slug of ["a", "b", "c", "d"]) assert.equal(now[slug], was[slug], slug);
  assert.equal(after.changed, true);
});

test("the sticky file keeps a project where it stood, by its slug", () => {
  const sticky = { worldId: "w1", bySite: { "windmill-0": "alpha", "lighthouse-1": "gamma" } };
  const { set } = landmarksFor(MANIFEST, PROJECTS, {}, sticky);
  assert.equal(sitesOf(set).alpha, "windmill-0");
  assert.equal(sitesOf(set).gamma, "lighthouse-1");
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
  const removed = landmarksFor(MANIFEST, PROJECTS.slice(1), {}, { worldId: "w1", bySite: fresh.bySite });
  assert.equal(removed.changed, true);
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

test("an entry keeps what the Codex shows of a project", () => {
  assert.deepEqual(entryOf({ ...project("leaf"), link: "https://example.com/leaf" }), {
    slug: "leaf",
    name: "The leaf",
    summary: "leaf does things",
    repoUrl: "https://github.com/someone/leaf",
    link: "https://example.com/leaf",
    language: "Rust",
    stars: 3,
    forks: 1,
    updatedAt: "2026-10-01T00:00:00Z",
  });
});

test("an entry for a project built without GitHub's stats, or with no repository, has nulls where they would be", () => {
  const e = entryOf({ ...project("novel"), repo: null, repoUrl: null, github: null });
  assert.deepEqual([e.repoUrl, e.link, e.language, e.stars, e.forks, e.updatedAt], [null, null, null, null, null, null]);
  const quiet = entryOf({ ...project("quiet"), github: { stars: 0, forks: 0, language: null, languages: [], updatedAt: "2026-10-01T00:00:00Z" } });
  assert.deepEqual([quiet.language, quiet.stars, quiet.forks], [null, 0, 0]);
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
  // A project is listed by its name.
  for (const r of reg) if (r.id !== "abbey-0") assert.match(r.title, /^The /);
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

test("a landing is logged by the project's slug, so a new world keeps it; the abbey and empty landmarks by their own names", () => {
  const { set } = landmarksFor(MANIFEST, PROJECTS, {}, null);
  const at = set.landmarks.find((l) => l.holds.kind === "project")!;
  const p = at.holds.kind === "project" ? at.holds.project : null;
  assert.ok(p);
  assert.deepEqual(discoveryOf(at), { id: `landmark:repo:${p.slug}`, label: `${p.name}, at the ${kindName(at.type)}` });
  assert.deepEqual(discoveryOf(set.landmarks.find((l) => l.type === "abbey")!), { id: "landmark:abbey", label: "The abbey: About me" });
  const empty = set.landmarks.find((l) => l.holds.kind === "none")!;
  assert.deepEqual(discoveryOf(empty), { id: `landmark:site:${empty.id}`, label: `The ${kindName(empty.type)}` });
});

test("every kind of landmark has a name to show", () => {
  assert.equal(kindName("cathedral"), "ruined cathedral");
  assert.equal(kindName("yew"), "churchyard yew");
  for (const t of ["abbey", "town", "lighthouse", "windmill", "bridge"] as const) assert.equal(kindName(t), t);
});
