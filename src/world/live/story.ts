// The quest's five things (spec: 2026-11-19-story-destinations-design.md, section 4): a very small pine under a very
// large yew, a novelist's desk in a hay field, a bell on a bare hill with a wooden striker, a mill-shed that does too
// many jobs, and a peach basket on a dead oak. Each stands on its place with a little life of its own, flies a
// vermilion pennant until it is found, and plays its short piece once, the moment it is found. Drawn from the palette
// (so each takes the day's light with the land), save the pennant and the bell, which are the dragon's lacquer.

import type { Look } from "../dragon/look.ts";
import { lookIn } from "../dragon/index.ts";
import { MATERIAL as M } from "../look/materials.ts";
import type { Palette } from "../look/contract.ts";
import { NOON_AIR, type Air } from "../sky/air.ts";
import type { StopKey } from "../story/stops.ts";
import { frameX, groundRow, type Ink } from "./art.ts";
import type { LiveFrame, LiveLayer } from "./live.ts";
import { drawSprite, type LiveSprite } from "./sprites.ts";

/** Where a stop stands, world cells. */
export interface StoryPlace {
  key: StopKey;
  x: number;
  y: number;
}

export interface StoryContext {
  stops: readonly StoryPlace[];
  /** The stops found so far, read each frame (`t` is the frame's seconds). */
  found(t: number): readonly StopKey[];
}

/** How long a stop's piece plays once it is found, seconds. */
export const PIECE = 4.5;
/** A stop is drawn while its place is within this many pixels of the frame. */
const REACH = 40;

type LookKey = keyof Look;
type Key = Readonly<Record<string, Ink | LookKey>>;

interface Painted {
  sprite: LiveSprite;
  /** Per pixel: palette index (≥ 0), a lacquer colour (−2 − its number), or −1 for clear. */
  index: Int32Array;
}

const LOOK_KEYS: readonly LookKey[] = ["bodyLight", "body", "bodyDark", "scale", "belly", "bellyDark", "mane", "maneLight", "maneDark", "tip", "wing", "wingDark", "ink"];

/** Sprites coloured from the palette, or from the dragon's lacquer in this air. */
function paintSet() {
  const all: Painted[] = [];
  let lastPalette: Palette | null = null;
  let lastAir: Air | null = null;
  return {
    add(rows: readonly string[], ax: number, ay: number, key: Key): LiveSprite {
      const h = rows.length, w = rows[0].length;
      const sprite: LiveSprite = { w, h, rgba: new Uint32Array(w * h), alpha: new Uint8Array(w * h), ax, ay };
      const index = new Int32Array(w * h).fill(-1);
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const c = rows[y][x];
        if (c === ".") continue;
        const ink = key[c];
        if (ink === undefined) throw new Error(`no ink for '${c}'`);
        if (typeof ink === "string") {
          index[y * w + x] = -2 - LOOK_KEYS.indexOf(ink);
          sprite.alpha[y * w + x] = 255;
        } else {
          index[y * w + x] = (ink[0] << 8) | ink[1];
          sprite.alpha[y * w + x] = ink[2] ?? 255;
        }
      }
      all.push({ sprite, index });
      lastPalette = null;
      return sprite;
    },
    sync(palette: Palette, air: Air): void {
      if (palette === lastPalette && air === lastAir) return;
      lastPalette = palette;
      lastAir = air;
      const look = lookIn(air);
      for (const { sprite, index } of all) {
        for (let i = 0; i < index.length; i++) {
          const v = index[i];
          if (v >= 0) sprite.rgba[i] = palette[v];
          else if (v <= -2) sprite.rgba[i] = look[LOOK_KEYS[-2 - v]];
        }
      }
    },
  };
}

/** Frame `k` of `n`, cycling every `period` seconds. */
function cycle(t: number, period: number, n: number): number {
  const p = ((t % period) + period) % period;
  return Math.min(n - 1, Math.floor((p / period) * n));
}

export interface StoryLayer extends LiveLayer {
  /** For the frame-strip tool: when each stop was found, in the frame's seconds (NaN: found before this visit). */
  foundAt: Map<StopKey, number>;
}

export function storyLayer(ctx: StoryContext): StoryLayer {
  const paint = paintSet();

  // The inks. Wood and bark from timber; the yew's own dark green; paper and shirts in whitewash and plaster.
  const yewInk = { Y: [M.yew, 3], y: [M.yew, 6], u: [M.yew, 9], b: [M.timber, 3], B: [M.timber, 6] } as const;
  const pineInk = { p: [M.hedge, 9], P: [M.hedge, 5], t: [M.timber, 5], o: [M.roofTile, 8], O: [M.roofTile, 5], s: [M.stone, 12], S: [M.stone, 8] } as const;

  // 1. The small pine under the very large yew. The yew is the landmark; the pine, in its pot on a flat stone, is the
  // thing. Shears lie by it; once found they cut one needle and a cone drops.
  const yew = paint.add([
    "..........yyyyy.........",
    ".......yyyuuyyyyyy......",
    ".....yyuuuyyyyYyyyyy....",
    "...yyyuuyyyyyYYyyuuyyy..",
    "..yyuuyyyyYYYyyyuuuyyyy.",
    ".yyyyyyyYYYyyyyyyyyYyyy.",
    "yyuuyyyYYyyyuuuyyyYYYyyy",
    "yuuuyyYYyyyuuuyyyyYYyyyy",
    "yyyyyYYyyyyyyyyyYYYyyuuy",
    ".yyYYYyyyuuuyyyYYyyyuuy.",
    ".yYYyyyyuuuyyyYYYyyyyyy.",
    "..yyyyYYyyyyYYYyyyYYyy..",
    "...yYYYyyyyYYyyyYYYyy...",
    ".....YYYyBbYYYYYyy......",
    "........bBBbb...........",
    "........bBBb............",
    "........bBBb............",
    ".......bbBBbb...........",
    "......bb.BB.bb..........",
  ], 9, 18, yewInk);
  const pineRest = paint.add([
    "..P...",
    ".pPp..",
    "pPpPp.",
    "..t...",
    ".oOo..",
    "sSSSSs",
  ], 2, 5, pineInk);
  const shears = paint.add(["x.x", ".x.", "x.x"], 1, 1, { x: [M.roofLead, 3] });
  const shearsOpen = paint.add(["x...x", ".x.x.", "..x.."], 2, 1, { x: [M.roofLead, 3] });
  const cone = paint.add(["c", "C"], 0, 1, { c: [M.timber, 7], C: [M.timber, 4] });

  // 2. The novelist at her desk in a hay field, a cart at the gate. She writes; once found she turns a page and a
  // page flies up.
  const deskInk = {
    d: [M.timber, 6], D: [M.timber, 3], w: [M.whitewash, 15], h: [M.timber, 2], f: [M.plaster, 11], c: [M.copper, 8],
    r: [M.roofTile, 7], k: [M.roofSlate, 5], g: [M.wheat, 10], G: [M.wheat, 6],
  } as const;
  const deskA = paint.add([
    "...hh.....",
    "...hf...k.",
    "..cccw.rk.",
    "..ccwwwrkg",
    "dddddddddd",
    "d.D....D.d",
    "d.......Dd",
  ], 5, 6, deskInk);
  const deskB = paint.add([
    "...hh.....",
    "...hf...k.",
    "..cccww.rk",
    "..cc.wwrkg",
    "dddddddddd",
    "d.D....D.d",
    "d.......Dd",
  ], 5, 6, deskInk);
  const page = paint.add(["ww", "w."], 1, 1, { w: [M.whitewash, 15] });
  const cart = paint.add([
    "GgggggG.",
    "Gg.gg.gG",
    "dddddddd",
    ".DD..DD.",
  ], 4, 3, deskInk);

  // 3. The bell on a bare hill, hung in a wooden frame, and a wooden figure with a hammer. Once found the figure
  // strikes it, and it swings.
  const bellInk = {
    t: [M.timber, 6], T: [M.timber, 3], w: [M.timber, 9], W: [M.timber, 5], h: [M.roofLead, 3],
    g: "belly", G: "bellyDark", L: "maneLight",
  } as const;
  const frame = paint.add([
    "tttttttttt",
    "T.......T.",
    "T.......T.",
    "T.......T.",
    "T.......T.",
    "T.......T.",
    "T.......T.",
    "T.......T.",
    "T.......T.",
    "TT.....TT.",
  ], 5, 9, bellInk);
  const bellStill = paint.add(["..T..", ".LgG.", ".ggG.", "gggGG", "..h.."], 2, 0, bellInk);
  const bellLeft = paint.add(["..T..", ".LgG.", "LggG.", "gggG.", ".h..."], 2, 0, bellInk);
  const bellRight = paint.add(["..T..", ".LgG.", ".ggGG", ".ggGG", "...h."], 2, 0, bellInk);
  const figureRest = paint.add([
    ".w..",
    "wWw.",
    "wWwh",
    ".W.h",
    ".W..",
    "w.w.",
    "w.w.",
  ], 1, 6, bellInk);
  const figureStrike = paint.add([
    ".w...",
    "wWwwh",
    "wW..h",
    ".W...",
    ".W...",
    "w.w..",
    "w.w..",
  ], 1, 6, bellInk);

  // 4. The mill-shed: sails, a water wheel, one flue and a bell on a pole. The sails always turn; once found a flag
  // runs up the pole and a hen walks out.
  const millInk = {
    s: [M.stone, 11], S: [M.stone, 7], r: [M.roofSlate, 6], R: [M.roofSlate, 3], f: [M.stoneDark, 3], o: [M.opening, 1],
    t: [M.timber, 5], T: [M.timber, 2], c: [M.sailcloth, 14], C: [M.sailcloth, 9], h: [M.whitewash, 14], e: [M.roofTile, 7],
  } as const;
  const shed = paint.add([
    "......f.....",
    "......f.....",
    ".rrrrrfrrr..",
    "rrRRRRRRRRr.",
    "sssssssssss.",
    "sSsoossSsss.",
    "sSsoossSsss.",
    "sssssssssss.",
  ], 5, 7, millInk);
  const sails = [
    paint.add(["c...C", ".c.C.", "..t..", ".C.c.", "C...c"], 2, 2, millInk),
    paint.add(["..c..", "..c..", "CCtcc", "..C..", "..C.."], 2, 2, millInk),
  ];
  const wheel = [
    paint.add([".tTt.", "t.T.t", "TTtTT", "t.T.t", ".tTt."], 2, 4, millInk),
    paint.add([".tTt.", "tT.Tt", "T.t.T", "tT.Tt", ".tTt."], 2, 4, millInk),
  ];
  const pole = paint.add(["T", "T", "T", "T", "T", "T", "T", "T", "T", "T"], 0, 9, millInk);
  const flag = paint.add(["ee", "e."], 0, 0, millInk);
  const hen = [paint.add([".h.", "hhe", ".T."], 1, 2, millInk), paint.add(["h..", "hhe", "T.T"], 1, 2, millInk)];

  // 5. The peach basket nailed to a dead oak at a field's edge, and a boy with a ball. He bounces it; once found he
  // throws, misses, throws again and scores.
  const oakInk = { b: [M.timber, 5], B: [M.timber, 3], g: [M.stoneDark, 7], k: [M.wheat, 9], K: [M.wheat, 5] } as const;
  const oak = paint.add([
    "g.....g...g.",
    ".g...g...g..",
    "..g.g...g...",
    "g..gg..g..g.",
    ".g..bgg..g..",
    "..g.bB.gg...",
    "...gbB......",
    "....bB.kKk..",
    "....bB.kKk..",
    "....bBg.....",
    "....bB......",
    "....bB......",
    "....bB......",
    "...bbBB.....",
  ], 5, 13, oakInk);
  const boyInk = { h: [M.timber, 2], f: [M.plaster, 11], s: [M.whitewash, 14], l: [M.roofSlate, 4] } as const;
  const boy = paint.add([".h.", "sfs", "sss", ".l.", "l.l"], 1, 4, boyInk);
  const boyThrow = paint.add([".h.s", "sfs.", "sss.", ".l..", "l.l."], 1, 4, boyInk);
  const ball = paint.add(["o"], 0, 0, { o: [M.roofTile, 10] });

  // The pennant, in the dragon's vermilion, on a pole: two frames of the wind.
  const pennant = [
    paint.add(["gVVV.", "TVVvv", "TVv..", "T....", "T....", "T....", "T....", "T....", "T....", "T...."], 1, 9, { g: "mane", V: "body", v: "bodyDark", T: [M.timber, 3] }),
    paint.add(["gVV..", "TVVVv", "TVvv.", "T....", "T....", "T....", "T....", "T....", "T....", "T...."], 1, 9, { g: "mane", V: "body", v: "bodyDark", T: [M.timber, 3] }),
  ];

  const foundAt = new Map<StopKey, number>();
  const seen = new Set<StopKey>();
  let primed = false;

  /** Draws `s` with its anchor on the ground at (x + dx, y + dy) world cells, `up` pixels over it. */
  function put(f: LiveFrame, s: LiveSprite, x: number, y: number, up = 0, flip = false): void {
    const col = frameX(f, x, REACH) | 0;
    if (col < -REACH || col >= f.rect.w + REACH) return;
    const row = groundRow(f, col, y, REACH);
    if (row === null) return;
    drawSprite(f, s, f.rect.x + col, y, 0.8 * y - (f.rect.y + row) + up, flip);
  }

  function drawPine(f: LiveFrame, p: StoryPlace, since: number): void {
    put(f, yew, p.x - 6, p.y - 3);
    put(f, pineRest, p.x + 4, p.y + 2);
    if (since < 0) {
      put(f, shears, p.x + 9, p.y + 2);
      return;
    }
    const snip = since < 2 ? Math.floor(since * 4) % 2 : 1;
    if (since < 2) put(f, snip ? shearsOpen : shears, p.x + 6, p.y + 2, 4);
    else put(f, shears, p.x + 9, p.y + 2);
    // The cone falls from the pine's top and stays at its foot.
    const fall = since < 2 ? 0 : Math.min(1, (since - 2) / 0.6);
    put(f, cone, p.x + 6, p.y + 2, Math.round(6 * (1 - fall)));
  }

  function drawDesk(f: LiveFrame, p: StoryPlace, t: number, since: number): void {
    put(f, cart, p.x + 16, p.y - 4);
    const writing = since < 0 || since > PIECE ? cycle(t, 1.2, 2) : 1;
    put(f, writing ? deskB : deskA, p.x, p.y);
    if (since >= 0.6 && since < PIECE) {
      const k = (since - 0.6) / (PIECE - 0.6);
      put(f, page, p.x + 1 + Math.round(6 * k), p.y, 8 + Math.round(18 * k));
    }
  }

  function drawBell(f: LiveFrame, p: StoryPlace, since: number): void {
    put(f, frame, p.x, p.y);
    let b = bellStill;
    let strike = false;
    if (since >= 0 && since < PIECE) {
      strike = since < 0.4;
      const swing = Math.floor(since * 5) % 4;
      const fade = since > 3;
      b = fade ? bellStill : swing === 1 ? bellLeft : swing === 3 ? bellRight : bellStill;
    }
    put(f, b, p.x, p.y, 8);
    put(f, strike ? figureStrike : figureRest, p.x + 6, p.y + 1);
  }

  function drawMill(f: LiveFrame, p: StoryPlace, t: number, since: number): void {
    put(f, shed, p.x, p.y);
    put(f, sails[cycle(t, 1.6, 2)], p.x - 5, p.y, 9);
    put(f, wheel[cycle(t, 1.2, 2)], p.x + 8, p.y + 1);
    put(f, pole, p.x - 8, p.y + 2);
    // The flag runs up after it is found, and stays up.
    if (since >= 0) {
      const up = Math.min(1, since / 1.5);
      put(f, flag, p.x - 7, p.y + 2, 2 + Math.round(6 * up) + 2);
      if (since > 1.5) {
        const walk = Math.min(10, (since - 1.5) * 4);
        put(f, hen[cycle(t, 0.5, 2)], p.x - 1 + Math.round(walk), p.y + 3);
      }
    }
  }

  function drawBasket(f: LiveFrame, p: StoryPlace, t: number, since: number): void {
    put(f, oak, p.x, p.y);
    const bx = p.x + 9, by = p.y + 3;
    if (since < 0 || since > PIECE) {
      // Bouncing the ball.
      const k = ((t % 0.8) + 0.8) % 0.8 / 0.8;
      const h = Math.round(4 * Math.abs(1 - 2 * k));
      put(f, boy, bx, by);
      put(f, ball, bx + 2, by, h);
      return;
    }
    // Two throws: the first hits the trunk and drops; the second goes in.
    const first = since < 2;
    const s = first ? since : since - 2;
    put(f, s < 0.25 ? boyThrow : boy, bx, by, 0, true);
    if (s < 1.2) {
      const k = Math.min(1, s / 1.2);
      // From the hand to the basket's rim (6 px left, 9 px up), on an arc.
      const tx = first ? -6 : -6, ty = first ? 7 : 10;
      const x = bx - 1 + Math.round(tx * k);
      const up = 4 + Math.round(ty * k + 8 * k * (1 - k));
      put(f, ball, x, by, up);
    } else if (first) {
      const k = Math.min(1, (s - 1.2) / 0.5);
      put(f, ball, bx - 6, by, Math.round(11 * (1 - k)));
    } else {
      // In: it sits in the basket.
      put(f, ball, bx - 7, by, 13);
    }
  }

  return {
    name: "story",
    foundAt,
    draw(f: LiveFrame) {
      if (ctx.stops.length === 0) return;
      paint.sync(f.palette, f.air ?? NOON_AIR);
      const found = ctx.found(f.t);
      // What was found before the first frame was found on another visit: it rests in its after-pose.
      for (const k of found) {
        if (seen.has(k)) continue;
        seen.add(k);
        foundAt.set(k, primed ? f.t : Number.NEGATIVE_INFINITY);
      }
      primed = true;
      const t = f.t;
      for (const p of ctx.stops) {
        const col = frameX(f, p.x, REACH + 30);
        if (col < -REACH - 30 || col >= f.rect.w + REACH + 30) continue;
        const at = foundAt.get(p.key);
        // Seconds since it was found; −1 while it is not. Found on another visit: long past its piece.
        const since = at === undefined ? -1 : at === Number.NEGATIVE_INFINITY ? PIECE + 1 : Math.max(0, t - at);
        if (p.key === "pine") drawPine(f, p, since);
        else if (p.key === "desk") drawDesk(f, p, t, since);
        else if (p.key === "bell") drawBell(f, p, since);
        else if (p.key === "mill") drawMill(f, p, t, since);
        else drawBasket(f, p, t, since);
        if (at === undefined) put(f, pennant[cycle(t + p.x, 0.9, 2)], p.x + 12, p.y + 6);
      }
    },
  };
}
