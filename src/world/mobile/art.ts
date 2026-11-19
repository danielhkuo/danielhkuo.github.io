// The touch controls in the world's own pixels (spec 4.4): cream paper roundels with an inked double ring, for Boost,
// Brake and Land, and the floating stick, a well with a quatrefoil knob. Drawn procedurally at any radius from the
// layout, in the guides' palette, so they read as the same hand as the key-caps and the Codex. Pressed, a roundel
// fills vermilion, its glyph turns paper and its outer ring thickens, so the press shows round the thumb.

import { blit } from "../controls/blit.ts";
import { blank, FACE, INK, INK_SOFT, PAPER, PAPER_WASH, VERMILION, VERMILION_DARK, type Sprite } from "../controls/glyphs.ts";
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

/** Two chevrons stacked: up for Boost, down for Brake (the guides' touch buttons, larger). */
function chevrons(s: Sprite, r: number, up: boolean, c: number): void {
  const cx = s.w / 2;
  const arm = Math.max(2, Math.round(r * 0.42));
  const t = Math.max(1, Math.round(r / 10));
  const gap = Math.max(2, Math.round(r * 0.3));
  const total = arm + t + gap;
  const top = Math.round(s.h / 2 - total / 2);
  for (let i = 0; i < 2; i++) {
    if (up) chevron(s, cx, top + i * gap, arm, t, true, c);
    else chevron(s, cx, top + arm + t - 1 + i * gap, arm, t, false, c);
  }
}

/** A lancet arch (a doorway) with a step inside, for Land: the dragon comes down at the door. */
function arch(s: Sprite, r: number, ink: number, dark: number): void {
  const cx = s.w / 2;
  const span = Math.max(6, Math.round(r * 0.9));
  const spring = Math.round(s.h / 2 + r * 0.05);
  const foot = Math.round(s.h / 2 + r * 0.55);
  const t = Math.max(1, Math.round(r / 10));
  const insideArch = (x: number, y: number, inset: number): boolean => {
    const px = x + 0.5;
    const py = y + 0.5;
    if (Math.abs(px - cx) > span / 2 - inset) return false;
    if (py > foot - inset * 0) return false;
    if (py >= spring) return true;
    // Above the springing line: inside both arcs of an equilateral arch.
    const left = Math.hypot(px - (cx + span / 2), py - spring) <= span - inset;
    const right = Math.hypot(px - (cx - span / 2), py - spring) <= span - inset;
    return left && right;
  };
  for (let y = 0; y < s.h; y++) {
    for (let x = 0; x < s.w; x++) {
      if (!insideArch(x, y, 0)) continue;
      put(s, x, y, insideArch(x, y, t) ? dark : ink);
    }
  }
  // A threshold under the door, a little wider than it.
  const sill = Math.round(span / 2 + t);
  for (let x = Math.round(cx - sill); x < Math.round(cx + sill); x++) for (let j = 0; j < t; j++) put(s, x, foot + j, ink);
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
    annulus(s, c, c, -1, r - 2, pressed ? VERMILION : FACE);
    // The double ring: a full ink line outside, a fine soft one inside; pressed, the outside reddens and thickens.
    annulus(s, c, c, r - 2, pressed ? r + 1 : r, pressed ? VERMILION_DARK : INK);
    if (r >= 9) annulus(s, c, c, r - 4, r - 3, pressed ? VERMILION_DARK : INK_SOFT);
    const glyph = pressed ? PAPER : INK;
    if (kind === "land") arch(s, r, glyph, pressed ? VERMILION_DARK : INK_SOFT);
    else chevrons(s, r, kind === "boost", glyph);
    return s;
  });
}

/** The stick's well: a paper wash inside an inked ring, the land half seen through it. */
export function stickWell(R: number): Sprite {
  return cached(`well|${R}`, () => {
    const size = 2 * R + 2;
    const s = blank(size, size);
    const c = size / 2;
    annulus(s, c, c, -1, R - 2, PAPER_WASH);
    annulus(s, c, c, R - 2, R, INK);
    return s;
  });
}

/** The knob a thumb pushes: a quatrefoil of four lobes, cream at rest, vermilion while held. */
export function stickKnob(r: number, held: boolean): Sprite {
  return cached(`knob|${r}|${held}`, () => {
    const size = 2 * r + 2;
    const s = blank(size, size);
    const c = size / 2;
    const lobe = r * 0.5;
    const centres = [
      [c, c - lobe],
      [c + lobe, c],
      [c, c + lobe],
      [c - lobe, c],
    ];
    const inFoil = (x: number, y: number, grow: number) =>
      centres.some(([lx, ly]) => dist(x, y, lx, ly) <= lobe + grow) || dist(x, y, c, c) <= lobe * 0.9 + grow;
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        if (!inFoil(x, y, 0.5)) continue;
        put(s, x, y, inFoil(x, y, -1) ? (held ? VERMILION : FACE) : held ? VERMILION_DARK : INK);
      }
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
    at(stickWell(ring), scene.stick.baseX, scene.stick.baseY, 1);
    at(stickKnob(knob, true), scene.stick.knobX, scene.stick.knobY, 1);
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
