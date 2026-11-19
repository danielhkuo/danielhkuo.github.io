import assert from "node:assert/strict";
import { test } from "node:test";
import { type Assignments, assignSites, featureFor, type LandmarkType, type Site } from "./assign.ts";

const N = 6400;
const SITES: Site[] = [
  { id: "abbey", type: "abbey", x: 1000, y: 1000 },
  { id: "town", type: "town", x: 1300, y: 1800 },
  { id: "light-a", type: "lighthouse", x: 3000, y: 500 },
  { id: "light-b", type: "lighthouse", x: 5800, y: 5900 },
  { id: "mill-a", type: "windmill", x: 2500, y: 3000 },
  { id: "mill-b", type: "windmill", x: 4200, y: 1500 },
  { id: "bridge-a", type: "bridge", x: 1600, y: 4200 },
  { id: "bridge-b", type: "bridge", x: 4800, y: 4000 },
  { id: "cath-a", type: "cathedral", x: 3500, y: 5200 },
  { id: "cath-b", type: "cathedral", x: 300, y: 2900 },
  { id: "yew-a", type: "yew", x: 5200, y: 2700 },
  { id: "yew-b", type: "yew", x: 2000, y: 6100 },
];
const REPOS = ["alpha", "beta", "gamma", "delta", "epsilon", "zeta"];
const occupied = (a: Assignments) => Object.keys(a.bySite);

test("six projects take six sites; the abbey stays reserved; five features fill the rest", () => {
  const a = assignSites(SITES, REPOS, {}, null, N);
  assert.equal(occupied(a).length, 6);
  assert.ok(!("abbey" in a.bySite));
  assert.deepEqual(Object.values(a.bySite).sort(), [...REPOS].sort());
  assert.equal(Object.keys(a.features).length, 5);
  for (const id of Object.keys(a.features)) assert.ok(!(id in a.bySite) && id !== "abbey");
});

test("config sets a project's type", () => {
  const a = assignSites(SITES, REPOS, { alpha: "lighthouse", beta: "cathedral" }, null, N);
  const siteOf = (r: string) => SITES.find((s) => a.bySite[s.id] === r)!;
  assert.equal(siteOf("alpha").type, "lighthouse");
  assert.equal(siteOf("beta").type, "cathedral");
});

test("assignments are sticky: unpinning frees one site and nothing else moves", () => {
  const a = assignSites(SITES, REPOS, {}, null, N);
  const b = assignSites(SITES, REPOS.filter((r) => r !== "gamma"), {}, a, N);
  for (const [site, repo] of Object.entries(a.bySite)) {
    if (repo === "gamma") assert.ok(!(site in b.bySite));
    else assert.equal(b.bySite[site], repo);
  }
  const c = assignSites(SITES, [...REPOS.filter((r) => r !== "gamma"), "eta"], {}, b, N);
  for (const [site, repo] of Object.entries(b.bySite)) assert.equal(c.bySite[site], repo);
  assert.ok(Object.values(c.bySite).includes("eta"));
});

test("a new project takes the free site of its type farthest from occupied sites (torus distance, abbey included)", () => {
  const sites: Site[] = [
    { id: "abbey", type: "abbey", x: 0, y: 0 },
    { id: "m-near", type: "windmill", x: 300, y: 0 },
    { id: "m-far", type: "windmill", x: 3200, y: 3200 },
    { id: "m-wrap", type: "windmill", x: 6300, y: 6300 },
  ];
  const a = assignSites(sites, ["p"], { p: "windmill" }, null, N);
  assert.deepEqual(a.bySite, { "m-far": "p" });
});

test("a wanted type with no free site falls back to another type with free sites", () => {
  const a = assignSites(SITES, ["p", "q", "r"], { p: "town", q: "town", r: "town" }, null, N);
  assert.equal(occupied(a).length, 3);
  assert.equal(SITES.find((s) => a.bySite[s.id] === "p" || a.bySite[s.id] === "q" || a.bySite[s.id] === "r" && s.type === "town") !== undefined, true);
  assert.equal(Object.values(a.bySite).filter((r) => SITES.find((s) => a.bySite[s.id] === r)!.type === "town").length, 1);
});

test("deterministic, and independent of repo order", () => {
  const a = assignSites(SITES, REPOS, {}, null, N);
  assert.deepEqual(assignSites(SITES, [...REPOS].reverse(), {}, null, N), a);
});

test("features suit their sites", () => {
  assert.equal(featureFor("lighthouse"), "jetty");
  assert.equal(featureFor("town"), "jetty");
  assert.equal(featureFor("bridge"), "jetty");
  assert.equal(featureFor("windmill"), "sheepfold");
  assert.equal(featureFor("yew"), "sheepfold");
  assert.equal(featureFor("cathedral"), "wayside-cross");
  assert.equal(featureFor("chapel"), "jetty");
  assert.equal(featureFor("roundchurch"), "sheepfold");
  for (const t of ["hospice", "stave", "hermitage", "monastery"] as const) assert.equal(featureFor(t), "wayside-cross");
});

test("every kind of landmark has a feature for when it stands free", () => {
  const kinds: LandmarkType[] = [
    "abbey", "town", "lighthouse", "windmill", "bridge", "cathedral", "yew",
    "hospice", "stave", "hermitage", "monastery", "roundchurch", "chapel",
  ];
  for (const t of kinds) assert.ok(["wayside-cross", "sheepfold", "jetty"].includes(featureFor(t)), t);
});

test("more projects than sites: extras are left out, deterministically", () => {
  const many = Array.from({ length: 15 }, (_, i) => `r${i}`);
  const a = assignSites(SITES, many, {}, null, N);
  assert.equal(occupied(a).length, 11);
  assert.deepEqual(assignSites(SITES, many, {}, null, N), a);
});
