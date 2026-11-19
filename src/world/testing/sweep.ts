// A seeded sweep of cover inputs that reaches every rule: shores, floodplains, faces, summits, fields and woods in
// each region. Tests hash what the cover and the scatter make of it, to pin a look bit for bit.

import { rngFor, type Rng } from "../core/rng.ts";
import type { CoverInput } from "../look/contract.ts";

function pick(r: Rng, lo: number, hi: number): number {
  return r.range(lo, hi);
}

/** Region weights: one archetype alone, or two or three blended. */
function regionOf(r: Rng): number[] {
  const w = [0, 0, 0, 0, 0, 0];
  const kind = r.int(4);
  if (kind < 2) {
    w[r.int(6)] = 1;
    return w;
  }
  let sum = 0;
  for (let k = 0; k < kind; k++) {
    const v = 0.1 + r.float();
    w[r.int(6)] += v;
    sum += v;
  }
  return w.map((v) => v / sum);
}

/** The k-th input of the sweep `seed`. Optional fields are present on three inputs in four. */
export function sweepInput(r: Rng, n: number): CoverInput {
  const lie = r.int(6);
  // Six lies of land: shore, floodplain, lowland, hillside, face, summit.
  const e = lie === 0 ? pick(r, 0.05, 5) : lie === 1 ? pick(r, 0.5, 16) : lie === 2 ? pick(r, 1, 40) : lie === 3 ? pick(r, 8, 90) : lie === 4 ? pick(r, 10, 125) : pick(r, 55, 130);
  const slope = lie === 0 ? pick(r, 0, 0.5) : lie === 1 ? pick(r, 0, 0.08) : lie === 2 ? pick(r, 0, 0.35) : lie === 3 ? pick(r, 0.1, 1) : lie === 4 ? pick(r, 0.6, 2.2) : pick(r, 0, 1.4);
  const c: CoverInput = {
    x: r.int(n), y: r.int(n), e, slope,
    northness: pick(r, -1, 1),
    hand: lie === 1 ? pick(r, 0, 2) : lie === 0 ? pick(r, 0, 6) : pick(r, 0, 60),
    moisture: r.float(), wind: r.float(), exposure: r.float(),
    debris: r.int(3) === 0 ? pick(r, 0, 1.5) : 0,
    rock: r.int(2) === 0 ? r.int(3) : pick(r, 0, 2),
    region: regionOf(r),
    water: r.int(12) === 0 ? 1 + r.int(3) : 0,
    shore: lie === 0 ? r.int(7) : r.int(8) === 0 ? r.int(7) : 0,
  };
  if (r.int(4) !== 0) {
    c.westness = pick(r, -1, 1);
    const near = r.int(3) === 0;
    c.riverDx = near ? pick(r, -8, 8) : 0;
    c.riverDy = near ? pick(r, -8, 8) : 0;
    c.riverWide = r.int(2);
    c.cliffAbove = r.int(3) === 0 ? r.float() : 0;
    c.relief = pick(r, -1.5, 1.5);
    c.steep = slope * pick(r, 0.5, 1.3);
    c.form = e + pick(r, -3, 3);
    c.curve = pick(r, -5, 5);
    c.formNorth = pick(r, -1, 1);
  }
  return c;
}

/** `count` inputs of the sweep named by `seed`, on a world of n cells. */
export function sweep(seed: number, count: number, n: number): CoverInput[] {
  const r = rngFor(seed, "cover-sweep");
  const out: CoverInput[] = [];
  for (let k = 0; k < count; k++) out.push(sweepInput(r, n));
  return out;
}
