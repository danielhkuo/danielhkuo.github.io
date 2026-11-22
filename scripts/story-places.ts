// Candidate places for the quest's five stops in the shipped world: open, level land in each stop's climate, clear of
// the landmarks and wonders. Prints the best few per stop; the choice is made by eye on renders (npm run world:live
// -- --at x,y) and written to src/world/story/places.json.
//
//   node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON scripts/story-places.ts

import { readShipped } from "../src/world/pack/shipped.ts";
import { torusDelta } from "../src/world/core/torus.ts";

const shipped = await readShipped("public/world");
const { manifest, world } = shipped;
const n = manifest.n, gN = world.gN, cN = world.cN;
const g = world.ground, kind = world.waterKind;
const start = manifest.start;
const avoid = [...manifest.sites, ...((manifest.wonders ?? []) as { x: number; y: number }[])];

const gAt = (x: number, y: number) => {
  const gx = ((Math.round(x / 4) % gN) + gN) % gN, gy = ((Math.round(y / 4) % gN) + gN) % gN;
  return gy * gN + gx;
};
const cAt = (x: number, y: number) => {
  const cx = ((Math.round(x / 8) % cN) + cN) % cN, cy = ((Math.round(y / 8) % cN) + cN) % cN;
  return cy * cN + cx;
};
const dist = (ax: number, ay: number, bx: number, by: number) => Math.sqrt(torusDelta(ax, bx, n) ** 2 + torusDelta(ay, by, n) ** 2);

const buildings = (world.built?.built.structures ?? []).filter((b) => !b.onGround).map((b) => ({ x: b.x + b.w / 2, y: b.y + b.h / 2 }));

interface Cand { x: number; y: number; temp: number; arid: number; rough: number; e: number; fromStart: number; clear: number }
const cands: Cand[] = [];
for (let y = 0; y < n; y += 32) for (let x = 0; x < n; x += 32) {
  // A 24-cell pad: every G node in it on land, a few units over the sea, and level.
  let lo = Infinity, hi = -Infinity, wet = false;
  for (let dy = -12; dy <= 12; dy += 4) for (let dx = -12; dx <= 12; dx += 4) {
    const i = gAt(x + dx, y + dy);
    if (kind[i] !== 0 || world.rivers === undefined) wet = wet || kind[i] !== 0;
    lo = Math.min(lo, g[i]);
    hi = Math.max(hi, g[i]);
  }
  if (wet || lo < 3) continue;
  const rough = hi - lo;
  if (rough > 8) continue;
  let clear = Infinity;
  for (const s of avoid) clear = Math.min(clear, dist(x, y, s.x, s.y));
  if (clear < 300) continue;
  // Alone: no house, barn or chapel within 120 cells.
  let lonely = true;
  for (const b of buildings) if (dist(x, y, b.x, b.y) < 120) { lonely = false; break; }
  if (!lonely) continue;
  const c = cAt(x, y);
  cands.push({ x, y, temp: world.temp?.[c] ?? 0.5, arid: world.arid?.[c] ?? 0, rough, e: lo, fromStart: dist(x, y, start.x, start.y), clear });
}
console.log(`${cands.length} level open pads`);
const show = (label: string, pick: (c: Cand) => boolean, by: (c: Cand) => number) => {
  const list = cands.filter(pick);
  list.sort((a, b) => by(a) - by(b));
  console.log(`\n${label}: ${list.length}`);
  for (const c of list.slice(0, 12)) console.log(`  ${c.x},${c.y}  temp ${c.temp.toFixed(2)} arid ${c.arid.toFixed(2)} rough ${c.rough.toFixed(1)} e ${c.e.toFixed(0)} start ${c.fromStart.toFixed(0)} clear ${c.clear.toFixed(0)}`);
};
const CRUISE = 60;
show("pine (temperate, ~15 s from start)", (c) => Math.abs(c.temp - 0.5) < 0.04 && c.arid < 0.2, (c) => Math.abs(c.fromStart - 15 * CRUISE) + c.rough * 40);
show("bell (tundra: cold)", (c) => c.temp > 0.12 && c.temp < 0.3 && c.e > 6, (c) => c.rough * 50 - c.clear / 10);
show("desk (steppe: dry side, cool-mild, like the bridge)", (c) => c.arid > 0.8 && c.temp > 0.4 && c.temp < 0.52, (c) => c.rough * 50 - c.clear / 10);
show("mill (Mediterranean: dry side, warm, like the windmill)", (c) => c.arid > 0.6 && c.temp > 0.55 && c.temp < 0.75 && c.e > 8, (c) => c.rough * 50 - c.clear / 10);
show("basket (savanna: hot)", (c) => c.temp > 0.78 && c.arid > 0.3, (c) => c.rough * 50 - c.clear / 10);
console.log(`\nlandmarks:`, manifest.sites.map((s) => `${s.type} ${s.x},${s.y} temp ${(world.temp?.[cAt(s.x, s.y)] ?? 0).toFixed(2)} arid ${(world.arid?.[cAt(s.x, s.y)] ?? 0).toFixed(2)}`).join("\n  "));

// The hall: a level pad in the start frame (within about 160 cells of the start, ahead of its heading), clear of
// buildings by 30 cells, so it stands beside the town as a building of its own.
{
  const hx = start.x + 90 * start.dx, hy = start.y + 90 * start.dy;
  const list: { x: number; y: number; rough: number; d: number; near: number }[] = [];
  for (let y = start.y - 160; y <= start.y + 160; y += 8) for (let x = start.x - 200; x <= start.x + 200; x += 8) {
    let lo = Infinity, hi = -Infinity, wet = false;
    for (let dy = -12; dy <= 12; dy += 4) for (let dx = -20; dx <= 20; dx += 4) {
      const i = gAt(x + dx, y + dy);
      wet = wet || kind[i] !== 0;
      lo = Math.min(lo, g[i]);
      hi = Math.max(hi, g[i]);
    }
    if (wet || lo < 2 || hi - lo > 4) continue;
    let near = Infinity;
    for (const b of buildings) near = Math.min(near, dist(x, y, b.x, b.y));
    if (near < 30) continue;
    list.push({ x, y, rough: hi - lo, d: dist(x, y, hx, hy), near });
  }
  list.sort((a, b) => a.d + a.rough * 30 - (b.d + b.rough * 30));
  console.log(`\nhall (level, open, ahead of the start ${start.x},${start.y}): ${list.length}`);
  for (const c of list.slice(0, 10)) console.log(`  ${c.x},${c.y}  rough ${c.rough.toFixed(1)} from-ahead ${c.d.toFixed(0)} nearest-building ${c.near.toFixed(0)}`);
}
