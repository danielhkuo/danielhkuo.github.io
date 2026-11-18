// Shared checks for cloud painters: every style must pass these; each style's own test adds its look.

import assert from "node:assert/strict";
import { test } from "node:test";
import { lstar } from "../render/palette.ts";
import { makeShapes, SHAPE_COUNTS, type CloudShape } from "../sky/shapes.ts";
import { MIDDAY_INKS, type Painter, type Sprite } from "../sky/sprite.ts";

let memo: CloudShape[] | null = null;
/** The shapes painters are tested on, built on first use. */
export function testShapes(): CloudShape[] {
  return (memo ??= makeShapes(11, SHAPE_COUNTS));
}

export const L = (rgba: number): number => lstar(rgba);

/** First and last rows that hold cloud (cover > 0.5). */
export function coveredRows(s: CloudShape): [number, number] {
  let top = -1, bottom = -1;
  for (let y = 0; y < s.h; y++) for (let x = 0; x < s.w; x++) {
    if (s.cover[y * s.w + x] > 0.5) {
      if (top < 0) top = y;
      bottom = y;
    }
  }
  return [top, bottom];
}

/** Mean L* of opaque-ish pixels (alpha > 128) in rows [y0, y1]. */
export function meanL(sp: Sprite, y0: number, y1: number): number {
  let sum = 0, k = 0;
  for (let y = Math.max(0, y0); y <= Math.min(sp.h - 1, y1); y++) for (let x = 0; x < sp.w; x++) {
    const i = y * sp.w + x;
    if (sp.alpha[i] > 128) { sum += L(sp.rgba[i]); k++; }
  }
  return k ? sum / k : NaN;
}

/** The checks every style passes. */
export function commonPainterTests(name: string, paint: Painter): void {
  const painted = (): { s: CloudShape; sp: Sprite }[] => testShapes().map((s, i) => ({ s, sp: paint(s, MIDDAY_INKS, 100 + i) }));

  test(`${name}: the same shape and seed paint the same sprite, the size of the shape`, () => {
    for (const s of testShapes().slice(0, 12)) {
      const a = paint(s, MIDDAY_INKS, 5), b = paint(s, MIDDAY_INKS, 5);
      assert.deepEqual(a, b);
      assert.deepEqual([a.w, a.h, a.rgba.length, a.alpha.length], [s.w, s.h, s.w * s.h, s.w * s.h]);
    }
  });

  test(`${name}: clear where there is no cloud, and showing where there is`, () => {
    for (const { s, sp } of painted()) {
      let solid = 0, shown = 0;
      for (let i = 0; i < s.cover.length; i++) {
        if (s.cover[i] === 0) assert.equal(sp.alpha[i], 0, `${s.kind} alpha off the cloud`);
        if (s.cover[i] > 0.5) { solid++; if (sp.alpha[i] > 0) shown++; }
      }
      assert.ok(shown >= 0.9 * solid, `${s.kind}: ${shown} of ${solid} solid pixels show`);
    }
  });

  test(`${name}: heaps and banks are lit on top, at least 8 L* brighter than their bellies`, () => {
    for (const { s, sp } of painted()) {
      if (s.kind !== "heap" && s.kind !== "bank") continue;
      const [top, bottom] = coveredRows(s);
      const third = Math.max(1, Math.floor((bottom - top + 1) / 3));
      const upper = meanL(sp, top, top + third - 1), lower = meanL(sp, bottom - third + 1, bottom);
      assert.ok(upper - lower >= 8, `${s.kind} ${s.w}x${s.h}: top ${upper.toFixed(1)}, belly ${lower.toFixed(1)}`);
    }
  });

  test(`${name}: nothing reddish (vermilion and gold belong to the flier and the landmarks)`, () => {
    for (const { sp } of painted()) {
      for (let i = 0; i < sp.rgba.length; i++) {
        if (sp.alpha[i] === 0) continue;
        const v = sp.rgba[i], r = v & 255, g = (v >>> 8) & 255;
        assert.ok(r <= g + 60, `pixel ${v.toString(16)}`);
      }
    }
  });
}
