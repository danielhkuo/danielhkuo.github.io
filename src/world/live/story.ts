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
  /** The hall, where every project is kept, when it stands in places.json and not in the baked world. */
  hall?: { x: number; y: number };
  /** The stops found so far, read each frame (`t` is the frame's seconds). */
  found(t: number): readonly StopKey[];
}

const PI_STORY = 3.141592653589793;

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

  // 1. The small pine under the very large yew. The yew, twice a forest tree, is what is seen from the air; the pine,
  // a dark cone in a terracotta pot on the grass beside it, is the thing. Shears lie by it; once found they snip and a
  // cone drops.
  const yewInk = { k: [M.timber, 1], Y: [M.yew, 2], m: [M.yew, 5], y: [M.yew, 8], u: [M.yew, 12], b: [M.timber, 3], B: [M.timber, 6] } as const;
  const yew = paint.add([
    "............kkkuuuukk.........",
    "..........kkkuuuuyyyyk........",
    "......kkkkkuuuuyyyyyyyk.......",
    "...kkkuuuuuuuuyyyyyyyymk......",
    ".kkuuuuuuuuuyyyyyyyymmmmkk....",
    "kkuuuuuuuuuyyyyyyyymmmmmmkkk..",
    "kkuuuuuuuyyyyyyyymmmmmmmmmmkk.",
    "kuuuuuuyyyyyyyymmmmmmmmmmmmmYk",
    "kkuuuuyyyyyyyymmmmmmmmmmmmYYYk",
    ".kuuyyyyyyyymmmmmmmmmmmmmYYYYY",
    ".kkyyyyyyymmmmmmmmmmmmmYYYYYYY",
    ".kkyyyyyymmmmmmmmmmmmYYYYYYYYk",
    "..kyyyymmmmmmmmmmmmmYYYYYYYYkk",
    ".kkyymmmmmmmmmmmmmYYYYYYYYYkk.",
    ".kkymmmmmmmmmmmmYYYYYYYYYYkk..",
    ".kkmmmmmmmmmmmmYYYYYYYYYYkk...",
    "..kmmmmmmmmmmYYYYYYYYYYYYk....",
    "..kkmmmmmmmmYYYYYYYYYYYYkk....",
    "...kkkmmmmYYYYYYYYYYYYYkk.....",
    "......kkkkkkkkkYYYYYYYkk......",
    "............kbBk..............",
    "............kbBk..............",
    "............kbBk..............",
    "............kbBk..............",
    "...........kbbBBk.............",
  ], 15, 24, yewInk);
  const pineInk = {
    p: [M.pastureWarm, 15], P: [M.pastureWarm, 11], t: [M.timber, 6], T: [M.timber, 3], k: [M.yew, 1],
    o: [M.roofTile, 11], O: [M.roofTile, 7], s: [M.stone, 13], S: [M.stone, 8], z: [M.stone, 5],
  } as const;
  const pineRest = paint.add([
    "...kkkkk.......",
    "..kpppppk......",
    "..kpPpPpk......",
    "...kkkkTk......",
    "......tT..kkkk.",
    ".......tTkppppk",
    ".kkkk..TtkpPPpk",
    "kppppk.tT.kkkk.",
    "kpPPpkTt.......",
    ".kkkkTt........",
    ".....tT........",
    "..kkkkkkkkkk...",
    "..koooooooOk...",
    "...kOOOOOOk....",
    ".sssssssssssss.",
    ".sSSSSSSSSSSSs.",
    ".zS.........Sz.",
    ".zz.........zz.",
  ], 7, 17, pineInk);
  const shearsInk = { x: [M.roofLead, 2], X: [M.roofLead, 9] } as const;
  const shears = paint.add(["x...", ".X..", "..xx", "..x."], 1, 3, shearsInk);
  const shearsOpen = paint.add(["g.g", ".L.", "g.g"], 1, 2, { g: "mane", L: "maneLight" });
  const cone = paint.add([".kk.", "kcCk", "kCck", ".kk."], 1, 3, { c: [M.timber, 8], C: [M.timber, 4], k: [M.timber, 1] });

  // 2. The novelist at her desk in a hay field, with stooks round her: a chair, a dark dress, a stack of books at the
  // desk's end. She writes; once found she turns a page and it flies up.
  const deskInk = {
    d: [M.timber, 8], D: [M.timber, 3], C: [M.timber, 4], w: [M.whitewash, 15], W: [M.whitewash, 10], h: [M.timber, 1],
    f: [M.plaster, 11], k: [M.roofSlate, 2], K: [M.roofSlate, 5], b: [M.roofTile, 7], r: [M.copper, 7], c: [M.sailcloth, 12],
    g: "bellyDark", G: "maneDark", t: [M.timber, 3],
  } as const;
  const deskA = paint.add([
    "..hh..............",
    ".hhff.............",
    ".hfff........bb...",
    "..kkK.......rrrr..",
    "C.kkkkK.ww..cccc..",
    "C.kkkkdwwwwddddddd",
    "CCkkkkdddddddddddd",
    "C.kk..D..........D",
    "C.kk..D..........D",
    "C.k.k.D..........D",
  ], 8, 9, deskInk);
  const deskB = paint.add([
    "...hh.............",
    "..hhff............",
    "..hfff.......bb...",
    "..kkK.......rrrr..",
    "C.kkkKKwww..cccc..",
    "C.kkkkdwwwwddddddd",
    "CCkkkkdddddddddddd",
    "C.kk..D..........D",
    "C.kk..D..........D",
    "C.k.k.D..........D",
  ], 8, 9, deskInk);
  const page = paint.add(["www", "wwW", "wWW"], 1, 2, deskInk);
  const stook = paint.add(["..g..", ".ggg.", ".gGg.", "gGtGg", "gggGg", "GgGgG"], 2, 5, deskInk);

  // 3. The bell on a bare hill, hung in a gabled belfry with a cross on its ridge, and a wooden figure with a hammer
  // raised. Once found the figure strikes, the bell swings, and its ring goes out.
  const bellInk = {
    t: [M.timber, 7], T: [M.timber, 3], c: [M.timber, 2], w: [M.timber, 9], W: [M.timber, 5], h: [M.roofLead, 2],
    g: "belly", G: "bellyDark", L: "maneLight",
  } as const;
  const belfry = paint.add([
    "......c......",
    ".....ccc.....",
    "......c......",
    "......T......",
    ".....TtT.....",
    "....TtTtT....",
    "...TtT.TtT...",
    "..TtT...TtT..",
    "..TT.....TT..",
    "..T.......T..",
    "..T.......T..",
    "..T.......T..",
    "..T.......T..",
    "..T.......T..",
    ".TTT.....TTT.",
  ], 6, 14, bellInk);
  const bellStill = paint.add(["..T..", ".LgG.", ".ggG.", "gggGG", "..h.."], 2, 0, bellInk);
  const bellLeft = paint.add(["..T..", ".LgG.", "LggG.", "gggG.", ".h..."], 2, 0, bellInk);
  const bellRight = paint.add(["..T..", ".LgG.", ".ggGG", ".ggGG", "...h."], 2, 0, bellInk);
  const figureRest = paint.add([
    "...h",
    ".w.h",
    "wWwh",
    "wWw.",
    ".W..",
    ".W..",
    "w.w.",
    "w.w.",
  ], 1, 7, bellInk);
  const figureStrike = paint.add([
    ".w...",
    "wWwhh",
    "wW...",
    ".W...",
    ".W...",
    "w.w..",
    "w.w..",
  ], 1, 6, bellInk);

  // 4. The mill-shed: a white cross of sails on its roof, a water wheel turning in a run of blue, one flue, and a pole.
  // The sails always turn; once found a flag runs up the pole and a hen walks out.
  const millInk = {
    s: [M.stone, 12], S: [M.stone, 7], r: [M.roofSlate, 6], R: [M.roofSlate, 3], f: [M.stoneDark, 3], o: [M.opening, 1],
    t: [M.timber, 5], T: [M.timber, 2], c: [M.sailcloth, 15], k: [M.timber, 1], h: [M.whitewash, 14], e: [M.roofTile, 7],
    b: [M.river, 10], B: [M.river, 6],
  } as const;
  const shed = paint.add([
    ".......f......",
    ".......f......",
    ".rrrrrrfrrrr..",
    "rrRRRRRRRRRRr.",
    "ssssssssssssss",
    "sSsoosssSssoss",
    "sSsoosssSssoss",
    "ssssssssssssss",
  ], 6, 7, millInk);
  const sails = [
    paint.add([
      "kc.........ck",
      "kcc.......cck",
      ".kcc.....cck.",
      "..kcc...cck..",
      "...kcc.cck...",
      ".....kTk.....",
      "...kcc.cck...",
      "..kcc...cck..",
      ".kcc.....cck.",
      "kcc.......cck",
      "kc.........ck",
    ], 6, 5, millInk),
    paint.add([
      "......k......",
      ".....kck.....",
      ".....kck.....",
      ".....kck.....",
      ".....kck.....",
      "kkkkkkTkkkkkk",
      "cccccc.cccccc",
      "kkkkkkkkkkkkk",
      ".....kck.....",
      ".....kck.....",
      "......k......",
    ], 6, 5, millInk),
  ];
  const wheel = [
    paint.add([".tTt.", "t.T.t", "TTtTT", "t.T.t", ".tTt."], 2, 4, millInk),
    paint.add([".tTt.", "tT.Tt", "T.t.T", "tT.Tt", ".tTt."], 2, 4, millInk),
  ];
  const race = paint.add(["bbbbbbbbbb", "bBbbBbbBbb", "BbbBbbBbbB"], 1, 2, millInk);
  const pole = paint.add(["T", "T", "T", "T", "T", "T", "T", "T", "T", "T", "T", "T"], 0, 11, millInk);
  const flag = paint.add(["hhh", "hhh"], 0, 0, millInk);
  const hen = [paint.add([".h.", "hhe", ".T."], 1, 2, millInk), paint.add(["h..", "hhe", "T.T"], 1, 2, millInk)];

  // 5. The peach basket nailed to a dead oak at a field's edge, and a boy with a ball. He bounces it; once found he
  // throws, misses, throws again and scores.
  const oakInk = { b: [M.timber, 6], B: [M.timber, 3], g: [M.stoneDark, 6], k: [M.roofTile, 11], K: [M.roofTile, 7], n: [M.whitewash, 15] } as const;
  const oak = paint.add([
    "g.......g.....g...",
    ".g.....g.....g....",
    "..g...g.....g..g..",
    "g..g.g.....g..g...",
    ".g..gg....g..g....",
    "..g..bg..g..g.....",
    "...g.bBggg.g......",
    "....gbBg..g.......",
    ".....bB...........",
    ".....bBnnnnn......",
    ".....bBkKkKk......",
    ".....bB.nnn.......",
    ".....bB.n.n.......",
    ".....bB..n........",
    ".....bB...........",
    ".....bB...........",
    ".....bB...........",
    ".....bB...........",
    "....bbBB..........",
    "...bb.BBb.........",
  ], 6, 19, oakInk);
  const boyInk = { h: [M.timber, 1], f: [M.plaster, 11], s: [M.whitewash, 14], S: [M.whitewash, 9], l: [M.roofSlate, 3] } as const;
  const boy = paint.add([".hh.", ".ff.", "ssss", "sSss", ".ss.", ".ll.", ".l.l", ".l.l"], 1, 7, boyInk);
  const boyThrow = paint.add(["shh.", "sff.", "ssss", "sSss", ".ss.", ".ll.", ".l.l", ".l.l"], 1, 7, boyInk);
  const ball = paint.add([".kk.", "kook", "koOk", ".kk."], 1, 3, { o: [M.roofTile, 12], O: [M.roofTile, 8], k: [M.timber, 1] });

  // The pennant, in the dragon's vermilion, on a pole: two frames of the wind.
  const pennant = [
    paint.add(["gVVV.", "TVVvv", "TVv..", "T....", "T....", "T....", "T....", "T....", "T....", "T...."], 1, 9, { g: "mane", V: "body", v: "bodyDark", T: [M.timber, 3] }),
    paint.add(["gVV..", "TVVVv", "TVvv.", "T....", "T....", "T....", "T....", "T....", "T....", "T...."], 1, 9, { g: "mane", V: "body", v: "bodyDark", T: [M.timber, 3] }),
  ];

  // A find's glint: four gold sparks that fly out from the thing and go, and the bell's ring.
  const spark = [
    paint.add([".g.", "gLg", ".g."], 1, 1, { g: "mane", L: "maneLight" }),
    paint.add(["g.g", ".L.", "g.g"], 1, 1, { g: "mane", L: "maneLight" }),
    paint.add(["L"], 0, 0, { L: "maneLight" }),
  ];
  const ring = [
    paint.add(["g.......g", ".........", "g.......g"], 4, 1, { g: "mane" }),
    paint.add(["g...........g", ".............", ".............", "g...........g"], 6, 2, { g: "maneLight" }),
    paint.add(["L...............L", ".................", ".................", ".................", "L...............L"], 8, 2, { L: "maneLight" }),
  ];

  // The hall: one long roof with a lantern on its ridge, a wide red door, round-headed windows down its length. Seen
  // from the south as the baked houses are: the roof's slope above, the front wall below, inked at the edges, with a
  // shadow cast to the east on the grass.
  const hallInk = {
    k: [M.timber, 2], r: [M.roofTile, 9], R: [M.roofTile, 6], q: [M.roofTile, 12],
    s: [M.plaster, 13], S: [M.plaster, 10], z: [M.plaster, 7], o: [M.opening, 1], O: [M.opening, 4],
    d: [M.timber, 6], D: [M.timber, 3], w: [M.whitewash, 14], l: [M.lantern, 10], c: [M.cobble, 10], C: [M.cobble, 7],
    g: "mane", h: [M.timber, 1, 90],
  } as const;
  const hallSprite = paint.add([
    "...................g....................",
    "..................kgk...................",
    ".................kwlwk..................",
    ".................kwlwk..................",
    "................kkkkkkk.................",
    "....kkkkkkkkkkkkkrrrrrkkkkkkkkkkkkkkk...",
    "...krqrrqrrqrrqrrqrrqrrqrrqrrqrrqrrqk...",
    "..krrrrRrrrrRrrrrRrrrrRrrrrRrrrrRrrrrk..",
    ".krrRrrrrRrrrrRrrrrRrrrrRrrrrRrrrrRrrrk.",
    "kRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRkh",
    "kkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkh",
    ".ksssssssssssssskkkkkkkssssssssssssssskh",
    ".kss.o.ss.o.sssk.ddddd.kss.o.ss.o.ssskh.",
    ".kssoooSsoooSssk.dDdDd.ksSoooSsoooSsskhh",
    ".ksSoooSsoooSssk.dDdDd.ksSoooSsoooSsskhh",
    ".ksSsssSsssSsssk.dDdDd.ksSsssSsssSssskhh",
    ".kzzzzzzzzzzzzzk.dDdDd.kzzzzzzzzzzzzzkhh",
    ".kkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkhh",
    "..hhhhhhhhhhhhhCcCcCcCchhhhhhhhhhhhhhhhh",
    "..............cCcCcCcCcC................",
  ], 19, 17, hallInk);

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
    put(f, yew, p.x - 8, p.y - 4);
    // The bonsai stands on its bench on the open grass, clear of the yew's shade, the shears beside it.
    put(f, pineRest, p.x + 10, p.y + 8);
    if (since < 0) {
      put(f, shears, p.x + 19, p.y + 9);
      return;
    }
    // Two gold snips over the pads, then the shears are laid down again.
    const snip = since < 1.6 && Math.floor(since * 3) % 2 === 0;
    put(f, snip ? shearsOpen : shears, snip ? p.x + 15 : p.x + 19, snip ? p.y + 8 : p.y + 9, snip ? 14 : 0);
    // The cone falls from the top pad, bounces once on the bench, and lies there.
    const k = since < 1.6 ? 0 : Math.min(1, (since - 1.6) / 0.8);
    const drop = k < 0.7 ? 1 - (k / 0.7) * (k / 0.7) : 0.25 * Math.sin(((k - 0.7) / 0.3) * PI_STORY);
    put(f, cone, p.x + 13, p.y + 8, 5 + Math.round(9 * drop));
  }

  function drawDesk(f: LiveFrame, p: StoryPlace, t: number, since: number): void {
    put(f, stook, p.x - 17, p.y - 7);
    put(f, stook, p.x + 16, p.y - 9);
    put(f, stook, p.x - 14, p.y + 7);
    put(f, stook, p.x + 19, p.y + 6);
    const writing = since < 0 || since > PIECE ? cycle(t, 1.2, 2) : 1;
    put(f, writing ? deskB : deskA, p.x, p.y);
    if (since >= 0.6 && since < PIECE) {
      const k = (since - 0.6) / (PIECE - 0.6);
      put(f, page, p.x + 1 + Math.round(6 * k), p.y, 9 + Math.round(20 * k));
    }
  }

  /** The glint over a thing in the first 1.4 s after it is found: four sparks flying out to the corners. */
  function glint(f: LiveFrame, p: StoryPlace, since: number, up: number): void {
    if (since < 0 || since > 1.4) return;
    const k = since / 1.4;
    const r = Math.round(4 + 10 * k);
    const s = spark[k < 0.45 ? 0 : k < 0.8 ? 1 : 2];
    put(f, s, p.x - r, p.y, up + r);
    put(f, s, p.x + r, p.y, up + r);
    put(f, s, p.x - r, p.y, up - Math.round(r / 2));
    put(f, s, p.x + r, p.y, up - Math.round(r / 2));
  }

  function drawBell(f: LiveFrame, p: StoryPlace, since: number): void {
    put(f, belfry, p.x, p.y);
    let b = bellStill;
    let strike = false;
    if (since >= 0 && since < PIECE) {
      strike = since < 0.4;
      const swing = Math.floor(since * 5) % 4;
      b = since > 3 ? bellStill : swing === 1 ? bellLeft : swing === 3 ? bellRight : bellStill;
    }
    put(f, b, p.x, p.y, 9);
    // The ring goes out round the bell, wider each time, three times.
    if (since >= 0 && since < 2.4) put(f, ring[Math.min(2, Math.floor(since * 1.25))], p.x, p.y, 6);
    put(f, strike ? figureStrike : figureRest, p.x + 9, p.y + 1);
  }

  function drawMill(f: LiveFrame, p: StoryPlace, t: number, since: number): void {
    put(f, race, p.x + 6, p.y + 3);
    put(f, shed, p.x, p.y);
    put(f, sails[cycle(t, 1.6, 2)], p.x - 4, p.y, 7);
    put(f, wheel[cycle(t, 1.2, 2)], p.x + 9, p.y + 2);
    put(f, pole, p.x - 10, p.y + 2);
    // The flag runs up after it is found, and stays up.
    if (since >= 0) {
      const up = Math.min(1, since / 1.5);
      put(f, flag, p.x - 9, p.y + 2, 3 + Math.round(8 * up));
      if (since > 1.5) {
        const walk = Math.min(12, (since - 1.5) * 4);
        put(f, hen[cycle(t, 0.5, 2)], p.x - 2 + Math.round(walk), p.y + 5);
      }
    }
  }

  function drawBasket(f: LiveFrame, p: StoryPlace, t: number, since: number): void {
    put(f, oak, p.x, p.y);
    const bx = p.x + 12, by = p.y + 4;
    if (since < 0 || since > PIECE) {
      // Bouncing the ball.
      const k = ((t % 0.8) + 0.8) % 0.8 / 0.8;
      const h = Math.round(6 * Math.abs(1 - 2 * k));
      put(f, boy, bx, by);
      put(f, ball, bx + 3, by, h);
      return;
    }
    // Two throws: the first hits the trunk and drops; the second goes in. The basket's mouth is 3 cells east of the
    // trunk and 10 px up.
    const first = since < 2;
    const s = first ? since : since - 2;
    put(f, s < 0.25 ? boyThrow : boy, bx, by, 0, true);
    if (s < 1.2) {
      const k = Math.min(1, s / 1.2);
      const tx = first ? p.x + 1 : p.x + 3;
      const x = Math.round(bx - 1 + (tx - (bx - 1)) * k);
      const y = Math.round(by + (p.y - by) * k);
      const up = Math.round(7 + (first ? 1 : 3) * k + 14 * k * (1 - k));
      put(f, ball, x, y, up);
    } else if (first) {
      const k = Math.min(1, (s - 1.2) / 0.5);
      put(f, ball, p.x + 1, p.y, Math.round(8 * (1 - k)));
    } else {
      put(f, ball, p.x + 3, p.y, 9);
    }
  }

  return {
    name: "story",
    foundAt,
    draw(f: LiveFrame) {
      if (ctx.stops.length === 0 && !ctx.hall) return;
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
      if (ctx.hall) put(f, hallSprite, ctx.hall.x, ctx.hall.y);
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
        glint(f, p, since, 10);
        // The pennant stands beside the thing, clear of it: the bonsai's bench reaches further east than the others.
        if (at === undefined) put(f, pennant[cycle(t + p.x, 0.9, 2)], p.x + (p.key === "pine" ? 22 : 12), p.y + 6);
      }
    },
  };
}
