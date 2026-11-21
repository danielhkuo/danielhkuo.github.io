import assert from "node:assert/strict";
import { test } from "node:test";
import { discoveryOf, kindName, landmarksFor, type HallProject, type Landmark } from "./landmarks.ts";

const N = 6400;
const SITES = [
  { id: "abbey-0", type: "abbey", x: 1000, y: 1000 },
  { id: "town-0", type: "town", x: 1300, y: 1800 },
  { id: "lighthouse-0", type: "lighthouse", x: 3000, y: 500 },
  { id: "windmill-0", type: "windmill", x: 2500, y: 3000 },
  { id: "cathedral-0", type: "cathedral", x: 3500, y: 5200 },
];
const MANIFEST = { worldId: "w1", n: N, sites: SITES };

function project(slug: string, order: number): HallProject {
  return {
    slug,
    name: slug.toUpperCase(),
    summary: `${slug} does things`,
    body: "",
    order,
    repo: null,
    repoUrl: null,
    link: null,
    image: null,
    github: null,
  };
}
const NINE: HallProject[] = ["a", "b", "c", "d", "e", "f", "g", "h", "i"].map((slug, i) => project(slug, i));
const PLACES = { worldId: "w1", stops: { pine: { x: 1100, y: 1200 }, desk: { x: 4000, y: 4000 } } };

function byId(list: Landmark[], id: string): Landmark | undefined {
  return list.find((l) => l.id === id);
}

test("the landmarks are the abbey, the hall and the stops; the other kinds are scenery", () => {
  const { set } = landmarksFor(MANIFEST, NINE, PLACES);
  assert.deepEqual(set.landmarks.map((l) => l.id), ["abbey-0", "town-0", "curio-pine", "curio-desk"]);
  assert.equal(byId(set.landmarks, "windmill-0"), undefined);
  assert.equal(set.worldId, "w1");
  assert.equal(set.n, N);
});

test("the abbey holds About Me", () => {
  const { set } = landmarksFor(MANIFEST, NINE, PLACES);
  assert.deepEqual(byId(set.landmarks, "abbey-0")!.holds, { kind: "about" });
});

test("until the world has a hall, the town is the hall, and it holds every project, however many", () => {
  const { set } = landmarksFor(MANIFEST, NINE, PLACES);
  const hall = byId(set.landmarks, "town-0")!;
  assert.equal(hall.type, "town");
  assert.equal(hall.holds.kind, "hall");
  if (hall.holds.kind === "hall") assert.deepEqual(hall.holds.projects.map((p) => p.slug), ["a", "b", "c", "d", "e", "f", "g", "h", "i"]);
  const none = landmarksFor(MANIFEST, [], PLACES).set;
  const empty = byId(none.landmarks, "town-0")!;
  assert.deepEqual(empty.holds, { kind: "hall", projects: [] });
});

test("a stop stands where the places file puts it, when the file is for this world", () => {
  const { set } = landmarksFor(MANIFEST, NINE, PLACES);
  const pine = byId(set.landmarks, "curio-pine")!;
  assert.equal(pine.type, "curio");
  assert.equal(pine.x, 1100);
  assert.equal(pine.y, 1200);
  assert.deepEqual(pine.holds, { kind: "stop", stop: "pine" });
});

test("a places file for another world, or a malformed one, places no stops", () => {
  for (const places of [{ worldId: "other", stops: PLACES.stops }, null, "x", { worldId: "w1", stops: { pine: { x: "1" } } }, { worldId: "w1", stops: { nope: { x: 1, y: 1 } } }]) {
    const { set } = landmarksFor(MANIFEST, NINE, places);
    assert.ok(!set.landmarks.some((l) => l.holds.kind === "stop"), JSON.stringify(places));
    assert.ok(set.landmarks.some((l) => l.holds.kind === "hall"));
  }
});

test("a world with a hall site and curio sites uses them over the town and the places file", () => {
  const sites = [...SITES, { id: "hall-0", type: "hall", x: 1500, y: 1700 }, { id: "curio-desk", type: "curio", x: 5000, y: 100 }];
  const { set } = landmarksFor({ ...MANIFEST, sites }, NINE, PLACES);
  assert.deepEqual(set.landmarks.map((l) => l.id), ["abbey-0", "hall-0", "curio-desk"]);
  const hall = byId(set.landmarks, "hall-0")!;
  assert.equal(hall.type, "hall");
  assert.equal(hall.holds.kind, "hall");
  assert.equal(byId(set.landmarks, "town-0"), undefined);
  const desk = byId(set.landmarks, "curio-desk")!;
  assert.deepEqual([desk.x, desk.y], [5000, 100]);
  assert.deepEqual(desk.holds, { kind: "stop", stop: "desk" });
});

test("a places file with a hall puts the hall there, live, over the town", () => {
  const { set } = landmarksFor(MANIFEST, NINE, { ...PLACES, hall: { x: 1400, y: 1750 } });
  assert.deepEqual(set.landmarks.map((l) => l.id), ["abbey-0", "hall-0", "curio-pine", "curio-desk"]);
  const hall = byId(set.landmarks, "hall-0")!;
  assert.deepEqual([hall.type, hall.x, hall.y, hall.live], ["hall", 1400, 1750, true]);
  assert.equal(hall.holds.kind, "hall");
  // A baked hall site still wins over the file's.
  const baked = landmarksFor({ ...MANIFEST, sites: [...SITES, { id: "hall-0", type: "hall", x: 1, y: 2 }] }, NINE, { ...PLACES, hall: { x: 1400, y: 1750 } }).set;
  const h = byId(baked.landmarks, "hall-0")!;
  assert.deepEqual([h.x, h.y, h.live], [1, 2, undefined]);
});

test("a curio site whose id names no stop is left out", () => {
  const sites = [...SITES, { id: "curio-harp", type: "curio", x: 5000, y: 100 }];
  const { set } = landmarksFor({ ...MANIFEST, sites }, NINE, null);
  assert.ok(!set.landmarks.some((l) => l.id === "curio-harp"));
});

test("a world with no abbey and no town still gives what it can", () => {
  const { set } = landmarksFor({ worldId: "w1", n: N, sites: [] }, NINE, PLACES);
  assert.deepEqual(set.landmarks.map((l) => l.id), ["curio-pine", "curio-desk"]);
});

test("the hall keeps the projects in their order, lowest first, ties by name", () => {
  const mixed = [project("z", 2), project("b", 1), project("a", 1)];
  const { set } = landmarksFor(MANIFEST, mixed, PLACES);
  const hall = byId(set.landmarks, "town-0")!;
  if (hall.holds.kind === "hall") assert.deepEqual(hall.holds.projects.map((p) => p.slug), ["a", "b", "z"]);
});

test("a landing is logged by what is kept there", () => {
  const { set } = landmarksFor(MANIFEST, NINE, PLACES);
  assert.deepEqual(discoveryOf(byId(set.landmarks, "abbey-0")!), { id: "landmark:abbey", label: "The abbey: About me" });
  assert.deepEqual(discoveryOf(byId(set.landmarks, "town-0")!), { id: "landmark:hall", label: "The hall: every project" });
  assert.deepEqual(discoveryOf(byId(set.landmarks, "curio-pine")!), { id: "story:pine", label: "The walled garden" });
});

test("every kind of landmark has a name to show", () => {
  assert.equal(kindName("cathedral"), "ruined cathedral");
  assert.equal(kindName("yew"), "churchyard yew");
  assert.equal(kindName("hall"), "hall");
  assert.equal(kindName("curio"), "curio");
  for (const t of ["abbey", "town", "lighthouse", "windmill", "bridge"] as const) assert.equal(kindName(t), t);
});
