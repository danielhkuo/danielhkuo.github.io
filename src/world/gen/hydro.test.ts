import assert from "node:assert/strict";
import { test } from "node:test";
import { type HydroParams, hydrology, rainfall } from "./hydro.ts";

const P: HydroParams = { rainBase: 1, orographic: 0.4, recharge: 0.2, depletion: 0.05, lakeMinNodes: 8, lakeMinDepth: 1.5, qChannel: 64 };

/** Land sloping down to a sea strip along x = 0, with a deep bowl and a shallow dimple. */
function valley(n: number) {
  const h = new Float64Array(n * n), isSea = new Uint8Array(n * n);
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const i = y * n + x;
    if (x < 3) { isSea[i] = 1; h[i] = -2; continue; }
    const fromSea = Math.min(x - 2, n - x + 2);
    h[i] = 0.5 * fromSea + 0.02 * ((x * 7 + y * 13) % 5);
    const bx = x - n / 2, by = y - n / 2, r2 = bx * bx + by * by;
    if (r2 < 25) h[i] -= 6 * (1 - r2 / 25);
    const sx = x - n / 4, sy = y - n / 4;
    if (sx * sx + sy * sy < 2) h[i] -= 0.5;
  }
  return { h, isSea };
}

test("water is conserved: discharge at the sea equals rain on land", () => {
  const n = 48, { h, isSea } = valley(n), r = hydrology(h, n, isSea, P);
  let rainLand = 0, atSea = 0;
  for (let i = 0; i < n * n; i++) {
    if (isSea[i]) atSea += r.q[i];
    else rainLand += r.rain[i];
  }
  assert.ok(Math.abs(atSea - rainLand) <= 1e-9 * rainLand);
});

test("the deep bowl becomes one flat lake with one outlet; the dimple is filled", () => {
  const n = 48, { h, isSea } = valley(n), r = hydrology(h, n, isSea, P);
  assert.equal(r.lakes.length, 1);
  const lake = r.lakes[0];
  const centre = (n / 2) * n + n / 2;
  assert.equal(r.lakeId[centre], lake.id);
  let area = 0;
  for (let i = 0; i < n * n; i++) {
    if (r.lakeId[i] !== lake.id) continue;
    area++;
    assert.equal(r.surface[i], lake.level);
    assert.ok(r.ground[i] < lake.level);
  }
  assert.equal(area, lake.area);
  assert.ok(area >= P.lakeMinNodes);
  assert.equal(r.lakeId[lake.outlet], -1);
  for (let i = 0; i < n * n; i++) if (r.lakeId[i] === lake.id) {
    let j = i, steps = 0;
    while (r.lakeId[j] === lake.id) { j = r.rcv[j]; assert.ok(++steps < n * n); }
    assert.equal(j, lake.outlet);
  }
  const dimple = (n / 4) * n + n / 4;
  assert.equal(r.lakeId[dimple], -1);
  assert.ok(r.ground[dimple] >= h[dimple]);
});

test("no pits remain on the routing surface", () => {
  const n = 48, { h, isSea } = valley(n), r = hydrology(h, n, isSea, P);
  for (let i = 0; i < n * n; i++) {
    if (isSea[i] || r.lakeId[i] >= 0) continue;
    assert.ok(r.surface[r.rcv[i]] < r.surface[i] || isSea[r.rcv[i]] === 1, `node ${i}`);
  }
});

test("rain shadow: the windward (south-west) flank of a ridge is wetter", () => {
  const n = 64, h = new Float64Array(n * n), isSea = new Uint8Array(n * n);
  // A ridge across the wind along x − y ≡ 0, rising to 60, with lowland either side and
  // open sea between ridge repeats, so every wind line crosses sea, lowland and ridge.
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const i = y * n + x, d = Math.abs(((x - y + n + n / 2) % n) - n / 2);
    if (d < 15) h[i] = 60 - 4 * d;
    else if (d < 24) h[i] = 1;
    else { isSea[i] = 1; h[i] = -2; }
  }
  const rain = rainfall(h, n, isSea, P);
  let wind = 0, nw = 0, lee = 0, nl = 0;
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const i = y * n + x, s = ((x - y + n + n / 2) % n) - n / 2;
    if (h[i] < 10 || Math.abs(s) < 1) continue;
    // Wind blows toward +x, −y: x − y grows downwind. Upwind flank: s < 0.
    if (s < 0) { wind += rain[i]; nw++; } else { lee += rain[i]; nl++; }
  }
  assert.ok(nw > 0 && nl > 0);
  assert.ok(wind / nw > 1.2 * (lee / nl), `windward ${wind / nw} lee ${lee / nl}`);
  for (const v of rain) assert.ok(v >= 0 && Number.isFinite(v));
});

test("HAND is ≥ 0 everywhere and 0 on channels, sea and lakes", () => {
  const n = 48, { h, isSea } = valley(n), r = hydrology(h, n, isSea, { ...P, qChannel: 20 });
  let channels = 0;
  for (let i = 0; i < n * n; i++) {
    assert.ok(r.hand[i] >= 0);
    if (r.channel[i] || isSea[i] || r.lakeId[i] >= 0) assert.equal(r.hand[i], 0);
    if (r.channel[i]) { channels++; assert.ok(r.q[i] >= 20); }
  }
  assert.ok(channels > 0);
});

test("deterministic", () => {
  const n = 48, { h, isSea } = valley(n);
  assert.deepEqual(hydrology(h, n, isSea, P), hydrology(h, n, isSea, P));
});
