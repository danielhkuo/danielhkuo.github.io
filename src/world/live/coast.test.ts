// Things by the coast in motion, frame by frame at 1/30 s: gulls scatter and settle without a jump, whatever the flier
// does (turning, coiling down to land, resting); a boat floats on the water, never under it; and the flier's wake stays
// on the water it was laid on when the flier crosses the shore or slows, fading rather than blinking out.

import assert from "node:assert/strict";
import { test } from "node:test";
import { isWater, MATERIAL as M } from "../look/materials.ts";
import { buildPalette, MIDDAY } from "../render/palette.ts";
import { frameOf, land, manifest, seaFrame, shot } from "../testing/liveShot.ts";
import { ALOFT, lifeLayer, type Placed } from "./life.ts";
import type { Flier, LiveFrame } from "./live.ts";
import { WAKE_LONG, wakeLayer } from "./rare.ts";
import { worldRowAt } from "./sprites.ts";

const ctx = { seed: manifest.seed, n: manifest.n, sites: manifest.sites, land };
const palette = buildPalette(MIDDAY);
const W = 400, H = 225;
const DT = 1 / 30;

/**
 * A flight past the start view's beach and the town's gulls: north along the shore, a coil down onto the beach as a
 * landing makes (turning ever faster as it slows), then at rest on the sand.
 */
function flight(): { t: number; fl: Flier; still: boolean }[] {
  const out: { t: number; fl: Flier; still: boolean }[] = [];
  let x = 5760, y = 3900, heading = -Math.PI / 2, t = 20;
  for (let k = 0; k < 45; k++, t += DT) {
    y -= 60 * DT;
    out.push({ t, fl: { x, y, alt: 20, heading, speed: 60 }, still: false });
  }
  // The coil: round (5770, 3800) from where the run left off, the radius shrinking, slowing from 60 to a crawl.
  const cx = 5770, cy = 3800;
  let phi = Math.atan2(y - cy, x - cx), r = Math.hypot(x - cx, y - cy);
  for (let k = 0; k < 120; k++, t += DT) {
    const u = k / 120;
    const speed = 60 - 57 * u;
    phi -= (speed / r) * DT;
    r = Math.max(8, r - 0.3);
    x = cx + r * Math.cos(phi);
    y = cy + r * Math.sin(phi);
    heading = phi - Math.PI / 2;
    out.push({ t, fl: { x, y, alt: 20 - 15 * u, heading, speed }, still: false });
  }
  for (let k = 0; k < 240; k++, t += DT) out.push({ t, fl: { x, y, alt: 5, heading, speed: 0 }, still: true });
  return out;
}

test("gulls lift, scatter and settle without a jump while the flier turns, coils down to land and rests", async () => {
  const s = await shot("start");
  const life = lifeLayer(ctx);
  const path = flight();
  let last = new Map<string, Placed>();
  const startled = new Set<string>();
  let worst = 0, worstAt = "";
  let stillSince = -1, hanging = 0;
  for (let k = 0; k < path.length; k++) {
    const { t, fl, still } = path[k];
    if (still && stillSince < 0) stillSince = t;
    life.log = [];
    life.draw(frameOf(s, t, fl));
    const now = new Map<string, Placed>();
    for (const p of life.log) {
      if (p.kind !== "gull" && p.kind !== "gull-resting" && p.kind !== "gull-startled") continue;
      const key = (p.kind === "gull" ? "wheel:" : "shore:") + p.id;
      now.set(key, p);
      if (p.kind === "gull-startled") startled.add(key);
      const q = last.get(key);
      if (!q) continue;
      const d = Math.hypot(p.ax - q.ax, p.ay - q.ay);
      if (d > worst) { worst = d; worstAt = `${key} at ${t.toFixed(2)} s: ${q.kind} (${q.ax}, ${q.ay}) → ${p.kind} (${p.ax}, ${p.ay})`; }
    }
    // Long enough at rest, every gull is down again: none hangs in the air over a flier that has stopped.
    if (still && t - stillSince > ALOFT + DT) hanging = Math.max(hanging, life.log.filter((p) => p.kind === "gull-startled").length);
    last = now;
  }
  assert.ok(startled.size >= 3, `the flight puts gulls up on the beach (${startled.size})`);
  // A startled gull is quick off the mark (about 5 pixels a frame at most), but never jumps.
  assert.ok(worst <= 8, `a gull jumped ${worst.toFixed(1)} pixels in a frame: ${worstAt}`);
  assert.equal(hanging, 0, `${hanging} gulls still in the air more than ${ALOFT.toFixed(1)} s after the flier came to rest`);
});

test("a startled gull keeps to its flight when the flier banks away and climbs out of reach", async () => {
  const s = await shot("start");
  const life = lifeLayer(ctx);
  // Low over the beach, north at cruise for two thirds of a second...
  let fl: Flier = { x: 5800, y: 3800, alt: 18, heading: -Math.PI / 2, speed: 60 };
  const step = (turn: number, climb: number): void => {
    fl = { ...fl, heading: fl.heading + turn * DT, alt: fl.alt + climb * DT };
    fl = { ...fl, x: fl.x + 60 * DT * Math.cos(fl.heading), y: fl.y + 60 * DT * Math.sin(fl.heading) };
  };
  let t = 30;
  for (let k = 0; k < 20; k++, t += DT) {
    step(0, 0);
    life.draw(frameOf(s, t, fl));
  }
  life.log = [];
  life.draw(frameOf(s, t, fl));
  let up = new Map(life.log.filter((p) => p.kind === "gull-startled").map((p) => [p.id, p]));
  assert.ok(up.size >= 2, `gulls are up (${up.size})`);
  // ...then banking round as hard as a landing does and climbing as fast as the flier can, well out of their reach:
  // every bird already up flies on as it was, a little at a time, for the second and more its flight has left.
  for (let k = 0; k < 50; k++) {
    t += DT;
    step(3.2, 30);
    life.log = [];
    life.draw(frameOf(s, t, fl));
    const now = new Map(life.log.map((p) => [p.id, p]));
    for (const [id, q] of up) {
      const p = now.get(id);
      if (!p) continue;
      assert.equal(p.kind, "gull-startled", `gull ${id} dropped back to the sand ${(k + 1) * DT} s into the turn`);
      assert.ok(Math.hypot(p.ax - q.ax, p.ay - q.ay) <= 8, `gull ${id} jumped from (${q.ax}, ${q.ay}) to (${p.ax}, ${p.ay})`);
    }
    up = new Map([...up.keys()].filter((id) => now.has(id)).map((id) => [id, now.get(id) as Placed]));
  }
  assert.ok(fl.alt > 60, "the flier has climbed out of reach");
});

/** Open sea round the town, as a boat sees it, with each pixel's depth a little under it as the real bake has it. */
function realSea(rx: number, ry: number, t: number): LiveFrame {
  const f = seaFrame(rx, ry, t, palette, ctx.n, M.sea);
  for (let r = 0; r < H; r++) {
    // The sea's own row of each pixel lies 0.2–0.8 of a pixel under it (the cell whose top the pixel shows).
    const by = ry + r, cy = Math.floor(by / 256), sub = 0.2 + 0.2 * (((by % 4) + 4) % 4);
    const depth = Math.round(((by + sub - 256 * cy) / 0.8) * 8);
    for (let c = 0; c < W; c++) f.bake[r * W + c] = (M.sea | (9 << 8) | (depth << 16)) >>> 0;
  }
  return f;
}

test("a boat floats on the water: its keel shows at every step of its voyage, never under the sea", () => {
  // No ground grid: all is sea, and the boats fan out round the town.
  const life = lifeLayer({ ...ctx, land: undefined });
  const town = manifest.sites.find((site) => site.type === "town");
  assert.ok(town);
  const rx = Math.round(town.x) - 200, ry = Math.round(0.8 * town.y) - 112;
  const keel = palette[(M.timber << 8) | 3];
  let seen = 0, sunk = 0;
  let where = "";
  for (let k = 0; k < 600; k++) {
    const f = realSea(rx, ry, 40 + k * 0.1);
    life.log = [];
    life.draw(f);
    const boats = life.log.filter((p) => p.kind === "boat");
    const others = life.log.filter((p) => p.kind !== "boat");
    for (const b of boats) {
      // Alone: no other boat, and no gull, over its hull.
      if (boats.some((o) => o !== b && Math.abs(o.ax - b.ax) < 12 && Math.abs(o.ay - b.ay) < 10)) continue;
      if (others.some((o) => Math.abs(o.ax - b.ax) < 8 && Math.abs(o.ay - b.ay) < 8)) continue;
      if (b.ax < 4 || b.ax >= W - 4 || b.ay < 6 || b.ay >= H) continue;
      seen++;
      let shown = 0;
      for (let x = b.ax - 2; x <= b.ax + 1; x++) if (f.out[b.ay * W + x] === keel) shown++;
      if (shown < 4) {
        sunk++;
        where ||= `boat ${b.id} at ${(40 + k * 0.1).toFixed(1)} s, (${b.ax}, ${b.ay}): ${shown} of 4`;
      }
    }
  }
  assert.ok(seen > 300, `boats sail in view (${seen} boat-frames)`);
  assert.equal(sunk, 0, `a keel sank under the water in ${sunk} of ${seen} boat-frames, first ${where}`);
});

/**
 * A shore running east–west: low sand north of frame row `shore`, sea south of it, each pixel's depth as the bake has it
 * (sea level, a little under the pixel; the sand 2 units up). Nothing is drawn on it.
 */
function coast(rx: number, ry: number, t: number, shore: number): LiveFrame {
  const f = seaFrame(rx, ry, t, palette, ctx.n, M.sea);
  for (let r = 0; r < H; r++) {
    const by = ry + r, cy = Math.floor(by / 256);
    const sandy = r < shore;
    const depth = Math.round(((by + (sandy ? 2 : 0.5) - 256 * cy) / 0.8) * 8);
    const v = sandy ? (M.sand | (8 << 8)) : (M.sea | (12 << 8));
    for (let c = 0; c < W; c++) {
      f.bake[r * W + c] = (v | (depth << 16)) >>> 0;
      f.out[r * W + c] = palette[v & 0xffff];
    }
  }
  return f;
}

/** The pixels the wake changed: drawn on `f` (fresh each frame), against the land as it was. */
function foamOf(wake: ReturnType<typeof wakeLayer>, f: LiveFrame): number[] {
  const base = new Uint32Array(f.out);
  wake.draw(f);
  const at: number[] = [];
  for (let i = 0; i < base.length; i++) if (f.out[i] !== base[i]) at.push(i);
  return at;
}

test("the wake stays on the water when the flier crosses the shore, and fades rather than blinking out", () => {
  const wake = wakeLayer();
  const rx = 3000, ry = 2000, shore = 90;
  // North at cruise, 10 up, from well out at sea over the beach and on inland.
  const x = rx + 200, shoreRow = (ry + shore) / 0.8;
  const counts: number[] = [];
  let crossed = -1;
  for (let k = 0; k < 75; k++) {
    const y = shoreRow + 70 - 2 * k;
    const f = coast(rx, ry, 5 + k * DT, shore);
    f.flier = { x, y, alt: y < shoreRow ? 20 : 10, heading: -Math.PI / 2, speed: 60 };
    const foam = foamOf(wake, f);
    for (const i of foam) {
      assert.equal(isWater[f.bake[i] & 255], 1, `foam on the sand at ${i % W}, ${Math.floor(i / W)}`);
      // On the water it was laid on: behind the flier along its track, no further back than the wake is long.
      const row = worldRowAt(f, i % W, Math.floor(i / W));
      assert.ok(row > y - 2 && row < y + WAKE_LONG + 4, `foam at row ${row.toFixed(1)}, flier at ${y.toFixed(1)}`);
    }
    counts.push(foam.length);
    if (crossed < 0 && y < shoreRow) crossed = k;
  }
  assert.ok(crossed > 4 && counts[crossed - 4] > 30, `foam behind the flier at sea (${counts[crossed - 4]})`);
  for (let k = 1; k < counts.length; k++) {
    // Never gone in a frame: what was there a frame ago fades, a little at a time.
    assert.ok(counts[k] >= counts[k - 1] * 0.6 - 6, `the wake dropped from ${counts[k - 1]} to ${counts[k]} pixels at frame ${k} (crossed at ${crossed})`);
  }
  // It lies on the water for a while after the flier has gone inland, then it is gone.
  assert.ok(counts[crossed + 6] > 10, `foam still on the water 0.2 s after the flier crossed (${counts[crossed + 6]})`);
  assert.equal(counts[counts.length - 1], 0, "and gone once the flier is far inland");
});

test("the wake fades out behind a flier slowing to a stop on the water, and lies on the water it was laid on", () => {
  const wake = wakeLayer();
  const rx = 3000, ry = 2000;
  let y = (ry + 180) / 0.8, speed = 60;
  const counts: number[] = [];
  for (let k = 0; k < 90; k++) {
    speed = Math.max(0, 60 - 60 * (k / 45));
    y -= speed * DT;
    const f = coast(rx, ry, 5 + k * DT, 0);
    f.flier = { x: rx + 200, y, alt: 10, heading: -Math.PI / 2, speed };
    counts.push(foamOf(wake, f).length);
  }
  for (let k = 1; k < counts.length; k++) {
    assert.ok(counts[k] >= counts[k - 1] * 0.6 - 6, `the wake dropped from ${counts[k - 1]} to ${counts[k]} pixels at frame ${k}`);
  }
  assert.equal(counts[counts.length - 1], 0, "gone a while after the flier has stopped");
});
