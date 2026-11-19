// The touch controls in the world's own pixels (spec 4.4): cream paper roundels with an inked double ring, for Boost,
// Brake and Land, and the floating stick, a well with a quatrefoil knob. Drawn procedurally at any radius from the
// layout, in the guides' palette, so they read as the same hand as the key-caps and the Codex. A roundel stands up on
// a darker skirt, as a key-cap does; pressed, it drops onto it, fills vermilion, its glyph turns paper and its outer
// ring reddens and thickens, so the press shows round the thumb.

import { blit } from "../controls/blit.ts";
import { blank, text, stamp, FACE, GOLD, INK, INK_SOFT, PAPER, PAPER_WASH, SKIRT, VERMILION, VERMILION_DARK, type Sprite } from "../controls/glyphs.ts";
import type { ControlLayout } from "./layout.ts";

export type Button = "boost" | "brake" | "land";

function put(s: Sprite, x: number, y: number, c: number): void {
  if (x >= 0 && y >= 0 && x < s.w && y < s.h) s.px[y * s.w + x] = c;
}

/** Distance from a pixel's centre to (cx, cy). */
function dist(x: number, y: number, cx: number, cy: number): number {
  return Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
}

/** Paints every pixel whose centre lies in the annulus (inner, outer] round (cx, cy). */
function annulus(s: Sprite, cx: number, cy: number, inner: number, outer: number, c: number): void {
  for (let y = 0; y < s.h; y++) {
    for (let x = 0; x < s.w; x++) {
      const d = dist(x, y, cx, cy);
      if (d <= outer && d > inner) put(s, x, y, c);
    }
  }
}

/** A chevron pointing up (or down), its tip at (cx, y0), arms `arm` long, strokes `t` thick. */
function chevron(s: Sprite, cx: number, y0: number, arm: number, t: number, up: boolean, c: number): void {
  for (let k = 0; k <= arm; k++) {
    for (let j = 0; j < t; j++) {
      const y = up ? y0 + k + j : y0 - k - j;
      put(s, cx - 1 - k, y, c);
      put(s, cx + k, y, c);
    }
  }
}

/** Two chevrons stacked about row `cy`: up for Boost, down for Brake (the guides' touch buttons, larger). */
function chevrons(s: Sprite, r: number, cy: number, up: boolean, c: number): void {
  const cx = s.w / 2;
  const arm = Math.max(2, Math.round(r * 0.4));
  const t = Math.max(1, Math.round(r / 9));
  const gap = Math.max(t + 1, Math.round(r * 0.3));
  const total = arm + t + gap;
  const top = Math.round(cy - total / 2);
  for (let i = 0; i < 2; i++) {
    if (up) chevron(s, cx, top + i * gap, arm, t, true, c);
    else chevron(s, cx, top + arm + t - 1 + i * gap, arm, t, false, c);
  }
}

/**
 * Land: a lancet doorway standing open on its threshold, and a stroke coming down through it (the dragon comes down
 * at the door). The arch is drawn in line, the way through left as the roundel's own face, so it reads as an opening.
 */
function arch(s: Sprite, r: number, cy: number, ink: number, mark: number): void {
  const cx = s.w / 2;
  const t = Math.max(1, Math.round(r / 11));
  // An even span, so the arch comes to a point on the roundel's centre line.
  const span = 2 * Math.max(3, Math.round(r * 0.38));
  const foot = Math.round(cy + r * 0.5);
  const spring = Math.round(cy + r * 0.06);
  const inside = (x: number, y: number, inset: number): boolean => {
    const px = x + 0.5;
    const py = y + 0.5;
    if (Math.abs(px - cx) > span / 2 - inset) return false;
    if (py > foot) return false;
    if (py >= spring) return true;
    // Above the springing line: inside both arcs of an equilateral arch.
    return Math.hypot(px - (cx + span / 2), py - spring) <= span - inset && Math.hypot(px - (cx - span / 2), py - spring) <= span - inset;
  };
  for (let y = 0; y < s.h; y++) for (let x = 0; x < s.w; x++) if (inside(x, y, 0) && !inside(x, y, t)) put(s, x, y, ink);
  // The threshold: a step wider than the door.
  const sill = span / 2 + t + 1;
  for (let x = Math.round(cx - sill); x < Math.round(cx + sill); x++) for (let j = 0; j < t; j++) put(s, x, foot + j, ink);
  // The stroke down through the doorway, ending in a head just over the threshold.
  if (span - 2 * t >= 4) {
    const head = Math.max(1, Math.min(Math.round(r * 0.14), span / 2 - t - 1));
    const tip = foot - 2;
    const from = Math.round(spring - span * 0.3);
    const w = t > 1 ? 1 : 0;
    for (let y = from; y <= tip; y++) for (let x = -1 - w; x <= w; x++) put(s, cx + x, y, mark);
    for (let k = 0; k <= head; k++) {
      for (let j = 0; j < Math.max(1, t); j++) {
        put(s, cx - 1 - k, tip - k - j, mark);
        put(s, cx + k, tip - k - j, mark);
      }
    }
  }
}

const memo = new Map<string, Sprite>();
function cached(id: string, make: () => Sprite): Sprite {
  let s = memo.get(id);
  if (!s) {
    if (memo.size > 96) memo.clear();
    s = make();
    memo.set(id, s);
  }
  return s;
}

/** A button of radius `r` frame pixels. */
export function roundel(kind: Button, r: number, pressed: boolean): Sprite {
  return cached(`${kind}|${r}|${pressed}`, () => {
    const size = 2 * r + 2;
    const s = blank(size, size);
    const c = size / 2;
    // The face stands `lift` above its skirt, as a key-cap's does; pressed, it has dropped onto it.
    const lift = pressed ? 0 : r >= 12 ? 2 : 1;
    const face = (x: number, y: number, grow: number) => dist(x, y, c, c) <= r - 2 + grow && dist(x, y, c, c - lift) <= r - 2 + grow;
    // The outer ring: a full ink line; pressed, it reddens and thickens by a pixel.
    annulus(s, c, c, -1, pressed ? r + 1 : r, pressed ? VERMILION_DARK : INK);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        if (dist(x, y, c, c) > r - 2) continue;
        if (!face(x, y, 0)) put(s, x, y, SKIRT);
        // The fine inner ring, a pixel in from the face's edge.
        else if (r >= 9 && face(x, y, -1) && !face(x, y, -2)) put(s, x, y, pressed ? VERMILION_DARK : INK_SOFT);
        else put(s, x, y, pressed ? VERMILION : FACE);
      }
    }
    const glyph = pressed ? PAPER : INK;
    const cy = size / 2 - lift / 2;
    if (kind === "land") arch(s, r, cy, glyph, pressed ? PAPER : VERMILION);
    else chevrons(s, r, cy, kind === "boost", glyph);
    return s;
  });
}

/** The stick's well: a paper wash inside an inked ring with a paper line within it. */
export function stickWell(R: number): Sprite {
  return cached(`well|${R}`, () => {
    const size = 2 * R + 2;
    const s = blank(size, size);
    const c = size / 2;
    const t = R >= 20 ? 2 : 1;
    annulus(s, c, c, -1, R - t - 1, PAPER_WASH);
    // A paper line inside the ink one, so the ring reads over forest and deep water as well as over cloud.
    annulus(s, c, c, R - t - 1, R - t, PAPER);
    annulus(s, c, c, R - t, R, INK);
    return s;
  });
}

/** The knob a thumb pushes: a quatrefoil of four lobes with a boss at its heart, cream at rest, vermilion while held. */
export function stickKnob(r: number, held: boolean): Sprite {
  return cached(`knob|${r}|${held}`, () => {
    const size = 2 * r + 2;
    const s = blank(size, size);
    const c = size / 2;
    // Lobes set a little apart and a little small, so the cusps between them cut in and it reads as a quatrefoil.
    const off = r * 0.56;
    const lobe = r * 0.44;
    const centres = [
      [c, c - off],
      [c + off, c],
      [c, c + off],
      [c - off, c],
    ];
    const inFoil = (x: number, y: number, grow: number) =>
      centres.some(([lx, ly]) => dist(x, y, lx, ly) <= lobe + grow) || dist(x, y, c, c) <= off * 0.75 + grow;
    const line = r >= 10 ? 1.5 : 1;
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        if (!inFoil(x, y, 0.5)) continue;
        put(s, x, y, inFoil(x, y, 0.5 - line) ? (held ? VERMILION : FACE) : held ? VERMILION_DARK : INK);
      }
    }
    // The boss: a small gold stud ringed in ink (paper ringed in dark red while held).
    if (r >= 8) {
      const boss = Math.max(1.5, r * 0.2);
      annulus(s, c, c, -1, boss + 1, held ? VERMILION_DARK : INK);
      annulus(s, c, c, -1, boss, held ? PAPER : GOLD);
    }
    return s;
  });
}

/** What to draw: the layout in the layer's CSS pixels, the frame's place on the layer, and what is held. */
export interface ControlsScene {
  layout: ControlLayout;
  /** Where the frame sits on the layer, CSS px. */
  frame: { x: number; y: number; w: number; h: number };
  /** The stick while a thumb holds it, CSS px: its base and its knob. */
  stick: { baseX: number; baseY: number; knobX: number; knobY: number } | null;
  /** Show the stick faintly at its rest spot when no thumb holds it (until the lesson is learned). */
  ghost: boolean;
  pressed: { boost: boolean; brake: boolean; land: boolean };
  /** Overall opacity: full while touched, fading at rest. */
  alpha: number;
}

/** A ghosted stick shows at this share of the controls' opacity. */
export const GHOST = 0.45;

/** Draws the controls into the fw × fh frame `out`, converting the scene's CSS pixels to frame pixels. */
export function drawControls(out: Uint32Array, fw: number, fh: number, scene: ControlsScene): void {
  const { layout, frame } = scene;
  if (frame.w <= 0 || frame.h <= 0 || scene.alpha <= 0) return;
  const k = fw / frame.w;
  const fx = (x: number) => (x - frame.x) * k;
  const fy = (y: number) => (y - frame.y) * k;
  const fr = (r: number) => Math.max(4, Math.round(r * k));
  const at = (s: Sprite, x: number, y: number, a: number) => blit(out, fw, fh, s, Math.round(fx(x) - s.w / 2), Math.round(fy(y) - s.h / 2), a);

  const buttons: [Button, ControlLayout["boost"] | null][] = [["brake", layout.brake], ["boost", layout.boost], ["land", layout.land]];
  for (const [kind, c] of buttons) {
    if (!c) continue;
    at(roundel(kind, fr(c.r), scene.pressed[kind]), c.x, c.y, scene.alpha);
  }
  const ring = fr(layout.ring);
  const knob = fr(layout.knob);
  if (scene.stick) {
    const { baseX, baseY, knobX, knobY } = scene.stick;
    at(stickWell(ring), baseX, baseY, 1);
    at(stickKnob(knob, true), knobX, knobY, 1);
  } else if (scene.ghost) {
    at(stickWell(ring), layout.rest.x, layout.rest.y, scene.alpha * GHOST);
    at(stickKnob(knob, false), layout.rest.x, layout.rest.y, scene.alpha * GHOST);
  }
}

/** For the turn-your-phone card: a phone upright, a turning arrow, and the phone on its side. */
export function phoneTurn(): Sprite {
  const s = blank(37, 15);
  const box = (x0: number, y0: number, w: number, h: number) => {
    for (let x = x0; x < x0 + w; x++) {
      put(s, x, y0, INK);
      put(s, x, y0 + h - 1, INK);
    }
    for (let y = y0; y < y0 + h; y++) {
      put(s, x0, y, INK);
      put(s, x0 + w - 1, y, INK);
    }
    for (let y = y0 + 1; y < y0 + h - 1; y++) for (let x = x0 + 1; x < x0 + w - 1; x++) put(s, x, y, FACE);
  };
  box(1, 0, 9, 15);
  box(22, 3, 15, 9);
  // The arrow: an arc over the gap with its head pointing down to the sideways phone.
  for (const [x, y] of [[12, 5], [13, 4], [14, 3], [15, 3], [16, 3], [17, 4], [18, 5], [19, 6], [19, 7]]) put(s, x, y, VERMILION);
  for (const [x, y] of [[17, 7], [18, 8], [19, 8], [20, 7], [21, 6]]) put(s, x, y, VERMILION);
  return s;
}

/** Height of a card's plate: an inked rim, a 12-row face and a 3-row skirt, half as tall again as a key-cap. */
export const CARD_PLATE_H = 17;

/**
 * A card's button: a key-cap grown for a thumb, its word set wide on the face. Lit, it is the one to press: vermilion
 * with paper words, a fine paper line inside its rim.
 */
export function cardPlate(word: string, lit = false): Sprite {
  const words = text(word, lit ? PAPER : INK);
  const w = words.w + 16;
  const h = CARD_PLATE_H;
  const s = blank(w, h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const corner = (x === 0 || x === w - 1) && (y === 0 || y === h - 1);
      if (corner) continue;
      const rim = x === 0 || y === 0 || x === w - 1 || y === h - 1;
      put(s, x, y, rim ? INK : y >= h - 4 ? (lit ? VERMILION_DARK : SKIRT) : lit ? VERMILION : FACE);
    }
  }
  if (lit) {
    for (let x = 3; x < w - 3; x++) {
      put(s, x, 2, VERMILION_DARK);
      put(s, x, h - 6, VERMILION_DARK);
    }
    for (let y = 3; y < h - 6; y++) {
      put(s, 2, y, VERMILION_DARK);
      put(s, w - 3, y, VERMILION_DARK);
    }
  }
  // The words sit on the face with their x-height centred, descenders within it.
  stamp(s, words, 8, 3);
  return s;
}

/** The cards' title mark: the site's quatrefoil, small and rubricated. */
export function titleFoil(): Sprite {
  return stickKnob(6, true);
}
