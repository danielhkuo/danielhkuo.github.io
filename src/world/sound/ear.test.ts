import assert from "node:assert/strict";
import { test } from "node:test";
import { hash2 } from "../core/hash.ts";
import { MATERIAL as M } from "../look/materials.ts";
import { FALL_TONE } from "../bake/chunk.ts";
import { STEEP } from "../live/water.ts";
import { coastEast, coastNorth, coastSouth, coastToward, coastWest, cove, frameOf, gridOf, lakeShore, MEADOW, OPEN_SEA, overlay, riverNS, type FlatWorld } from "./bench/land.ts";
import { createEar, EAR_FALL_TONE, EAR_STEEP, gatherRows, latticeOf, sectorOf, type Ear } from "./ear.ts";
import { HEARING_FLOATS, packHearing, pooledHearing, unpackHearing, type Area, type Hearing, type Pose } from "./types.ts";

const ALT = 30;
const pose = (x: number, y: number, t = 0): Pose => ({ t, dt: 1 / 60, x, y, alt: ALT, heading: 0, speed: 0, bank: 0, rest: 0 });
const WARP = new Uint8Array(65536).map((_, i) => (i * 37) & 255);
const db = (a: number, b: number) => 10 * Math.log10(a / b);
const POSE = pose(5000, 5000);

/** The ear over `world` with the dragon at (x, y): two whole passes (the second knows where the first found shore). */
function hear(world: FlatWorld, x: number, y: number, o: { lanes?: number; land?: boolean; haze?: (px: number, py: number) => boolean; ear?: Ear } = {}): Hearing {
  const ear = o.ear ?? createEar();
  ear.setWorld({ n: world.n, land: o.land === false ? null : gridOf(world) });
  ear.setWarp(WARP);
  // In flight the camera centres alt / 0.8 cells north of the dragon's ground point.
  const seen = frameOf(world, x, y - ALT / 0.8, undefined, o.haze);
  ear.pass(pose(x, y), seen, o.lanes ?? 0);
  return ear.pass(pose(x, y), seen, o.lanes ?? 0);
}

const spread = (a: Area) => 1 - Math.hypot(a.dx, a.dy) / a.e;
const total = (h: Hearing) => h.surf[0].e + h.surf[1].e + h.surf[2].e + h.far.e;

test("a beach to the east: energy in the beach sum, pointing east, hardly spread", () => {
  const h = hear(coastEast(5100, M.sand), 5000, 5000);
  const b = h.surf[0];
  assert.ok(b.e > 0);
  assert.equal(h.surf[1].e, 0);
  assert.equal(h.surf[2].e, 0);
  assert.ok(b.dx > 0 && Math.abs(b.dy) < 0.2 * b.dx);
  assert.ok(spread(b) < 0.25, `spread ${spread(b)}`);
  assert.ok(Math.abs(b.d - 100) < 40, `mean distance ${b.d}`);
  assert.ok(h.ready === 1);
});

test("a cove has shore on every side: its direction sum nearly cancels", () => {
  const h = hear(cove(5000, 5000, 90, M.sand), 5000, 5000);
  assert.ok(spread(h.surf[0]) > 0.85, `spread ${spread(h.surf[0])}`);
  assert.ok(new Set(h.shores.map((s) => s.sector)).size >= 6, "shore points on six sectors or more");
});

test("a straight shore is a line source: its energy halves when its distance doubles", () => {
  // The bake and the grid together (the grid speaks for what runs out of the frame).
  const at = (d: number) => total(hear(coastEast(5000 + d, M.sand), 5000, 5000));
  const near = at(40), far = at(80), further = at(160);
  assert.ok(Math.abs(db(near, far) - 3) < 0.6, `40 → 80 cells: ${db(near, far)} dB`);
  assert.ok(Math.abs(db(far, further) - 3) < 0.6, `80 → 160 cells: ${db(far, further)} dB`);
  // And it is about π · 30² / h.
  assert.ok(Math.abs(db(far, (Math.PI * 900) / Math.hypot(80, ALT))) < 1, `${far} against ${(Math.PI * 900) / 85}`);
});

test("a shore gives the same energy within 0.5 dB running north–south, east–west and on both diagonals", () => {
  const D = 70, r = Math.SQRT1_2;
  const ways: [string, FlatWorld][] = [
    ["land east", coastEast(5000 + D, M.sand)],
    ["land west", coastWest(5000 - D, M.sand)],
    ["land south", coastSouth(5000 + D, M.sand)],
    ["land north", coastNorth(5000 - D, M.sand)],
    ["land south-east", coastToward(5000 + D * r, 5000 + D * r, r, r, M.sand)],
    ["land north-east", coastToward(5000 + D * r, 5000 - D * r, r, -r, M.sand)],
    ["land south-west", coastToward(5000 - D * r, 5000 + D * r, -r, r, M.sand)],
    ["land north-west", coastToward(5000 - D * r, 5000 - D * r, -r, -r, M.sand)],
  ];
  const e = ways.map(([, w]) => total(hear(w, 5000, 5000)));
  const ref = e[0];
  ways.forEach(([name], i) => assert.ok(Math.abs(db(e[i], ref)) < 0.5, `${name}: ${db(e[i], ref).toFixed(2)} dB against land east`));
});

test("shingle is its own kind, rock is rock, a quay and a lake are calm", () => {
  const sh = hear(coastEast(5080, M.shingle), 5000, 5000);
  assert.ok(sh.surf[1].e > 0 && sh.surf[0].e === 0 && sh.surf[2].e === 0);
  assert.ok(sh.shores.length > 0 && sh.shores.every((s) => s.kind === 2));
  const rock = hear(coastEast(5080, M.cliffHard), 5000, 5000);
  assert.ok(rock.surf[2].e > 0 && rock.surf[0].e === 0);
  assert.ok(rock.shores.every((s) => s.kind === 3));
  const quay = hear(coastEast(5080, M.cobble), 5000, 5000, { land: false });
  assert.equal(total(quay), 0, "calm crossings feed no area");
  assert.ok(quay.shores.length > 0 && quay.shores.every((s) => s.kind === 0));
  const lake = hear(lakeShore(5080), 5000, 5000);
  assert.equal(lake.surf[0].e + lake.surf[1].e + lake.surf[2].e, 0);
  assert.ok(lake.shores.length > 0 && lake.shores.every((s) => s.kind === 0), "a lake shore is calm");
  assert.equal(lake.sea, 0);
});

test("shore points: at most two a sector, in the sector they lie in, with the bend water.ts reads there", () => {
  const h = hear(coastEast(5060, M.sand), 5000, 5000);
  assert.ok(h.shores.length >= 4 && h.shores.length <= 16);
  const per = new Map<number, number>();
  for (const s of h.shores) {
    per.set(s.sector, (per.get(s.sector) ?? 0) + 1);
    assert.equal(sectorOf(s.x - 5000, s.y - 5000), s.sector);
    assert.ok(Math.abs(s.x - 5060) <= 3, `on the shore (${s.x})`);
    assert.ok(s.w > 0);
    // The byte at the crossing's bake pixel: bx = x, by = 0.8 · y.
    const bx = Math.round(s.x), by = Math.round(0.8 * s.y);
    assert.equal(s.bend, WARP[(((by >> 1) & 255) << 8) | ((bx >> 1) & 255)]);
  }
  for (const n of per.values()) assert.ok(n <= 2);
  // The heaviest is the nearest stretch, due east.
  const best = [...h.shores].sort((a, b) => b.w - a.w)[0];
  assert.equal(best.sector, 0);
});

test("nothing is fixed to the camera: a pixel's slide of the frame leaves the shore points' cells and the energy alone", () => {
  const world = coastEast(5060, M.sand);
  const a = hear(world, 5000, 5000), b = hear(world, 5001, 5000.6);
  const cells = (h: Hearing) => new Set(h.shores.map((s) => s.cell));
  const shared = [...cells(a)].filter((c) => cells(b).has(c)).length;
  assert.ok(shared >= cells(a).size - 2, `${shared} of ${cells(a).size} cells kept`);
  assert.ok(Math.abs(db(total(a), total(b))) < 0.3);
});

test("the lane window applies only in sectors that hold a lane", () => {
  const world = coastEast(5060, M.sand);
  const none = hear(world, 5000, 5000, { land: false });
  const east = hear(world, 5000, 5000, { land: false, lanes: 1 << 0 });
  const west = hear(world, 5000, 5000, { land: false, lanes: 1 << 4 });
  // The eastern sector holds a quarter of a straight shore's energy (45° of its 180°), and nearly all of that goes.
  const lost = 1 - east.surf[0].e / none.surf[0].e;
  assert.ok(lost > 0.15 && lost < 0.3, `near surf in a lane's sector is left to the wave emitters (${lost})`);
  const all = hear(world, 5000, 5000, { land: false, lanes: 0xff });
  assert.ok(all.surf[0].e < 0.5 * none.surf[0].e, "with lanes all round, most of the near surf is theirs");
  assert.ok(Math.abs(west.surf[0].e - none.surf[0].e) < 1e-9, "a lane elsewhere changes nothing");
  assert.equal(east.lanes, 1);
  // The shore points do not shrink: lanes are chosen on the unwindowed weight.
  assert.deepEqual(east.shores.map((s) => s.w), none.shores.map((s) => s.w));
});

test("open sea is open; a coast is not; meadows hear nothing", () => {
  assert.ok(hear(OPEN_SEA, 5000, 5000).sea > 0.99);
  assert.equal(total(hear(OPEN_SEA, 5000, 5000)), 0);
  const coast = hear(coastEast(5060, M.sand), 5000, 5000);
  assert.ok(coast.sea > 0.3 && coast.sea < 0.7, `sea share ${coast.sea}`);
  const inland = hear(MEADOW, 5000, 5000);
  assert.equal(inland.sea, 0);
  assert.equal(total(inland), 0);
  assert.equal(inland.shores.length, 0);
});

test("a pass is the same whatever the frame rate that sliced it", () => {
  const world = cove(5010, 4990, 120, M.shingle);
  const whole = hear(world, 5000, 5000);
  for (const fps of [30, 60, 144]) {
    const ear = createEar();
    ear.setWorld({ n: world.n, land: gridOf(world) });
    ear.setWarp(WARP);
    const seen = frameOf(world, 5000, 5000 - ALT / 0.8);
    let h: Hearing | null = null, published = 0, last: Hearing | null = null;
    for (let k = 0; k <= fps; k++) {
      h = ear.step(pose(5000, 5000, 10 + k / fps), seen, 0);
      if (h !== last) published++;
      last = h;
    }
    assert.ok(published >= 5, `${published} passes at ${fps} fps`);
    assert.ok(Math.abs(db(total(h!), total(whole))) < 0.05, `${fps} fps: ${db(total(h!), total(whole))} dB`);
    assert.deepEqual(h!.shores.map((s) => s.cell).sort(), whole.shores.map((s) => s.cell).sort());
    assert.ok(Math.abs(h!.sea - whole.sea) < 0.01);
  }
});

test("coast scan: a coast and its mirror image give the same energy within 0.5 dB", () => {
  // Beyond the frame (300 cells off), where only the grid speaks.
  const far = (w: FlatWorld) => hear(w, 5000, 5000).far;
  const east = far(coastEast(5300, M.sand)), west = far(coastWest(4700, M.sand));
  const south = far(coastSouth(5300, M.sand)), north = far(coastNorth(4700, M.sand));
  assert.ok(east.e > 0);
  assert.ok(Math.abs(db(east.e, west.e)) < 0.5, `east against west ${db(east.e, west.e)}`);
  assert.ok(Math.abs(db(south.e, north.e)) < 0.5, `south against north ${db(south.e, north.e)}`);
  assert.ok(Math.abs(db(east.e, south.e)) < 0.5, `east against south ${db(east.e, south.e)}`);
  assert.ok(east.dx > 0 && west.dx < 0 && south.dy > 0 && north.dy < 0);
  assert.ok(Math.abs(east.d - 300) < 60);
});

test("hand-over: with no haze, a fifth, all of it, or one patch of it, the bake and the grid total the same within 1 dB", () => {
  const world = coastEast(5070, M.sand);
  const clear = total(hear(world, 5000, 5000));
  const cases: [string, (px: number, py: number) => boolean][] = [
    // Haze comes in unbaked blocks: here, one tile in five of 40 × 45 pixels.
    ["a fifth", (px, py) => hash2(Math.floor(px / 40), Math.floor(py / 45), 4) % 5 === 0],
    ["all", () => true],
    ["one patch over the shore", (px, py) => px > 240 && px < 300 && py > 60 && py < 160],
  ];
  for (const [name, haze] of cases) {
    const got = total(hear(world, 5000, 5000, { haze }));
    assert.ok(Math.abs(db(got, clear)) < 1, `${name}: ${db(got, clear).toFixed(2)} dB`);
  }
  // With no grid at all the frame alone still hears its own shore.
  assert.ok(hear(world, 5000, 5000, { land: false }).surf[0].e > 0.5 * clear);
});

test("a frame gathered to its lattice a few rows at a time, the camera moving meanwhile, is heard as the whole frame is", async () => {
  const { gatherRows, latticeOf } = await import("./ear.ts");
  const world = cove(5010, 4990, 120, M.shingle);
  const home = frameOf(world, 5000, 5000 - ALT / 0.8);
  const lat = latticeOf(home.rect);
  const packed = new Uint32Array(lat.cols * lat.rows);
  // Six slices; the camera slides east and south by a pixel or two between them.
  for (let k = 0; k < 6; k++) {
    const now = frameOf(world, 5000 + 1.4 * k, 5000 - ALT / 0.8 + 1.9 * k);
    gatherRows(packed, home.rect, now.bake, now.rect, Math.floor((k * lat.rows) / 6), Math.floor(((k + 1) * lat.rows) / 6));
  }
  const hearWith = (seen: Parameters<Ear["pass"]>[1]) => {
    const ear = createEar();
    ear.setWorld({ n: world.n, land: gridOf(world) });
    ear.setWarp(WARP);
    ear.pass(pose(5000, 5000), seen, 0);
    return ear.pass(pose(5000, 5000), seen, 0);
  };
  const whole = hearWith(home), fromLattice = hearWith({ bake: packed, rect: home.rect, t: 0, packed: true });
  assert.ok(Math.abs(db(total(fromLattice), total(whole))) < 0.2, `${db(total(fromLattice), total(whole))} dB`);
  assert.deepEqual(fromLattice.shores.map((s) => s.cell).sort(), whole.shores.map((s) => s.cell).sort());
  assert.ok(Math.abs(fromLattice.sea - whole.sea) < 0.02);
});

test("rows copied a few at a time as the camera moves, then gathered, give the lattice the gather gives", async () => {
  const { copyRows, gatherRows, latticeOf } = await import("./ear.ts");
  // A shore with a stream running into it, so the look east and below (thin water) is exercised.
  const world = overlay(cove(5010, 4990, 120, M.shingle), riverNS(4987, 1, 10));
  for (const [ox, oy] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
    const home = frameOf(world, 5000 + ox, 5000 - ALT / 0.8 + oy);
    const lat = latticeOf(home.rect);
    const gathered = new Uint32Array(lat.cols * lat.rows);
    const copy = new Uint32Array(home.rect.w * home.rect.h).fill(0xdeadbeef);
    // Seven slices; the camera slides east and south (then back) by a pixel or three between them.
    for (let k = 0; k < 7; k++) {
      const now = frameOf(world, 5000 + ox + 1.4 * k - (k > 4 ? 6 : 0), 5000 - ALT / 0.8 + oy + 1.9 * k);
      const r0 = Math.floor((k * lat.rows) / 7), r1 = Math.floor(((k + 1) * lat.rows) / 7);
      gatherRows(gathered, home.rect, now.bake, now.rect, r0, r1);
      copyRows(copy, home.rect, now.bake, now.rect, r0, r1);
    }
    const fromCopy = new Uint32Array(lat.cols * lat.rows);
    gatherRows(fromCopy, home.rect, copy, home.rect, 0, lat.rows);
    let differ = 0, rivers = 0;
    for (let r = 0; r < lat.rows - 1; r++) {
      for (let c = 0; c < lat.cols - 1; c++) {
        if (fromCopy[r * lat.cols + c] !== gathered[r * lat.cols + c]) differ++;
        if ((gathered[r * lat.cols + c] & 255) === M.river) rivers++;
      }
    }
    assert.equal(differ, 0, `offset ${ox},${oy}: ${differ} samples differ`);
    assert.ok(rivers > 0, "the stream was in the lattice");
  }
});

test("the ear's river constants are the picture's own", () => {
  assert.equal(EAR_FALL_TONE, FALL_TONE);
  assert.equal(EAR_STEEP, STEEP);
});

test("fresh water by class: a wide river, a stream, white water where it falls; each on its side", () => {
  const hear = (world: FlatWorld) => {
    const ear = createEar();
    ear.setWorld({ n: world.n, land: null });
    return ear.pass(POSE, frameOf(world, POSE.x, POSE.y - POSE.alt / 0.8), 0);
  };
  const river = hear(riverNS(POSE.x + 20, 6, 4));
  assert.ok(river.river.e > 0 && river.stream.e === 0 && river.white.e === 0);
  assert.ok(river.river.dx > 0, "to the east");
  assert.equal(river.falls.length, 0);
  const stream = hear(riverNS(POSE.x - 25.5, 2, 10));
  assert.ok(stream.stream.e > 0 && stream.river.e === 0 && stream.stream.dx < 0);
  // Energy falls with distance: the same river twice as far is quieter.
  assert.ok(hear(riverNS(POSE.x + 80, 6, 4)).river.e < 0.5 * river.river.e);
  // Tones 12–13 are a stream unless they lie beside falling water.
  const pale = hear(riverNS(POSE.x + 20, 4, 12));
  assert.ok(pale.stream.e > 0 && pale.white.e === 0);
});

test("falls: one report a fall, its foot's place, its run in rows; small and tall; the heaviest four", () => {
  const ear = createEar();
  const hear = (world: FlatWorld) => {
    ear.setWorld({ n: world.n, land: null });
    return ear.pass(POSE, frameOf(world, POSE.x, POSE.y - POSE.alt / 0.8), 0);
  };
  const small = hear(riverNS(POSE.x + 20, 4, 4, [{ y: POSE.y - 5, run: 4 }]));
  assert.equal(small.falls.length, 1);
  assert.ok(small.white.e > 0, "falling water is white water too");
  assert.ok(Math.abs(small.falls[0].x - (POSE.x + 20)) <= 2 && Math.abs(small.falls[0].y - POSE.y) <= 3, `foot at ${small.falls[0].x}, ${small.falls[0].y}`);
  assert.ok(small.falls[0].run >= 4 && small.falls[0].run <= 6);
  assert.equal(small.falls[0].edge, 1);
  assert.ok(Math.abs(small.falls[0].h) < 0.5, "at sea level in the flat world");
  const tall = hear(riverNS(POSE.x + 30, 4, 4, [{ y: POSE.y - 22.5, run: 18 }]));
  assert.equal(tall.falls.length, 1);
  assert.ok(tall.falls[0].run >= 18 && tall.falls[0].run <= 20, `run ${tall.falls[0].run}`);
  assert.ok(tall.falls[0].w > small.falls[0].w);
  // Two falls on one river, well apart, are two; six in the frame are reported as the heaviest four, heaviest first.
  const two = hear(riverNS(POSE.x + 20, 4, 4, [{ y: POSE.y - 60, run: 4 }, { y: POSE.y + 20, run: 4 }]));
  assert.equal(two.falls.length, 2);
  let many: FlatWorld = riverNS(POSE.x - 150, 4, 4, [{ y: POSE.y - 40, run: 6 }]);
  for (let k = 1; k < 6; k++) many = overlay(many, riverNS(POSE.x - 150 + 50 * k, 4, 4, [{ y: POSE.y - 40, run: 6 }]));
  const most = hear(many).falls;
  assert.equal(most.length, 4);
  for (let i = 1; i < 4; i++) assert.ok(most[i].w <= most[i - 1].w);
  // A Hearing survives packing with its falls.
  const packed = new Float64Array(HEARING_FLOATS);
  packHearing(tall, packed);
  const back = unpackHearing(packed, pooledHearing());
  assert.deepEqual(back.falls, tall.falls);
  assert.deepEqual(back.river, tall.river);
});

test("a stream one pixel wide is heard the same on an even column as on an odd one, and a thin fall is found on either", () => {
  const hear1 = (world: FlatWorld) => {
    const ear = createEar();
    ear.setWorld({ n: world.n, land: null });
    return ear.pass(POSE, frameOf(world, POSE.x, POSE.y - POSE.alt / 0.8), 0);
  };
  for (const side of [20, -40, 90]) {
    const even = hear1(riverNS(POSE.x + side, 1, 10)), odd = hear1(riverNS(POSE.x + side + 1, 1, 10));
    assert.ok(even.stream.e > 0 && odd.stream.e > 0, "both are heard");
    assert.ok(Math.abs(db(even.stream.e, odd.stream.e)) < 1, `${side}: even against odd ${db(even.stream.e, odd.stream.e).toFixed(2)} dB`);
  }
  // The same through the page's own path: the lattice gathered a few rows at a time, then heard packed.
  const packedE = (x: number) => {
    const world = riverNS(x, 1, 10);
    const seen = frameOf(world, POSE.x, POSE.y - POSE.alt / 0.8);
    const lat = latticeOf(seen.rect);
    const into = new Uint32Array(lat.cols * lat.rows);
    for (let r = 0; r < lat.rows; r += 7) gatherRows(into, seen.rect, seen.bake, seen.rect, r, Math.min(lat.rows, r + 7));
    const ear = createEar();
    ear.setWorld({ n: world.n, land: null });
    return ear.pass(POSE, { bake: into, rect: seen.rect, t: 0, packed: true }, 0).stream.e;
  };
  assert.ok(Math.abs(db(packedE(POSE.x + 20), packedE(POSE.x + 21))) < 1);
  // A fall one pixel wide on an odd column is still a fall, with its foot in the right place.
  const thin = hear1(riverNS(POSE.x + 21, 1, 4, [{ y: POSE.y - 10, run: 8 }]));
  assert.equal(thin.falls.length, 1);
  assert.ok(Math.abs(thin.falls[0].x - (POSE.x + 21)) <= 1 && thin.falls[0].run >= 8 && thin.falls[0].run <= 10);
  // A wide river is not made wider by more than its edge: within 1.5 dB of what the bare lattice gave it.
  const wide = hear1(riverNS(POSE.x + 20, 6, 4)), wide1 = hear1(riverNS(POSE.x + 21, 6, 4));
  assert.ok(Math.abs(db(wide.river.e, wide1.river.e)) < 1.5);
});
