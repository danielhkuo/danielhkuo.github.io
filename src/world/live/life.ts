// Small life: sheep on the pastures, gulls resting on the beaches and wheeling over the harbour and the lighthouses,
// boats working out of the town, and smoke from a few chimneys.
//
// Everything is a function of the seed, the place and the clock. Things that stand on the land are placed on a lattice
// in bake space (which is fixed to the world) and drawn only where the bake pixel under them is the right material;
// things in the air and on the sea are placed in world space round the sites. Birds near the flier's track lift and
// scatter, then settle: how far into that flight a bird is depends only on where the flier is and how it is heading.

import { hash2, mix32 } from "../core/hash.ts";
import { pcos, psin } from "../core/psin.ts";
import { MATERIAL as M } from "../look/materials.ts";
import { artSet, blend, frameX, frameY, modP, ringDelta, smooth01 } from "./art.ts";
import type { Flier, LiveFrame, LiveLayer } from "./live.ts";
import type { LayerContext } from "./registry.ts";
import { drawSprite, worldRowAt } from "./sprites.ts";

// ── Tuning ───────────────────────────────────────────────────────────────────────────────────────────────────────────

/** Sheep keep to pasture at least this high over the sea. */
export const UPLAND = 14;
/** A bird takes off when the flier's track passes within this many cells of it, no more than LOW units over it. */
export const REACH = 46;
export const LOW = 60;
/** Seconds a startled bird stays up. */
const ALOFT = 4.4;
/** Boats turn for home this far from the town, and for sea again this near it. */
const BOAT_NEAR = 100;
const BOAT_FAR = 190;
/** Smoke rises only from roofs within this many cells of a town. */
const SMOKE_REACH = 190;
/** Boats to a town, one to each bearing; those whose bearing lies inland are never seen. */
const BOATS = 12;

const TAU = 2 * Math.PI;

const flags = (ids: readonly number[]): Uint8Array => {
  const t = new Uint8Array(256);
  for (const id of ids) t[id] = 1;
  return t;
};
export const isPasture: Uint8Array = flags([M.pastureCool, M.pastureMid, M.pastureWarm]);
export const isBeach: Uint8Array = flags([M.sand, M.sandPale, M.shingle]);
export const isSea: Uint8Array = flags([M.sea, M.seaClear]);
export const isRoof: Uint8Array = flags([M.roofTile, M.roofSlate]);

/** What the layer drew last frame, for tests: the kind and the frame pixel it stands on. */
export interface Placed {
  kind: "sheep" | "gull-resting" | "gull-startled" | "gull" | "boat" | "smoke";
  px: number;
  py: number;
}

export interface LifeLayer extends LiveLayer {
  /** Set to an array to have each frame's placements pushed onto it. */
  log: Placed[] | null;
}

// ── Startling ────────────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * Seconds since the flier's track came within REACH of a bird at world (x, y), `ground` units up; −1 when it has not,
 * the bird has settled again, or the flier is more than LOW over it. The track is the flier's heading held straight,
 * so the answer needs no memory.
 */
export function startledFor(fl: Flier | undefined, n: number, x: number, y: number, ground: number): number {
  if (!fl) return -1;
  const over = fl.alt - ground;
  if (over > LOW || over < -LOW) return -1;
  const dx = ringDelta(fl.x, x, n), dy = ringDelta(fl.y, y, n);
  const hx = pcos(fl.heading), hy = psin(fl.heading);
  const side = dx * hy - dy * hx;
  if (side >= REACH || side <= -REACH) return -1;
  const behind = -(dx * hx + dy * hy);
  const tau = (behind + Math.sqrt(REACH * REACH - side * side)) / (fl.speed < 20 ? 20 : fl.speed);
  return tau < 0 || tau > ALOFT ? -1 : tau;
}

/** Where a startled bird is, relative to where it was: filled by `flee`. */
const fled = { dx: 0, dy: 0, up: 0 };

/** The flight of a bird `tau` seconds after it was startled: out to the side of the flier's track and up, then back. */
function flee(fl: Flier, n: number, x: number, y: number, tau: number, h: number): void {
  const a = smooth01(tau / 0.45) * (1 - smooth01((tau - 2.6) / (ALOFT - 2.6)));
  const hx = pcos(fl.heading), hy = psin(fl.heading);
  const side = ringDelta(fl.x, x, n) * hy - ringDelta(fl.y, y, n) * hx;
  const s = side > 0.5 ? 1 : side < -0.5 ? -1 : (h & 1) === 0 ? 1 : -1;
  const far = 20 + ((h >>> 3) & 15) * 1.4;
  const along = (((h >>> 8) & 31) - 15) / 22;
  const turn = tau * 2.6 + ((h >>> 14) & 63) / 10;
  fled.dx = a * (far * (s * hy + along * hx) + 5 * pcos(turn));
  fled.dy = a * (far * (-s * hx + along * hy) + 5 * psin(turn));
  fled.up = a * (13 + ((h >>> 20) & 15) * 0.8);
}

// ── The layer ────────────────────────────────────────────────────────────────────────────────────────────────────────

interface Wheeler {
  x: number;
  y: number;
  r: number;
  /** Radians a second; the sign is the way round. */
  turn: number;
  phase: number;
  alt: number;
  h: number;
}

interface Boat {
  x: number;
  y: number;
  dx: number;
  dy: number;
  far: number;
  period: number;
  phase: number;
}

/** The small life. `ctx` is the world's seed, size and sites. */
export function lifeLayer(ctx: LayerContext): LifeLayer {
  const seed = ctx.seed;
  const art = artSet();
  const wool: Readonly<Record<string, readonly [number, number, number?]>> = {
    w: [M.whitewash, 12], s: [M.whitewash, 5], k: [M.stoneDark, 1],
  };
  const sheepGraze = art.add(["www.", "sswk"], 1, 1, wool);
  const sheepLook = art.add(["wwwk", "ssw."], 1, 1, wool);
  const feather: Readonly<Record<string, readonly [number, number, number?]>> = {
    W: [M.whitewash, 15], g: [M.stone, 2], d: [M.roofSlate, 4, 150],
  };
  // White strokes with a slate stroke under them, as a pen would draw a bird: they read over pale ground and dark.
  const gullRest = art.add([".W", "gW", "dd"], 0, 1, feather);
  const gullUp = art.add(["W...W", "dWWWd", ".ddd."], 2, 1, feather);
  const gullLevel = art.add(["WWWWW", "ddddd"], 2, 0, feather);
  const gullDown = art.add([".WWW.", "WdddW", "d...d"], 2, 0, feather);
  const flap = [gullUp, gullLevel, gullDown, gullLevel] as const;
  const boatSprite = art.add([
    "..s...",
    "..ss..",
    "..sss.",
    "..m...",
    "hhhhhh",
    ".kkkk.",
  ], 3, 5, { s: [M.sailcloth, 13], m: [M.timber, 2], h: [M.timber, 10], k: [M.timber, 3] });

  const wheelers: Wheeler[] = [];
  const boats: Boat[] = [];
  const towns: { x: number; y: number }[] = [];
  for (let s = 0; s < ctx.sites.length; s++) {
    const site = ctx.sites[s];
    const town = site.type === "town";
    if (!town && site.type !== "lighthouse") continue;
    const count = town ? 9 : 5, spread = town ? 105 : 42;
    for (let k = 0; k < count; k++) {
      const h = hash2(s * 31 + k, 7, seed ^ 0x6a11);
      const ang = ((h & 1023) / 1024) * TAU, out = spread * Math.sqrt(((h >>> 10) & 255) / 255);
      wheelers.push({
        // Town gulls keep to the seaward half of the sky when there is one: south of the roofs.
        x: site.x + out * pcos(ang),
        y: site.y + (town ? 30 : 0) + out * psin(ang),
        r: 10 + ((h >>> 18) & 15),
        turn: (0.26 + ((h >>> 22) & 7) * 0.02) * ((h >>> 25) & 1 ? 1 : -1),
        phase: ((h >>> 26) / 64) * TAU,
        alt: 42 + ((mix32(h) & 15) * 1.5),
        h: mix32(h + 1),
      });
    }
    if (!town) continue;
    towns.push({ x: site.x, y: site.y });
    for (let k = 0; k < BOATS; k++) {
      const h = hash2(s * 31 + k, 11, seed ^ 0x0b0a);
      const ang = ((k + (h & 255) / 256) / BOATS) * TAU;
      boats.push({
        x: site.x, y: site.y, dx: pcos(ang), dy: psin(ang),
        far: BOAT_FAR + ((h >>> 8) & 127),
        period: 150 + ((h >>> 16) & 63),
        phase: ((h >>> 22) & 1023) / 1024,
      });
    }
  }

  const layer: LifeLayer = {
    name: "life",
    log: null,
    draw(f: LiveFrame): void {
      art.sync(f.palette);
      smoke(f);
      sheep(f);
      sail(f);
      shoreGulls(f);
      wheel(f);
    },
  };

  const note = (kind: Placed["kind"], px: number, py: number): void => {
    if (layer.log) layer.log.push({ kind, px, py });
  };

  /** Sheep: flocks of three to five on a 40 × 32 lattice, one cell in four. */
  function sheep(f: LiveFrame): void {
    const { bake, t, n } = f;
    const w = f.rect.w, h = f.rect.h, rx = f.rect.x, ry = f.rect.y;
    const perX = n / 40, perY = (n * 0.8) / 32;
    const cx1 = Math.floor((rx + w) / 40), cy1 = Math.floor((ry + h) / 32);
    for (let cy = Math.floor(ry / 32) - 1; cy <= cy1; cy++) for (let cx = Math.floor(rx / 40) - 1; cx <= cx1; cx++) {
      const hc = hash2(modP(cx, perX), modP(cy, perY), seed ^ 0x5eeb);
      if ((hc & 3) !== 0) continue;
      const fx = cx * 40 + 9 + ((hc >>> 4) % 22), fy = cy * 32 + 7 + ((hc >>> 10) % 18);
      const count = 3 + ((hc >>> 16) % 3);
      for (let k = 0; k < count; k++) {
        const g = mix32(hc + Math.imul(k + 1, 0x9e3779b9));
        const px = fx + (g % 19) - 9 - rx, py = fy + ((g >>> 8) % 13) - 6 - ry;
        if (px < 6 || px >= w - 6 || py < 2 || py >= h) continue;
        const i = py * w + px;
        const v = bake[i];
        if (isPasture[v & 255] === 0 || ((v >>> 8) & 255) >= 64) continue;
        const row = worldRowAt(f, px, py);
        if (0.8 * row - (ry + py) < UPLAND) continue;
        // A slow walk out along the slope and back, with long stops to graze at each end.
        const period = 26 + ((g >>> 12) & 31);
        const ph = (t / period + ((g >>> 20) & 1023) / 1024) % 1;
        const reach = 2 + ((g >>> 5) & 3);
        const dir = (g >>> 3) & 1 ? 1 : -1;
        const want = ph < 0.3 ? 0 : ph < 0.44 ? Math.round((reach * (ph - 0.3)) / 0.14) : ph < 0.8 ? reach : ph < 0.94 ? Math.round(reach * (1 - (ph - 0.8) / 0.14)) : 0;
        let at = 0;
        while (at < want) {
          const u = bake[i + dir * (at + 1)];
          if (isPasture[u & 255] === 0 || ((u >>> 8) & 255) >= 64 || Math.abs((u >>> 16) - (v >>> 16)) > 12) break;
          at++;
        }
        const sx = px + dir * at;
        const going = ph < 0.62 ? dir : -dir;
        // Head up for a moment now and then; down to the grass otherwise.
        const up = ((t / 7 + ((g >>> 14) & 255) / 256) % 1) < 0.16;
        drawSprite(f, up ? sheepLook : sheepGraze, rx + sx, row, 0.8 * row - (ry + py), going < 0);
        note("sheep", sx, py);
      }
    }
  }

  /** Gulls on the beaches: groups of two to five on a 32 × 32 lattice, one cell in three. */
  function shoreGulls(f: LiveFrame): void {
    const { bake, t, n } = f;
    const w = f.rect.w, h = f.rect.h, rx = f.rect.x, ry = f.rect.y;
    const perX = n / 32, perY = (n * 0.8) / 32;
    const cx1 = Math.floor((rx + w) / 32), cy1 = Math.floor((ry + h) / 32);
    for (let cy = Math.floor(ry / 32) - 1; cy <= cy1; cy++) for (let cx = Math.floor(rx / 32) - 1; cx <= cx1; cx++) {
      const hc = hash2(modP(cx, perX), modP(cy, perY), seed ^ 0x9011);
      if (hc % 3 !== 0) continue;
      const fx = cx * 32 + 8 + ((hc >>> 4) % 16), fy = cy * 32 + 8 + ((hc >>> 10) % 16);
      const count = 2 + ((hc >>> 16) & 3);
      for (let k = 0; k < count; k++) {
        const g = mix32(hc + Math.imul(k + 1, 0x9e3779b9));
        const px = fx + (g % 15) - 7 - rx, py = fy + ((g >>> 8) % 9) - 4 - ry;
        if (px < 1 || px >= w - 1 || py < 1 || py >= h) continue;
        const v = bake[py * w + px];
        if (isBeach[v & 255] === 0 || ((v >>> 8) & 255) >= 64) continue;
        const row = worldRowAt(f, px, py);
        const ground = 0.8 * row - (ry + py);
        const tau = startledFor(f.flier, n, rx + px, row, ground);
        if (tau < 0 || !f.flier) {
          drawSprite(f, gullRest, rx + px, row, ground, (g & 16) !== 0);
          note("gull-resting", px, py);
          continue;
        }
        flee(f.flier, n, rx + px, row, tau, g);
        const wing = flap[Math.floor(t * 7 + (g & 3)) & 3];
        drawSprite(f, wing, rx + px + fled.dx, row + fled.dy, ground + fled.up, false);
        note("gull-startled", px, py);
      }
    }
  }

  /** Gulls wheeling round the town and the lighthouses. */
  function wheel(f: LiveFrame): void {
    const { t, n } = f;
    const w = f.rect.w, h = f.rect.h;
    for (let k = 0; k < wheelers.length; k++) {
      const g = wheelers[k];
      const ang = g.phase + g.turn * t;
      let x = g.x + g.r * pcos(ang), y = g.y + g.r * psin(ang);
      let alt = g.alt + 3 * psin(ang * 0.37 + g.phase);
      // Mostly a glide, wings held up a little; a few beats now and then.
      let wing = gullUp;
      const beat = (t * 0.21 + (g.h & 255) / 256) % 1;
      if (beat < 0.22) wing = flap[Math.floor(t * 6) & 3];
      const tau = startledFor(f.flier, n, x, y, alt);
      if (tau >= 0 && f.flier) {
        flee(f.flier, n, x, y, tau, g.h);
        x += fled.dx;
        y += fled.dy;
        alt += fled.up;
        wing = flap[Math.floor(t * 7 + (g.h & 3)) & 3];
      }
      const sx = frameX(f, x, 4), sy = frameY(f, 0.8 * y - alt, 4);
      if (sx >= w + 4 || sy >= h + 4) continue;
      drawSprite(f, wing, x, y, alt, false);
      note("gull", sx, sy);
    }
  }

  /** Boats: each sails out from the town along its own bearing, turns, and comes home. Drawn on open sea only. */
  function sail(f: LiveFrame): void {
    const { out, bake, palette, t } = f;
    const w = f.rect.w, h = f.rect.h;
    for (let k = 0; k < boats.length; k++) {
      const b = boats[k];
      const u = (t / b.period + b.phase) % 1;
      const r = BOAT_NEAR + (b.far - BOAT_NEAR) * (0.5 - 0.5 * pcos(TAU * u));
      const outward = u < 0.5;
      const x = b.x + r * b.dx, y = b.y + r * b.dy;
      const px = frameX(f, x, 8), py = frameY(f, 0.8 * y, 8);
      if (px < 5 || px >= w - 5 || py < 6 || py >= h - 1) continue;
      // Clear water under the whole hull, and not hard against a shore.
      const i = py * w + px;
      let deep = 0, clear = true;
      for (let d = -4; d <= 4; d += 2) {
        const v = bake[i + d];
        if (isSea[v & 255] === 0) { clear = false; break; }
        deep += (v >>> 8) & 15;
      }
      if (!clear || deep < 14) continue;
      // The wake: a few pale pixels astern, on the water's own ramp, breaking up as they fall behind.
      const sign = outward ? 1 : -1;
      const wx = -sign * b.dx, wy = -sign * b.dy * 0.8;
      const crawl = Math.floor(t * 2.5);
      for (let j = 3; j <= 9; j++) {
        if (j > 5 && ((j + crawl) % 3) === 0) continue;
        const qx = px + Math.round(wx * j), qy = py + Math.round(wy * j);
        if (qx < 0 || qx >= w || qy < 0 || qy >= h) continue;
        const q = qy * w + qx;
        const v = bake[q];
        if (isSea[v & 255] === 0 || ((v >>> 8) & 255) >= 64) continue;
        const tone = j <= 5 ? 0 : 2;
        if (((v >>> 8) & 15) > tone) out[q] = palette[((v & 255) << 8) | tone];
      }
      drawSprite(f, boatSprite, x, y, 0, sign * b.dx < 0);
      note("boat", px, py);
    }
  }

  /** Chimney smoke: a thin thread of puffs from the top of one roof in three, leaning downwind as it rises. */
  function smoke(f: LiveFrame): void {
    const { out, bake, palette, t, n } = f;
    if (towns.length === 0) return;
    const w = f.rect.w, h = f.rect.h, rx = f.rect.x, ry = f.rect.y;
    // Only when a town is anywhere near the frame.
    const midX = rx + w / 2, midY = (ry + h / 2) / 0.8;
    let near = false;
    for (let s = 0; s < towns.length; s++) {
      const dx = ringDelta(towns[s].x, midX, n), dy = ringDelta(towns[s].y, midY, n);
      if (dx * dx + dy * dy < 520 * 520) near = true;
    }
    if (!near) return;
    const rgb = palette[(M.whitewash << 8) | 7];
    const perX = n / 20, perY = (n * 0.8) / 16;
    const cx1 = Math.floor((rx + w) / 20), cy1 = Math.floor((ry + h) / 16);
    for (let cy = Math.floor(ry / 16); cy <= cy1; cy++) for (let cx = Math.floor(rx / 20); cx <= cx1; cx++) {
      const hc = hash2(modP(cx, perX), modP(cy, perY), seed ^ 0x50c7);
      if ((hc & 1) !== 0) continue;
      // The first of a few fixed tries in the cell that lands on a roof.
      let px = -1, py = -1;
      for (let k = 0; k < 5; k++) {
        const g = mix32(hc + k);
        const qx = cx * 20 + (g % 20) - rx, qy = cy * 16 + ((g >>> 8) & 15) - ry;
        if (qx < 0 || qx >= w || qy < 12 || qy >= h) continue;
        if (isRoof[bake[qy * w + qx] & 255] === 0) continue;
        px = qx;
        py = qy;
        break;
      }
      if (px < 0) continue;
      // Up to the ridge.
      let climb = 0;
      while (climb < 8 && py > 0 && isRoof[bake[(py - 1) * w + px] & 255] === 1) { py--; climb++; }
      const row = worldRowAt(f, px, py);
      let inTown = false;
      for (let s = 0; s < towns.length; s++) {
        const dx = ringDelta(towns[s].x, rx + px, n), dy = ringDelta(towns[s].y, row, n);
        if (dx * dx + dy * dy < SMOKE_REACH * SMOKE_REACH) inTown = true;
      }
      if (!inTown) continue;
      note("smoke", px, py);
      // The thread: one pixel a row, its bends travelling up it, thinning as it climbs and leans downwind.
      const bend = t * 1.5 + ((hc >>> 16) & 255) / 40;
      const tall = 11 + ((hc >>> 24) & 3);
      for (let j = 1; j <= tall; j++) {
        const qy = py - j;
        if (qy < 0) break;
        const u = j / tall;
        const qx = px + Math.round(5 * u * u + (0.5 + u) * psin(j * 0.7 - bend));
        if (qx < 0 || qx >= w - 1) continue;
        const a = Math.round(235 * (1 - u * 0.65));
        blend(out, qy * w + qx, rgb, a);
        blend(out, qy * w + qx + 1, rgb, u > 0.35 ? a : a >> 1);
      }
    }
  }

  return layer;
}
