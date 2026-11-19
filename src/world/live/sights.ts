// Occasional sights: a skein of birds crossing the sky, a child's kite over the town, a fishing boat shooting its
// net, a shower passing on the wind with a rainbow standing in it for a while.
//
// Each is set by the seed and the clock. The skeins fly straight lines round the world for ever, few enough that one
// crosses a flight every minute or two. The kite, the nets and the rainbows come and go on their own clocks, easing in
// and out so nothing pops.

import { hash2, mix32 } from "../core/hash.ts";
import { pcos, psin } from "../core/psin.ts";
import { MATERIAL as M } from "../look/materials.ts";
import { artSet, blend, frameX, frameY, groundRow, modP, smooth01, stamp } from "./art.ts";
import type { LiveFrame, LiveLayer } from "./live.ts";
import type { LayerContext } from "./registry.ts";
import { bakeAt, drawSprite, worldRowAt } from "./sprites.ts";

// ── Tuning ───────────────────────────────────────────────────────────────────────────────────────────────────────────

/** Skeins in the whole world, the height they fly at and how many birds each has. */
const SKEINS = 22;
const SKEIN_ALT = 150;
const SKEIN_BIRDS = 7;
/** The kite's clock: seconds from one flight to the next, and how long it is up. */
export const KITE_EVERY = 150;
export const KITE_UP = 70;
/** How high the kite flies over the child, in pixels. */
const KITE_HEIGHT = 30;
/** The kite, its string and its tail reach this many pixels right of the child and this many rows above it. */
const KITE_LEAN = 18;
const KITE_RISE = 38;
/** The nets' clock, as the kite's. */
export const NET_EVERY = 120;
export const NET_OUT = 52;
/** Rainbows: one may stand in each tile of this many cells for RAINBOW_STAYS seconds of each RAINBOW_EVERY. */
const RAINBOW_TILE = 1280;
export const RAINBOW_EVERY = 140;
export const RAINBOW_STAYS = 56;
/** Outer radius of the bow in pixels, the width of a band, and its strongest coverage (0–255). */
const BOW = 66;
const BAND = 2;
const BOW_ALPHA = 76;
/**
 * The bow's washes, outside in, as palette colours (material, tone): tile, straw, meadow, the clear sea and the mauve
 * of the flowers. Laid thin, they take the day's light with the land and stay well clear of the dragon's vermilion
 * and gold.
 */
const BANDS: readonly (readonly [number, number])[] = [[M.roofTile, 10], [M.wheat, 8], [M.meadowMid, 9], [M.seaClear, 5], [M.flowerMauve, 5]];
/** Seconds the shower eases in and out over, and the bow: the bow is slower, so it follows the rain. */
const RAIN_EASE = 5;
const BOW_EASE = 16;
/** Pixels a second the shower and its bow drift downwind (east), and how far the rain's middle leads the bow's. */
const RAIN_DRIFT = 1.6;
const RAIN_LEAD = 16;
/** The curtain of rain: half its width and its height in pixels, how many streaks fall in it, and their strongest coverage. */
const RAIN_HALF = 92;
const RAIN_TALL = 100;
const STREAKS = 72;
const RAIN_ALPHA = 128;
/** Pixels a streak leans downwind for each pixel it falls. */
const RAIN_SLANT = 1 / 3;

const TAU = 2 * Math.PI;

const flags = (ids: readonly number[]): Uint8Array => {
  const t = new Uint8Array(256);
  for (const id of ids) t[id] = 1;
  return t;
};
const isSea = flags([M.sea, M.seaClear]);

/** What the layer drew last frame, for tests. */
export interface Sight {
  kind: "skein" | "kite" | "fisher" | "net" | "rainbow";
  px: number;
  py: number;
}

export interface SightsLayer extends LiveLayer {
  log: Sight[] | null;
  /** Where each skein's leader is at time t, in world cells (not wrapped). */
  skeinsAt(t: number): { x: number; y: number }[];
  /** The rainbows standing at time t: world cells, and how fully each shows (0–1). */
  rainbowsAt(t: number): { x: number; y: number; shown: number }[];
}

/** 0–1: how far in a thing is that eases in over `ease` seconds from `at` = 0 and out again before `at` = `stays`. */
function easeInOut(at: number, stays: number, ease: number): number {
  if (at <= 0 || at >= stays) return 0;
  return smooth01(at / ease) * smooth01((stays - at) / ease);
}

/** The occasional sights. `ctx` is the world's seed, size and sites. */
export function sightsLayer(ctx: LayerContext): SightsLayer {
  const seed = ctx.seed;
  const n = ctx.n;
  const art = artSet();
  // Pen-drawn like the gulls: a white stroke with slate under it.
  const quill = { W: [M.whitewash, 14], d: [M.roofSlate, 3, 170] } as const;
  const wingUp = art.add(["W.W", "dWd", ".d."], 1, 1, quill);
  const wingFlat = art.add(["WWW", "ddd"], 1, 0, quill);
  // Two panes, one pale and one teal, as a paper kite is pasted.
  const kite = art.add([
    "..w..",
    ".wwa.",
    "wwwaa",
    ".wwa.",
    ".wwa.",
    "..a..",
  ], 2, 2, { a: [M.sea, 9], w: [M.whitewash, 14] });
  const child = art.add(["k", "b"], 0, 1, { k: [M.stoneDark, 1], b: [M.roofLead, 5] });
  const fisher = art.add([
    "..m...",
    ".cm...",
    "hhhhhh",
    ".kkkk.",
  ], 3, 3, { m: [M.timber, 2], c: [M.whitewash, 11], h: [M.timber, 9], k: [M.timber, 3] });

  // Skeins: a start, a heading and a speed each.
  const skeins = new Float64Array(SKEINS * 4);
  for (let k = 0; k < SKEINS; k++) {
    const h = hash2(k, 3, seed ^ 0x5ce1);
    const ang = ((h & 4095) / 4096) * TAU, speed = 9 + ((h >>> 12) & 7) * 0.5;
    skeins[k * 4] = ((h >>> 15) & 255) / 256 * n;
    skeins[k * 4 + 1] = (mix32(h) & 1023) / 1024 * n;
    skeins[k * 4 + 2] = speed * pcos(ang);
    skeins[k * 4 + 3] = speed * psin(ang);
  }

  const towns: { x: number; y: number; h: number }[] = [];
  for (let s = 0; s < ctx.sites.length; s++) {
    if (ctx.sites[s].type !== "town") continue;
    const h = hash2(s, 5, seed ^ 0x417e);
    // The child stands on the edge of the town, where there is room to run.
    const ang = ((h & 255) / 256) * TAU;
    towns.push({ x: ctx.sites[s].x + 44 * pcos(ang), y: ctx.sites[s].y + 34 * psin(ang), h });
  }

  // The bow, as pixel offsets from the middle of its foot line and the band each is in.
  const bowOff: number[] = [];
  for (let dy = 0; dy <= BOW; dy++) for (let dx = -BOW; dx <= BOW; dx++) {
    const d = Math.sqrt(dx * dx + dy * dy);
    const band = Math.floor((BOW - d) / BAND);
    if (d > BOW || band >= BANDS.length) continue;
    bowOff.push(dx, dy, band);
  }
  const bow = new Int16Array(bowOff);
  const bands = new Uint32Array(BANDS.length);
  let bandsOf: LiveFrame["palette"] | null = null;
  let bandsProbe = 0;

  // The rain: for each streak, how far across the curtain it falls, where in its fall it starts and how fast it falls.
  const rain = new Float32Array(STREAKS * 3);
  for (let k = 0; k < STREAKS; k++) {
    const h = hash2(k, 9, seed ^ 0x7a14);
    rain[k * 3] = ((h & 1023) / 1023 * 2 - 1) * RAIN_HALF;
    rain[k * 3 + 1] = ((h >>> 10) & 1023) / 1024 * RAIN_TALL;
    rain[k * 3 + 2] = 52 + ((h >>> 20) & 15) * 1.5;
  }

  const layer: SightsLayer = {
    name: "sights",
    log: null,
    skeinsAt(t) {
      const at: { x: number; y: number }[] = [];
      for (let k = 0; k < SKEINS; k++) at.push({ x: skeins[k * 4] + skeins[k * 4 + 2] * t, y: skeins[k * 4 + 1] + skeins[k * 4 + 3] * t });
      return at;
    },
    rainbowsAt(t) {
      const at: { x: number; y: number; shown: number }[] = [];
      const tiles = n / RAINBOW_TILE;
      for (let ty = 0; ty < tiles; ty++) for (let tx = 0; tx < tiles; tx++) {
        if (bowIn(tx, ty, t)) at.push({ x: bowAt.x, y: bowAt.y, shown: bowAt.shown });
      }
      return at;
    },
    draw(f: LiveFrame): void {
      art.sync(f.palette);
      rainbows(f);
      fishers(f);
      kites(f);
      skein(f);
    },
  };

  const note = (kind: Sight["kind"], px: number, py: number): void => {
    if (layer.log) layer.log.push({ kind, px, py });
  };

  function skein(f: LiveFrame): void {
    const { t } = f;
    const w = f.rect.w, h = f.rect.h;
    for (let k = 0; k < SKEINS; k++) {
      const vx = skeins[k * 4 + 2], vy = skeins[k * 4 + 3];
      const x = skeins[k * 4] + vx * t, y = skeins[k * 4 + 1] + vy * t;
      const sx = frameX(f, x, 40), sy = frameY(f, 0.8 * y - SKEIN_ALT, 40);
      if (sx >= w + 40 || sy >= h + 40) continue;
      const speed = Math.sqrt(vx * vx + vy * vy);
      const ux = vx / speed, uy = vy / speed;
      note("skein", sx, sy);
      for (let j = 0; j < SKEIN_BIRDS; j++) {
        const rank = (j + 1) >> 1, side = (j & 1) === 0 ? 1 : -1;
        const back = rank * 5.5, across = side * rank * 4.2;
        const bx = x - back * ux - across * uy, by = y - back * uy + across * ux;
        const up = (Math.floor(t * 2.4 + j * 0.37 + k) & 1) === 0;
        drawSprite(f, up ? wingUp : wingFlat, bx, by, SKEIN_ALT, false);
      }
    }
  }

  function kites(f: LiveFrame): void {
    const { out, t, palette } = f;
    const w = f.rect.w, h = f.rect.h;
    for (let s = 0; s < towns.length; s++) {
      const town = towns[s];
      const up = easeInOut((t + (town.h >>> 8) % KITE_EVERY) % KITE_EVERY, KITE_UP, 7);
      if (up === 0) continue;
      // The child, the string, the kite and its tail cover 6 pixels left of the child to KITE_LEAN right, and 6 rows
      // under its feet to KITE_RISE above: a child that far past the frame's edge still puts some of it on the frame,
      // so its ground is looked for there too.
      const px = frameX(f, town.x, KITE_LEAN);
      if (px >= w + 6) continue;
      const gy = groundRow(f, px, town.y, KITE_RISE);
      if (gy === null || gy < -6 || gy - KITE_RISE >= h) continue;
      // The kite leans downwind and wanders on its string.
      const kx = px + Math.round(up * (9 + 4 * psin(t * 0.5) + 1.5 * psin(t * 1.3 + 1)));
      const ky = gy - 2 - Math.round(up * (KITE_HEIGHT + 3 * psin(t * 0.7 + 2)));
      stamp(f, child, px, gy, false);
      // The string: a white thread that sags, with ink along its windward side so it shows on walls and grass alike.
      const line = palette[(M.whitewash << 8) | 15], ink = palette[(M.stoneDark << 8) | 1];
      const rise = gy - 2 - ky;
      for (let j = 1; j < rise - 3; j++) {
        const u = j / rise;
        const lx = px + Math.round((kx - px) * u * u), ly = gy - 2 - j;
        if (ly < 0 || ly >= h || lx < 0 || lx > w) continue;
        if (lx < w) out[ly * w + lx] = line;
        if (lx >= 1) blend(out, ly * w + lx - 1, ink, 150);
      }
      stamp(f, kite, kx, ky, false);
      // A tail of ribbons, swinging.
      const swing = psin(t * 1.9);
      for (let j = 1; j <= 5; j++) {
        const tx = kx - Math.round(j * 0.8 + swing * j * 0.3), ty = ky + 3 + j;
        if (ty >= 0 && ty < h && tx >= 0 && tx < w) out[ty * w + tx] = palette[(j & 1) === 1 ? (M.river << 8) | 8 : (M.whitewash << 8) | 13];
      }
      note("kite", kx, ky);
    }
  }

  /** Fishing boats lying well offshore, one to each 320 × 256 of bake space where that is deep water. */
  function fishers(f: LiveFrame): void {
    const { out, bake, palette, t } = f;
    const w = f.rect.w, h = f.rect.h, rx = f.rect.x, ry = f.rect.y;
    const perX = n / 320, perY = (n * 0.8) / 256;
    // The boat covers 3 pixels either side of its point and 3 rows above; its net lies 23 pixels astern (west) and 5
    // rows either side. Every boat that reaches the frame is placed, by the water past the frame's edge as on it.
    const cx1 = Math.floor((rx + w + 23) / 320), cy1 = Math.floor((ry + h + 5) / 256);
    for (let cy = Math.floor((ry - 5) / 256) - 1; cy <= cy1; cy++) for (let cx = Math.floor((rx - 3) / 320) - 1; cx <= cx1; cx++) {
      const hc = hash2(modP(cx, perX), modP(cy, perY), seed ^ 0xf154);
      const px = cx * 320 + 20 + ((hc >>> 4) % 280) - rx, py = cy * 256 + 20 + ((hc >>> 14) % 216) - ry;
      if (px < -3 || px >= w + 23 || py < -5 || py >= h + 5) continue;
      // Deep water under the boat and where the net will lie.
      let deep = true;
      for (let d = -24; d <= 4 && deep; d += 2) {
        const v = bakeAt(f, px + d, py);
        if (isSea[v & 255] === 0 || ((v >>> 8) & 15) < 6) deep = false;
      }
      if (!deep) continue;
      const row = worldRowAt(f, px, py);
      drawSprite(f, fisher, rx + px, row, 0, false);
      note("fisher", px, py);
      const amount = easeInOut((t + (hc >>> 9) % NET_EVERY) % NET_EVERY, NET_OUT, 10);
      if (amount === 0) continue;
      // The net: a long loop of cork floats paid out astern, its far end still open.
      const floats = Math.round(amount * 19);
      const cork = palette[(M.sailcloth << 8) | 14];
      for (let j = 1; j <= floats; j++) {
        if (j >= 9 && j <= 11) continue;
        const a = (j / 20) * TAU;
        const qx = px - 3 - Math.round(10 - 10 * pcos(a)), qy = py + Math.round(4.6 * psin(a));
        if (qx < 0 || qx >= w || qy < 0 || qy >= h) continue;
        if (isSea[bake[qy * w + qx] & 255] === 1) out[qy * w + qx] = cork;
      }
      note("net", px - 11, py);
    }
  }

  /** The rainbow of tile (tx, ty) at time t, into `bowAt`; false when none stands there then. */
  const bowAt = { x: 0, y: 0, shown: 0, rain: 0, drift: 0 };
  function bowIn(tx: number, ty: number, t: number): boolean {
    const slot = Math.floor(t / RAINBOW_EVERY);
    const tiles = n / RAINBOW_TILE;
    const hc = hash2(modP(tx, tiles) + 64 * modP(ty, tiles), slot, seed ^ 0xa12c);
    if (hc % 5 >= 3) return false;
    const begins = 8 + ((hc >>> 4) % (RAINBOW_EVERY - RAINBOW_STAYS - 16));
    const at = t - slot * RAINBOW_EVERY - begins;
    bowAt.rain = easeInOut(at, RAINBOW_STAYS, RAIN_EASE);
    if (bowAt.rain === 0) return false;
    bowAt.shown = easeInOut(at, RAINBOW_STAYS, BOW_EASE);
    bowAt.drift = RAIN_DRIFT * (at - RAINBOW_STAYS / 2);
    bowAt.x = tx * RAINBOW_TILE + ((hc >>> 10) & 1023) / 1024 * RAINBOW_TILE;
    bowAt.y = ty * RAINBOW_TILE + ((hc >>> 20) & 1023) / 1024 * RAINBOW_TILE;
    return true;
  }

  /** The shower: streaks falling aslant in a curtain whose foot has its middle at frame pixel (mx, by), thinning to its edges. */
  function shower(f: LiveFrame, mx: number, by: number, amount: number): void {
    const { out, t, palette } = f;
    const w = f.rect.w, h = f.rect.h;
    const grey = palette[(M.whitewash << 8) | 2], pale = palette[(M.sea << 8) | 1];
    for (let k = 0; k < STREAKS; k++) {
      const off = rain[k * 3], v = (rain[k * 3 + 1] + t * rain[k * 3 + 2]) % RAIN_TALL;
      const side = 1 - (off * off) / (RAIN_HALF * RAIN_HALF);
      const ends = v < 20 ? v / 20 : v > RAIN_TALL - 20 ? (RAIN_TALL - v) / 20 : 1;
      const a = RAIN_ALPHA * amount * side * ends;
      if (a < 8) continue;
      const x = mx + Math.round(off + RAIN_SLANT * (v - RAIN_TALL / 2)), y = by - RAIN_TALL + Math.floor(v);
      const ink = k % 3 === 0 ? pale : grey;
      const len = 5 + (k & 3);
      for (let j = 0; j < len; j++) {
        const px = x + Math.floor(j * RAIN_SLANT), py = y + j;
        if (px < 0 || px >= w || py < 0 || py >= h) continue;
        // Faint where it starts, strongest at the drop.
        blend(out, py * w + px, ink, Math.round((a * (j + 2)) / (len + 1)));
      }
    }
  }

  function rainbows(f: LiveFrame): void {
    const { out, t, palette } = f;
    const w = f.rect.w, h = f.rect.h;
    const probe = palette[(BANDS[0][0] << 8) | BANDS[0][1]];
    if (palette !== bandsOf || probe !== bandsProbe) {
      bandsOf = palette;
      bandsProbe = probe;
      for (let b = 0; b < BANDS.length; b++) bands[b] = palette[(BANDS[b][0] << 8) | BANDS[b][1]];
    }
    const reach = RAIN_HALF + RAIN_LEAD + RAIN_TALL * RAIN_SLANT;
    const midX = f.rect.x + w / 2, midY = (f.rect.y + h / 2) / 0.8;
    const tx0 = Math.floor(midX / RAINBOW_TILE), ty0 = Math.floor(midY / RAINBOW_TILE);
    for (let ty = ty0 - 1; ty <= ty0 + 1; ty++) for (let tx = tx0 - 1; tx <= tx0 + 1; tx++) {
      if (!bowIn(tx, ty, t)) continue;
      const y = bowAt.y, shown = bowAt.shown;
      // The shower passes on the wind and the bow goes with it.
      const cx = frameX(f, bowAt.x + bowAt.drift, reach), cy = frameY(f, 0.8 * y, RAIN_TALL);
      if (cx >= w + reach || cy >= h + RAIN_TALL) continue;
      shower(f, cx + RAIN_LEAD, cy + 6, bowAt.rain);
      if (shown === 0) continue;
      // The bow stands at row y: land nearer the viewer hides it. y in the frame's own turn of the torus.
      const yy = y + Math.round((midY - y) / n) * n;
      note("rainbow", cx, cy);
      for (let k = 0; k < bow.length; k += 3) {
        const px = cx + bow[k], py = cy - bow[k + 1];
        if (px < 0 || px >= w || py < 0 || py >= h) continue;
        if (worldRowAt(f, px, py) > yy + 1) continue;
        const band = bow[k + 2];
        // Thinner at the feet and at its two edges.
        const foot = bow[k + 1] < 22 ? bow[k + 1] / 22 : 1;
        const edge = band === 0 || band === BANDS.length - 1 ? 0.6 : 1;
        blend(out, py * w + px, bands[band], Math.round(BOW_ALPHA * shown * foot * edge));
      }
    }
  }

  return layer;
}
