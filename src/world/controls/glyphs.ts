// The guides' glyphs: key-caps, gamepad buttons and touch marks, drawn as small palette-indexed sprites in the pixel
// style of the world, and the words beside them. One set for every device and every renderer: `blit` draws a sprite
// into the frame, and the page's PixelGlyph draws the same sprite as SVG.

import { eachDot, ROWS, textWidth } from "./font.ts";

/** Palette slots. 0 is clear. */
export const INK = 1;
export const PAPER = 2;
export const FACE = 3;
export const SKIRT = 4;
export const VERMILION = 5;
export const VERMILION_DARK = 6;
export const GOLD = 7;
export const SHADOW = 8;
export const INK_SOFT = 9;
/** The paper, half seen through: the touch stick's well, so the land shows under it. */
export const PAPER_WASH = 10;
/**
 * The quest's five pieces, each in its own colour (story/stops.ts PIECE_RGB, in STOPS order): pine, desk, bell, mill,
 * basket. Their slots in the count fill with these.
 */
export const PIECE_SLOTS = [11, 12, 13, 14, 15] as const;

/** r, g, b, a (0–255) for each slot. The Codex sheet's colours, so the guides and the Codex read as one hand. */
export const COLOURS: readonly (readonly [number, number, number, number])[] = [
  [0, 0, 0, 0],
  [46, 42, 36, 255],
  [240, 232, 210, 255],
  [248, 242, 225, 255],
  [205, 189, 150, 255],
  [207, 63, 43, 255],
  [150, 40, 30, 255],
  [217, 166, 55, 255],
  [46, 42, 36, 80],
  [90, 82, 70, 255],
  [240, 232, 210, 92],
  [74, 168, 90, 255],
  [60, 112, 208, 255],
  [232, 180, 60, 255],
  [46, 166, 160, 255],
  [226, 106, 44, 255],
];

/** A small picture: w × h palette slots, row-major. */
export interface Sprite {
  w: number;
  h: number;
  px: Uint8Array;
}

export function blank(w: number, h: number): Sprite {
  return { w, h, px: new Uint8Array(w * h) };
}

function set(s: Sprite, x: number, y: number, c: number): void {
  if (x >= 0 && y >= 0 && x < s.w && y < s.h) s.px[y * s.w + x] = c;
}

/** Copies `src` onto `dst` at (x, y); clear pixels of `src` leave `dst` as it was. */
export function stamp(dst: Sprite, src: Sprite, x: number, y: number): void {
  for (let j = 0; j < src.h; j++) {
    for (let i = 0; i < src.w; i++) {
      const c = src.px[j * src.w + i];
      if (c) set(dst, x + i, y + j, c);
    }
  }
}

/** Sprites side by side, `gap` apart, centred on one another vertically. */
export function row(items: readonly Sprite[], gap: number): Sprite {
  const w = items.reduce((a, s) => a + s.w, 0) + gap * Math.max(0, items.length - 1);
  const h = items.reduce((a, s) => Math.max(a, s.h), 0);
  const out = blank(w, h);
  let x = 0;
  for (const s of items) {
    stamp(out, s, x, (h - s.h) >> 1);
    x += s.w + gap;
  }
  return out;
}

/** Sprites one under another, `gap` apart, centred on one another (or flush left, `start`). */
export function column(items: readonly Sprite[], gap: number, align: "center" | "start" = "center"): Sprite {
  const w = items.reduce((a, s) => Math.max(a, s.w), 0);
  const h = items.reduce((a, s) => a + s.h, 0) + gap * Math.max(0, items.length - 1);
  const out = blank(w, h);
  let y = 0;
  for (const s of items) {
    stamp(out, s, align === "start" ? 0 : (w - s.w) >> 1, y);
    y += s.h + gap;
  }
  return out;
}

/** `text` in the font, in slot `c`, on a clear ground: textWidth × ROWS. */
export function text(t: string, c = INK): Sprite {
  const s = blank(Math.max(1, textWidth(t)), ROWS);
  eachDot(t, (x, y) => set(s, x, y, c));
  return s;
}

/** Puts a one-pixel `halo` (every pixel touching it, corners too) round whatever is drawn in `s`, growing it by 1 a side. */
export function haloed(s: Sprite, halo = PAPER): Sprite {
  const out = blank(s.w + 2, s.h + 2);
  for (let y = 0; y < s.h; y++) {
    for (let x = 0; x < s.w; x++) {
      if (!s.px[y * s.w + x]) continue;
      for (let dy = 0; dy <= 2; dy++) for (let dx = 0; dx <= 2; dx++) set(out, x + dx, y + dy, halo);
    }
  }
  stamp(out, s, 1, 1);
  return out;
}

/** Words for the guides: ink with a paper halo, so they read over sea, forest, cliff and cloud alike. */
export function label(t: string, c = INK): Sprite {
  return haloed(text(t, c));
}

/** Rows of `s` that hold anything: [first, last], or [0, -1] when it is empty. */
function inkRows(s: Sprite): [number, number] {
  let top = -1;
  let bottom = -1;
  for (let y = 0; y < s.h; y++) {
    for (let x = 0; x < s.w; x++) {
      if (s.px[y * s.w + x]) {
        if (top < 0) top = y;
        bottom = y;
        break;
      }
    }
  }
  return top < 0 ? [0, -1] : [top, bottom];
}

/** Height of a key-cap: an inked rim, an 8-row face, a 2-row skirt. */
export const CAP_H = 12;
/** A key-cap is never narrower than this, so single letters sit in square-ish caps. */
export const CAP_MIN_W = 11;

/** Height of a slip: two pixels under a cap's, so a word never passes for a key. */
export const SLIP_H = CAP_H - 2;

/**
 * Words on a slip of paper: a flat paper plate with a soft-inked rim and clipped corners, the words just filling it
 * (ascenders to descenders). It reads over sea, forest, cliff and cloud alike; beside a cap it reads as the cap's
 * label, flat and lower, where the cap stands up on its skirt.
 */
export function slip(t: string): Sprite {
  const words = text(t);
  const w = words.w + 6;
  const s = blank(w, SLIP_H);
  for (let y = 0; y < SLIP_H; y++) {
    for (let x = 0; x < w; x++) {
      if ((x === 0 || x === w - 1) && (y === 0 || y === SLIP_H - 1)) continue;
      set(s, x, y, x === 0 || y === 0 || x === w - 1 || y === SLIP_H - 1 ? INK_SOFT : PAPER);
    }
  }
  stamp(s, words, 3, 1);
  return s;
}

/**
 * A key-cap with `legend` on it: an inked rim with its corners clipped, a pale face with the legend centred on it, and
 * a darker skirt below, as if seen a little from the front. Lit, it is pressed: the face drops a pixel onto a thinner
 * skirt and turns vermilion, the legend paper. `minW` widens it (a space bar).
 */
export function keycap(legend: string, lit = false, minW = CAP_MIN_W): Sprite {
  const t = text(legend, lit ? PAPER : INK);
  const [top, bottom] = inkRows(t);
  const w = Math.max(minW, t.w + 6);
  const s = blank(w, CAP_H);
  const y0 = lit ? 1 : 0;
  const faceRows = 8;
  const yBottom = CAP_H - 1;
  for (let x = 1; x < w - 1; x++) {
    set(s, x, y0, INK);
    set(s, x, yBottom, INK);
  }
  for (let y = y0 + 1; y < yBottom; y++) {
    set(s, 0, y, INK);
    set(s, w - 1, y, INK);
    const fill = y < y0 + 1 + faceRows ? (lit ? VERMILION : FACE) : lit ? VERMILION_DARK : SKIRT;
    for (let x = 1; x < w - 1; x++) set(s, x, y, fill);
  }
  // A word sits on its x-height, centred on the face, its ascenders and descenders within it; a capital or an arrow is
  // centred by its ink.
  const ty = /[a-z]/.test(legend) ? y0 + 1 : y0 + 1 + ((faceRows - (bottom - top + 1)) >> 1) - top;
  stamp(s, t, (w - t.w) >> 1, ty);
  return s;
}

/** The legend a key-cap shows for a KeyboardEvent.key: letters in capitals, named keys in lower case, as on a Mac. */
export function keyLegend(key: string): string {
  const named: Record<string, string> = {
    " ": "space",
    ArrowLeft: "←",
    ArrowRight: "→",
    ArrowUp: "↑",
    ArrowDown: "↓",
    Shift: "shift",
    Escape: "esc",
    Enter: "enter",
    Tab: "tab",
    Control: "ctrl",
    Alt: "alt",
    Meta: "cmd",
    Backspace: "delete",
    CapsLock: "caps",
  };
  if (named[key]) return named[key];
  if (key.length === 1) return key.toUpperCase();
  return key.toLowerCase().slice(0, 6);
}

/** A key-cap for a KeyboardEvent.key, the space bar drawn wide. */
export function keyCap(key: string, lit = false): Sprite {
  return keycap(keyLegend(key), lit, key === " " ? 31 : CAP_MIN_W);
}

/** A disk `d` pixels across: 1 inside. */
function disk(d: number): Uint8Array {
  const m = new Uint8Array(d * d);
  const c = (d - 1) / 2;
  const r2 = (d / 2) * (d / 2);
  for (let y = 0; y < d; y++) for (let x = 0; x < d; x++) if ((x - c) * (x - c) + (y - c) * (y - c) <= r2) m[y * d + x] = 1;
  return m;
}

/** Draws a disk `d` across at (x, y), its rim in `rim` and its inside in `fill` (0 leaves the inside clear). */
function round(s: Sprite, x: number, y: number, d: number, rim: number, fill: number): void {
  const m = disk(d);
  for (let j = 0; j < d; j++) {
    for (let i = 0; i < d; i++) {
      if (!m[j * d + i]) continue;
      const edge = i === 0 || j === 0 || i === d - 1 || j === d - 1 || !m[j * d + i - 1] || !m[j * d + i + 1] || !m[(j - 1) * d + i] || !m[(j + 1) * d + i];
      if (edge) set(s, x + i, y + j, rim);
      else if (fill) set(s, x + i, y + j, fill);
    }
  }
}

export type FaceButton = "south" | "east" | "west" | "north";

/**
 * The four face buttons as a diamond, by position, so no maker's letters are needed: each an inked ring, the one to
 * press filled vermilion (darker while held), the others pale.
 */
export function padFace(which: FaceButton, lit = false): Sprite {
  const s = blank(15, 15);
  const at: Record<FaceButton, [number, number]> = { north: [5, 0], west: [0, 5], east: [10, 5], south: [5, 10] };
  for (const b of ["north", "west", "east", "south"] as const) {
    const [x, y] = at[b];
    round(s, x, y, 5, INK, b === which ? (lit ? VERMILION_DARK : VERMILION) : FACE);
  }
  return s;
}

/** The left stick, seen from above, with arrows either side for steering; lit while it is pushed. */
export function padStick(lit = false): Sprite {
  const s = blank(19, 11);
  round(s, 4, 0, 11, INK, FACE);
  round(s, 7, 3, 5, INK, lit ? VERMILION : INK_SOFT);
  // ◂ and ▸
  for (let k = 0; k < 3; k++) {
    for (let y = 5 - k; y <= 5 + k; y++) {
      set(s, k, y, INK);
      set(s, 18 - k, y, INK);
    }
  }
  return s;
}

export type DpadArm = "left" | "right" | "up" | "down";

/** The d-pad: a cross with the arms to press filled (vermilion while held). */
export function padDpad(arms: readonly DpadArm[], lit = false): Sprite {
  const s = blank(11, 11);
  const pressed = new Set(arms);
  const cross = (x: number, y: number) => (x >= 3 && x <= 7) || (y >= 3 && y <= 7);
  for (let y = 0; y < 11; y++) {
    for (let x = 0; x < 11; x++) {
      if (!cross(x, y)) continue;
      const rim = x === 0 || y === 0 || x === 10 || y === 10 || !cross(x - 1, y) || !cross(x + 1, y) || !cross(x, y - 1) || !cross(x, y + 1);
      const arm: DpadArm | null = x < 3 ? "left" : x > 7 ? "right" : y < 3 ? "up" : y > 7 ? "down" : null;
      const on = arm !== null && pressed.has(arm);
      set(s, x, y, rim ? INK : on ? (lit ? VERMILION : INK) : FACE);
    }
  }
  return s;
}

/** A trigger or shoulder button: a key-cap with its top corners rounded off, named as the pad's maker names it. */
export function padTrigger(name: string, lit = false): Sprite {
  const s = keycap(name, lit, 15);
  const y0 = lit ? 1 : 0;
  // Round the top corners a pixel further than a key's.
  set(s, 1, y0, 0);
  set(s, s.w - 2, y0, 0);
  set(s, 0, y0 + 1, 0);
  set(s, s.w - 1, y0 + 1, 0);
  set(s, 1, y0 + 1, INK);
  set(s, s.w - 2, y0 + 1, INK);
  return s;
}

/** A small key-like plate with a word on it: the pad's View and Menu buttons, the touch screen's corner button. */
export function plate(word: string, lit = false): Sprite {
  return keycap(word, lit, CAP_MIN_W);
}

/** A fingertip on glass, for touch: a pointing hand with an arc where it touches; lit, the arc is vermilion. */
export function touchTap(lit = false): Sprite {
  const hand = [
    "....##......",
    "...#..#.....",
    "...#..#.....",
    "...#..###...",
    "...#..#..##.",
    ".##...#..#.#",
    "#..#.......#",
    "#..........#",
    ".#.........#",
    "..#.......#.",
    "...#......#.",
    "....######..",
  ];
  const s = blank(12, 15);
  hand.forEach((line, y) => {
    for (let x = 0; x < line.length; x++) if (line[x] === "#") set(s, x, y + 3, INK);
  });
  // Fill the hand with the face colour, between its outline on each row.
  for (let y = 4; y < 14; y++) {
    let first = -1;
    let last = -1;
    for (let x = 0; x < 12; x++) {
      if (s.px[y * 12 + x] === INK) {
        if (first < 0) first = x;
        last = x;
      }
    }
    for (let x = first + 1; x < last; x++) if (!s.px[y * 12 + x]) set(s, x, y, FACE);
  }
  // Where the fingertip touches the glass: an arc over it.
  const arc = lit ? VERMILION : INK_SOFT;
  for (const [x, y] of [[2, 2], [3, 1], [4, 0], [5, 0], [6, 1], [7, 2]]) set(s, x, y, arc);
  return s;
}

/** The floating joystick a thumb puts down (for the mobile controls): a ring with its knob. */
export function touchStick(lit = false): Sprite {
  const s = blank(15, 15);
  round(s, 0, 0, 15, INK, 0);
  round(s, 1, 1, 13, INK_SOFT, 0);
  round(s, 5, 5, 5, INK, lit ? VERMILION : FACE);
  return s;
}

/** The boost and slow buttons (for the mobile controls): a round button with two chevrons, up or down. */
export function touchButton(kind: "boost" | "slow", lit = false): Sprite {
  const s = blank(13, 13);
  round(s, 0, 0, 13, INK, lit ? VERMILION : FACE);
  const ink = lit ? PAPER : INK;
  for (const base of [4, 7]) {
    for (let k = 0; k < 3; k++) {
      const y = kind === "boost" ? base + k : base + 2 - k;
      set(s, 6 - k, y, ink);
      set(s, 6 + k, y, ink);
    }
  }
  return s;
}

/** A copy of `s` with every pixel of slot `from` turned to `to`. */
export function recolour(s: Sprite, from: number, to: number): Sprite {
  const px = s.px.slice();
  for (let i = 0; i < px.length; i++) if (px[i] === from) px[i] = to;
  return { w: s.w, h: s.h, px };
}
