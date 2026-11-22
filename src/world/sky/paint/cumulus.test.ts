import assert from "node:assert/strict";
import { test } from "node:test";
import { lstar } from "../../render/palette.ts";
import { makeShapes, SHAPE_COUNTS, type CloudShape } from "../shapes.ts";
import type { Sprite } from "../sprite.ts";
import { MIDDAY_RAMP, paintCumulus, toneOf } from "./cumulus.ts";

let memo: { s: CloudShape; sp: Sprite }[] | null = null;
/** Shapes and their sprites, built on first use. */
const painted = () => (memo ??= makeShapes(11, SHAPE_COUNTS).map((s) => ({ s, sp: paintCumulus(s) })));
const big = () => painted().filter(({ s }) => s.kind === "heap" || s.kind === "bank");
const RAMP = [MIDDAY_RAMP.rim, ...MIDDAY_RAMP.tones];
const rgb = (v: number) => [v & 255, (v >>> 8) & 255, (v >>> 16) & 255];

/** Mean L* of the sprite's pixels in rows [y0, y1]. */
function meanL(sp: Sprite, y0: number, y1: number): number {
  let sum = 0, k = 0;
  for (let y = y0; y <= y1; y++) for (let x = 0; x < sp.w; x++) {
    const i = y * sp.w + x;
    if (sp.alpha[i]) { sum += lstar(sp.rgba[i]); k++; }
  }
  return k ? sum / k : NaN;
}
/** First and last rows that hold cloud. */
function rows(s: CloudShape): [number, number] {
  const first = s.cover.indexOf(1), last = s.cover.lastIndexOf(1);
  return [Math.floor(first / s.w), Math.floor(last / s.w)];
}

test("the ramp is short and steps down in clean stages from white to lavender", () => {
  assert.ok(RAMP.length >= 4 && RAMP.length <= 6, `${RAMP.length} colours`);
  assert.equal(MIDDAY_RAMP.cuts.length, MIDDAY_RAMP.tones.length - 1);
  const tones = MIDDAY_RAMP.tones;
  assert.ok(lstar(tones[0]) >= 97, "sunlit crowns are brilliant white");
  for (let k = 1; k < tones.length; k++) {
    const step = lstar(tones[k - 1]) - lstar(tones[k]);
    assert.ok(step >= 4 && step <= 16, `tone ${k} is ${step.toFixed(1)} L* under tone ${k - 1}`);
    assert.ok(MIDDAY_RAMP.cuts[k - 1] < (MIDDAY_RAMP.cuts[k - 2] ?? Infinity), "cuts fall");
    // Shade is cool: blue over red, and more so the deeper it goes.
    const [r, , b] = rgb(tones[k]);
    assert.ok(b - r >= 8 * k, `tone ${k}: blue ${b}, red ${r}`);
  }
  assert.ok(lstar(tones[tones.length - 1]) >= 55, "the deepest shade is still cloud, not ink");
  // The rim is warm: a faint cream, as bright as the crown.
  const [r, g, b] = rgb(MIDDAY_RAMP.rim);
  assert.ok(r > b && r - b <= 48 && g >= b && lstar(MIDDAY_RAMP.rim) >= 95, `rim ${r},${g},${b}`);
  assert.equal(toneOf(MIDDAY_RAMP, 1), 0);
  assert.equal(toneOf(MIDDAY_RAMP, -9), tones.length - 1);
});

test("the same shape paints the same sprite, the size of the shape", () => {
  for (const { s, sp } of painted().slice(0, 12)) {
    assert.deepEqual(paintCumulus(s), sp);
    assert.deepEqual([sp.w, sp.h, sp.rgba.length, sp.alpha.length], [s.w, s.h, s.w * s.h, s.w * s.h]);
  }
});

test("edges are crisp: every pixel is fully cloud or fully clear", () => {
  for (const { s, sp } of painted()) {
    for (let i = 0; i < sp.alpha.length; i++) assert.equal(sp.alpha[i], s.cover[i] ? 255 : 0, `${s.kind} alpha ${sp.alpha[i]}`);
  }
});

test("every pixel is one of the ramp's colours, and big clouds use at least four of them", () => {
  for (const { s, sp } of painted()) {
    const used = new Set<number>();
    for (let i = 0; i < sp.rgba.length; i++) if (sp.alpha[i]) used.add(sp.rgba[i]);
    for (const v of used) assert.ok(RAMP.includes(v), `${s.kind}: colour ${v.toString(16)} is not in the ramp`);
    if (s.kind === "heap" || s.kind === "bank") assert.ok(used.size >= 4, `${s.kind} ${s.w}x${s.h}: ${used.size} tones`);
    assert.ok(used.has(MIDDAY_RAMP.tones[0]), `${s.kind} ${s.w}x${s.h} has a sunlit crown`);
  }
});

test("crowns are lit and flanks shaded: the top third is at least 8 L* brighter than the bottom third", () => {
  for (const { s, sp } of big()) {
    const [top, bottom] = rows(s);
    const third = Math.max(1, Math.floor((bottom - top + 1) / 3));
    const upper = meanL(sp, top, top + third - 1), lower = meanL(sp, bottom - third + 1, bottom);
    assert.ok(upper - lower >= 8, `${s.kind} ${s.w}x${s.h}: top ${upper.toFixed(1)}, bottom ${lower.toFixed(1)}`);
  }
});

test("a big cloud is mostly sunlit from above, with real shade: neither a white sticker nor a grey lump", () => {
  for (const { s, sp } of big()) {
    let lit = 0, shade = 0, n = 0;
    for (let i = 0; i < sp.rgba.length; i++) {
      if (!sp.alpha[i]) continue;
      n++;
      if (sp.rgba[i] === MIDDAY_RAMP.tones[0] || sp.rgba[i] === MIDDAY_RAMP.rim) lit++;
      else if (sp.rgba[i] !== MIDDAY_RAMP.tones[1]) shade++;
    }
    assert.ok(lit >= 0.2 * n && lit <= 0.7 * n, `${s.kind} ${s.w}x${s.h}: ${(100 * lit / n).toFixed(0)} % sunlit`);
    assert.ok(shade >= 0.15 * n, `${s.kind} ${s.w}x${s.h}: ${(100 * shade / n).toFixed(0)} % in shade`);
  }
});

test("tones meet in clean steps: no stipple, no lone pixels", () => {
  for (const { s, sp } of painted()) {
    // A lone pixel: no neighbour (of 4) shares its tone. Rims are one pixel wide by design and lie over the tone
    // of their crown, so they are not counted, and a rim beside a pixel does not strand it.
    let lone = 0, n = 0;
    for (let y = 1; y < sp.h - 1; y++) for (let x = 1; x < sp.w - 1; x++) {
      const i = y * sp.w + x;
      if (!sp.alpha[i] || sp.rgba[i] === MIDDAY_RAMP.rim) continue;
      n++;
      const v = sp.rgba[i];
      const same = (j: number) => sp.alpha[j] !== 0 && (sp.rgba[j] === v || sp.rgba[j] === MIDDAY_RAMP.rim);
      if (!same(i - 1) && !same(i + 1) && !same(i - sp.w) && !same(i + sp.w)) lone++;
    }
    assert.ok(lone <= Math.max(1, 0.003 * n), `${s.kind} ${s.w}x${s.h}: ${lone} lone pixels of ${n}`);
  }
});

test("rims are single-pixel highlights where a crown catches the sun", () => {
  let total = 0;
  for (const { s, sp } of painted()) {
    for (let y = 0; y < sp.h - 1; y++) for (let x = 0; x < sp.w - 1; x++) {
      const i = y * sp.w + x;
      if (!sp.alpha[i] || sp.rgba[i] !== MIDDAY_RAMP.rim) continue;
      total++;
      assert.ok(s.rim[i] > 0, "rim colour only on a rim");
      const block = [i + 1, i + sp.w, i + sp.w + 1].every((j) => sp.alpha[j] !== 0 && sp.rgba[j] === MIDDAY_RAMP.rim);
      assert.ok(!block, `${s.kind} ${s.w}x${s.h}: a rim two pixels thick at ${x},${y}`);
    }
  }
  assert.ok(total > 200, `${total} rim pixels`);
});

test("nothing reddish: vermilion and gold belong to the flier and the landmarks", () => {
  for (const v of RAMP) {
    const [r, g] = rgb(v);
    assert.ok(r <= g + 16, `colour ${v.toString(16)}`);
  }
});
