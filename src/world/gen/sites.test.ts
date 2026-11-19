import assert from "node:assert/strict";
import { test } from "node:test";
import type { LandmarkType } from "../sites/assign.ts";
import {
  BOX, builtRules, placeSites, seenShare, siteContext, type SiteFields, type SiteReach, siteRules, type SiteRules, SitingError,
} from "./sites.ts";

const N = 1024, GN = N / 4, CN = GN / 2;

interface Shape {
  height: (x: number, y: number) => number;
  exposure?: number;
  wind?: number;
  hand?: (x: number, y: number, h: number) => number;
  beach?: boolean;
  reaches?: SiteReach[];
  stacks?: { x: number; y: number; r: number; top: number }[];
}

/** A hand-built world: ground from a function of the cell, sea wherever it is not above 0. */
function fields(s: Shape): SiteFields {
  const h = new Float64Array(GN * GN), isSea = new Uint8Array(GN * GN), hand = new Float64Array(GN * GN);
  const exposure = new Float32Array(GN * GN).fill(s.exposure ?? 0.5), shoreClass = new Uint8Array(GN * GN);
  for (let gy = 0; gy < GN; gy++) for (let gx = 0; gx < GN; gx++) {
    const i = gy * GN + gx, v = s.height(4 * gx + 2, 4 * gy + 2);
    h[i] = v > 0 ? v : -5;
    isSea[i] = v > 0 ? 0 : 1;
    hand[i] = v > 0 ? (s.hand ? s.hand(4 * gx + 2, 4 * gy + 2, v) : 10) : 0;
  }
  if (s.beach) {
    for (let gy = 0; gy < GN; gy++) for (let gx = 0; gx < GN; gx++) {
      const i = gy * GN + gx;
      if (!isSea[i] && isSea[((gy + 1) % GN) * GN + gx]) shoreClass[i] = 1;
    }
  }
  const regions = new Float32Array(6 * CN * CN);
  regions.fill(1, 0, CN * CN);
  return {
    n: N, gN: GN, h, isSea, lakeId: new Int32Array(GN * GN).fill(-1), hand, exposure, shoreClass,
    debris: new Float32Array(GN * GN), rock: new Uint8Array(GN * GN).fill(1),
    moisture: new Float32Array(CN * CN).fill(0.3), wind: new Float32Array(CN * CN).fill(s.wind ?? 0.8), regions,
    reaches: s.reaches ?? [], stacks: s.stacks ?? [],
  };
}

/** The spec's rules with only the given types wanted, and spacing that suits a small fixture. */
function only(counts: Partial<Record<LandmarkType, number>>, patch: Partial<SiteRules> = {}): SiteRules {
  const r = siteRules(N);
  return { ...r, counts: { abbey: 0, town: 0, lighthouse: 0, bridge: 0, cathedral: 0, windmill: 0, yew: 0, ...counts }, ...patch };
}

/** A reach running south down x from y0 to y1. */
function reachDown(id: number, x: number, y0: number, y1: number, width: number, level: number, endsIn: SiteReach["endsIn"] = "sea", downstream = -1): SiteReach {
  const v: number[] = [];
  for (let y = y0; y <= y1; y += 4) v.push(x, y, width, level);
  return { id, downstream, endsIn, lake: -1, fromLake: -1, vertices: v };
}

function failure(fn: () => unknown): SitingError {
  try {
    fn();
  } catch (e) {
    assert.ok(e instanceof SitingError, String(e));
    return e;
  }
  throw new Error("siting did not fail");
}

const islet = (level: number) => (x: number, y: number) => ((x - 500) * (x - 500) + (y - 500) * (y - 500) <= 24 * 24 ? level : 0);

test("the context knows each river node's way to the sea, through confluences", () => {
  const c = siteContext(fields({
    height: () => 10,
    reaches: [reachDown(0, 402, 100, 300, 2, 5, "reach", 1), reachDown(1, 402, 300, 500, 3, 4)],
  }));
  const at = (y: number) => Math.floor(y / 4) * GN + Math.floor(402 / 4);
  assert.equal(c.rw[at(200)], 2);
  assert.equal(c.rw[at(400)], 3);
  assert.equal(c.mouth[at(200)], 1);
  assert.ok(Math.abs(c.toSea[at(200)] - 300) <= 4, `to sea ${c.toSea[at(200)]}`);
  assert.ok(Math.abs(c.toSea[at(400)] - 100) <= 4);
  assert.equal(c.rlev[at(400)], 4);
});

test("visibility: ground to the south hides a pad and its box in proportion", () => {
  const open = siteContext(fields({ height: () => 10 }));
  assert.deepEqual(seenShare(open, 100, 100, 2, 2, 10, 20), { pad: 1, box: 1 });
  // A wall 40 high, 40 cells south: it stands 40 − 0.8·40 = 8 over a 10-high pad's line of sight… and hides the lower part of the box.
  const walled = siteContext(fields({ height: (_x, y) => (y >= 440 && y < 448 ? 50 : 10) }));
  const s = seenShare(walled, 100, 98, 2, 2, 10, 20);
  assert.ok(s.box > 0.3 && s.box < 0.9, `box ${s.box}`);
  assert.ok(s.pad < 1);
});

test("lighthouse: an exposed islet with a cliff passes; each rule that fails is named", () => {
  const rules = only({ lighthouse: 1 });
  const ok = placeSites(fields({ height: islet(20), exposure: 0.9 }), rules);
  assert.equal(ok.sites.length, 1);
  const s = ok.sites[0];
  assert.equal(s.type, "lighthouse");
  assert.ok(Math.abs(s.x - 500) < 24 && Math.abs(s.y - 500) < 24);
  assert.deepEqual(s.pad, { w: BOX.lighthouse.w, d: BOX.lighthouse.d, round: true });
  assert.match(failure(() => placeSites(fields({ height: islet(20), exposure: 0.2 }), rules)).message, /lighthouse: exposed shore/);
  assert.match(failure(() => placeSites(fields({ height: islet(60), exposure: 0.9 }), rules)).message, /lighthouse: cliff of 12–35/);
  // A straight coast has no 220° of sea.
  assert.match(failure(() => placeSites(fields({ height: (_x, y) => (y < 500 ? 20 : 0), exposure: 0.9 }), rules)).message, /220° of open sea/);
});

test("the height cap and the visibility rule reject a site", () => {
  const tall = only({ lighthouse: 1 }, { lighthouse: { open: 220, exposure: 0.6, cliff: [12, 200], stackTop: 4 } });
  assert.match(failure(() => placeSites(fields({ height: islet(130), exposure: 0.9 }), tall)).message, /height ≤ 152/);
  // A high wall across the south, far enough to leave the sea open round the islet.
  const walled = (x: number, y: number) => (y >= 560 && y < 576 ? 130 : islet(20)(x, y));
  assert.match(failure(() => placeSites(fields({ height: walled, exposure: 0.9 }), only({ lighthouse: 1 }))).message, /visibility ≥ 0.8/);
});

test("a stack with a wide enough top carries a lighthouse with no road", () => {
  const res = placeSites(fields({ height: () => 0, stacks: [{ x: 300, y: 300, r: 8, top: 14 }, { x: 600, y: 600, r: 5, top: 14 }] }), only({ lighthouse: 1 }));
  assert.equal(res.sites.length, 1);
  assert.equal(res.sites[0].stack, true);
  assert.equal(res.sites[0].approach.road, false);
  assert.equal(res.sites[0].x, 300);
});

test("windmill: a windy ridge crest passes; a plain and a calm ridge do not", () => {
  const ridge = (_x: number, y: number) => Math.max(5, 30 - 0.9 * Math.abs(y - 500));
  const ok = placeSites(fields({ height: ridge }), only({ windmill: 1 }));
  assert.equal(ok.sites[0].type, "windmill");
  assert.ok(Math.abs(ok.sites[0].y - 500) <= 6, `y ${ok.sites[0].y}`);
  assert.match(failure(() => placeSites(fields({ height: () => 30 }), only({ windmill: 1 }))).message, /windmill: ridge crest ≥ 8/);
  assert.match(failure(() => placeSites(fields({ height: ridge, wind: 0.4 }), only({ windmill: 1 }))).message, /windmill: wind X ≥ 0.7/);
});

const knoll = (cx: number, cy: number) => (x: number, y: number) => 10 + Math.max(0, 10 - Math.sqrt((x - cx) * (x - cx) + (y - cy) * (y - cy)) / 3);

test("yew: an isolated knoll passes; a plain does not", () => {
  const ok = placeSites(fields({ height: knoll(402, 402) }), only({ yew: 1 }));
  assert.equal(ok.sites[0].type, "yew");
  assert.ok(Math.abs(ok.sites[0].x - 402) <= 4 && Math.abs(ok.sites[0].y - 402) <= 4);
  assert.match(failure(() => placeSites(fields({ height: (x) => 10 + x / 100 }), only({ yew: 1 }))).message, /yew: (knoll|prominence)/);
});

test("spacing: two sites closer than the minimum are refused, and named", () => {
  const two = (x: number, y: number) => Math.max(knoll(302, 402)(x, y), knoll(602, 402)(x, y));
  const far = placeSites(fields({ height: two }), only({ yew: 2 }, { spacing: 250 }));
  assert.equal(far.sites.length, 2);
  assert.ok(Math.abs(far.sites[0].x - far.sites[1].x) >= 250);
  assert.deepEqual(far.sites.map((s) => s.id), ["yew-0", "yew-1"]);
  assert.match(failure(() => placeSites(fields({ height: two }), only({ yew: 2 }, { spacing: 400 }))).message, /yew: minimum spacing of 400 cells/);
  // Lenient siting keeps what fits and reports the rest.
  const lenient = placeSites(fields({ height: two }), only({ yew: 2 }, { spacing: 400 }), { strict: false });
  assert.equal(lenient.sites.length, 1);
  assert.deepEqual(lenient.shortfall, ["yew: minimum spacing of 400 cells"]);
});

/** A valley running north–south: a level floor 80 wide between hills. */
const valley = (x: number) => 6 + Math.min(54, Math.max(0, Math.abs(x - 500) - 40) * 0.5);
const valleyHand = (_x: number, _y: number, h: number) => h - 6;

test("cathedral: a valley floor with a river near and hills on both sides", () => {
  const river = [reachDown(0, 462, 100, 900, 2, 5)];
  const ok = placeSites(fields({ height: valley, hand: valleyHand, reaches: river }), only({ cathedral: 1 }));
  const s = ok.sites[0];
  assert.equal(s.type, "cathedral");
  const away = Math.abs(s.x - 462);
  assert.ok(away >= 30 && away <= 80, `river ${away} away`);
  assert.ok(Math.abs(s.x - 500) <= 40, "on the floor");
  assert.deepEqual(s.pad, { w: 34, d: 16, round: false });
  assert.match(failure(() => placeSites(fields({ height: valley, hand: valleyHand }), only({ cathedral: 1 }))).message, /cathedral: river 30–80 away/);
  assert.match(failure(() => placeSites(fields({ height: () => 6, hand: () => 0, reaches: river }), only({ cathedral: 1 }))).message, /cathedral: hills ≥ 25/);
});

test("bridge: a river of w ≥ 3 between level banks (one class narrower at a pinch), its deck across the flow", () => {
  const ok = placeSites(fields({ height: valley, hand: valleyHand, reaches: [reachDown(0, 500, 100, 900, 3, 5)] }), only({ bridge: 1 }));
  const s = ok.sites[0];
  assert.equal(s.type, "bridge");
  assert.ok(s.span);
  assert.ok(s.span.ax < 500 && s.span.bx > 500 && Math.abs(s.span.ay - s.span.by) < 1e-6);
  assert.equal(s.span.width, 3);
  assert.deepEqual([s.approach.x, s.approach.y], [s.span.ax, s.span.ay]);
  // A river one class narrower stands in where there is no other; a stream does not.
  const narrow = placeSites(fields({ height: valley, hand: valleyHand, reaches: [reachDown(0, 500, 100, 900, 2, 5)] }), only({ bridge: 1 }));
  assert.equal(narrow.sites[0].span?.width, 2);
  assert.match(failure(() => placeSites(fields({ height: valley, hand: valleyHand, reaches: [reachDown(0, 500, 100, 900, 1, 5)] }), only({ bridge: 1 }))).message, /bridge: river of w ≥ 3/);
});

test("bridge: never at a confluence — a tributary joining near every crossing rejects the river, one far off does not", () => {
  // The trunk in twelve reaches, a tributary of w 2 joining at each joint, 68 cells apart: no point is 40 cells from a confluence.
  const side = (id: number, y: number, downstream: number): SiteReach => {
    const v: number[] = [];
    for (let x = 300; x <= 500; x += 4) v.push(x, y, 2, 5);
    return { id, downstream, endsIn: "reach", lake: -1, fromLake: -1, vertices: v };
  };
  const busy: SiteReach[] = [];
  for (let k = 0; k < 12; k++) {
    const y0 = k === 0 ? 100 : 64 + 68 * k, y1 = k === 11 ? 900 : 132 + 68 * k;
    busy.push(reachDown(k, 500, y0, y1, 3, 5, k === 11 ? "sea" : "reach", k + 1));
    if (k < 11) busy.push(side(20 + k, y1, k + 1));
  }
  assert.match(failure(() => placeSites(fields({ height: valley, hand: valleyHand, reaches: busy }), only({ bridge: 1 }))).message, /bridge: a single reach/);
  // One confluence only: the bridge stands, at least 40 cells from it.
  const one = placeSites(fields({ height: valley, hand: valleyHand, reaches: [reachDown(0, 500, 100, 500, 3, 5, "reach", 1), reachDown(1, 500, 500, 900, 3, 5), side(10, 500, 1)] }), only({ bridge: 1 }));
  const s = one.sites[0];
  assert.ok(Math.abs(s.y - 500) >= 40, `bridge at y ${s.y}`);
});

/**
 * An island with a bay in its south shore between two headlands, a hillside rising behind the bay to a
 * plateau, and a river that runs down the west of it into the bay.
 */
function homeIsland(x: number, y: number): number {
  if (x < 200 || x > 800 || y < 200) return 0;
  if (y <= 700) return 0.5 + Math.min(40, (700 - y) * 0.3);
  return y <= 860 && (x <= 260 || x >= 740) ? 3 : 0;
}

test("abbey and town: the abbey's river reaches the town's bay within the home-river range", () => {
  const f = fields({ height: homeIsland, exposure: 0.1, beach: true, reaches: [reachDown(0, 302, 250, 704, 2, 10)] });
  const rules = only({ abbey: 1, town: 1 });
  const res = placeSites(f, rules);
  assert.deepEqual(res.sites.map((s) => s.type), ["abbey", "town"]);
  const [abbey, town] = res.sites;
  assert.ok(town.harbour);
  assert.ok(Math.abs(town.harbour.y - 698) <= 4, "the harbour is on the south shore");
  assert.ok(Math.abs(town.harbour.x - 302) >= 32, "the river enters beside the town");
  assert.ok(abbey.river);
  assert.ok(abbey.river.toBay >= rules.homeRiver[0] && abbey.river.toBay <= rules.homeRiver[1], `to bay ${abbey.river.toBay}`);
  const above = abbey.level - abbey.river.level;
  assert.ok(above >= 25 && above <= 45, `spur ${above}`);
  // The pair is exempt from the spacing rule; nothing else is.
  assert.ok(Math.abs(abbey.x - town.x) + Math.abs(abbey.y - town.y) < rules.spacing * 2);
});

test("the home river is a hard requirement: too short a river rejects the seed, naming it", () => {
  const f = fields({ height: homeIsland, exposure: 0.1, beach: true, reaches: [reachDown(0, 302, 250, 704, 2, 10)] });
  const e = failure(() => placeSites(f, only({ abbey: 1, town: 1 }, { homeRiver: [600, 800] })));
  assert.match(e.message, /river runs 600 channel cells/);
  // A river of w 1 does not count.
  const thin = fields({ height: homeIsland, exposure: 0.1, beach: true, reaches: [reachDown(0, 302, 250, 704, 1, 10)] });
  assert.match(failure(() => placeSites(thin, only({ abbey: 1, town: 1 }))).message, /river runs/);
  // An exposed shore is no place for the town.
  const bare = fields({ height: homeIsland, exposure: 0.8, beach: true, reaches: [reachDown(0, 302, 250, 704, 2, 10)] });
  assert.match(failure(() => placeSites(bare, only({ abbey: 1, town: 1 }))).message, /town: sheltered south-facing shore/);
});

test("the rules: one site of each kind, spacing and the home river scale with the world; the built rules only loosen", () => {
  const r = siteRules(6400), b = builtRules(6400);
  for (const count of Object.values(r.counts)) assert.equal(count, 1);
  assert.equal(r.spacing, 1500);
  assert.deepEqual(r.homeRiver, [1200, 2000]);
  assert.equal(siteRules(3200).spacing, 750);
  assert.equal(b.spacing, r.spacing);
  assert.equal(b.visible, r.visible);
  assert.equal(b.heightCap, r.heightCap);
  assert.ok(b.homeRiver[0] <= r.homeRiver[0] && b.homeRiver[1] === r.homeRiver[1]);
  assert.ok(b.abbey.above[0] <= r.abbey.above[0] && b.town.rise[0] <= r.town.rise[0] && b.lighthouse.open <= r.lighthouse.open);
});

test("siting is deterministic", () => {
  const f = () => fields({ height: (x, y) => Math.max(knoll(302, 402)(x, y), knoll(702, 602)(x, y)) });
  assert.deepEqual(placeSites(f(), only({ yew: 2 }, { spacing: 200 })), placeSites(f(), only({ yew: 2 }, { spacing: 200 })));
});
