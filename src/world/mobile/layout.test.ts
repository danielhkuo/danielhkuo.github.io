import assert from "node:assert/strict";
import { test } from "node:test";
import { fitScale } from "../runtime/fit.ts";
import type { Circle, Rect } from "../controls/touch.ts";
import { EDGE_BUDGET, layoutControls, SIZES, SLOP, targetsOf, TOP_BAND, usableRect, type Hand, type Insets, type LayoutInput, type Platform } from "./layout.ts";
import { layerInsets, layerSize } from "./turned.ts";

interface Device {
  name: string;
  w: number;
  h: number;
  dpr: number;
  insets: Insets;
  platform: Platform;
}

const PHONE: Insets = { top: 0, right: 62, bottom: 20, left: 62 };
// Measured in the iOS 26.5 Simulator (iPhone 17) where marked; the rest from published sizes and insets.
const DEVICES: Device[] = [
  { name: "iPhone 17 Safari, one tab (measured)", w: 874, h: 338, dpr: 3, insets: PHONE, platform: "ios" },
  { name: "iPhone 17 Safari, tab bar (measured)", w: 874, h: 292, dpr: 3, insets: PHONE, platform: "ios" },
  { name: "iPhone 17 Home Screen app (measured)", w: 874, h: 402, dpr: 3, insets: PHONE, platform: "ios" },
  { name: "iPhone 17 Pro Max Safari", w: 956, h: 376, dpr: 3, insets: PHONE, platform: "ios" },
  { name: "iPhone 17e Safari", w: 844, h: 326, dpr: 3, insets: { top: 0, right: 47, bottom: 21, left: 47 }, platform: "ios" },
  { name: "iPhone Air Safari", w: 912, h: 356, dpr: 3, insets: { top: 0, right: 68, bottom: 29, left: 68 }, platform: "ios" },
  { name: "SE-sized Safari", w: 667, h: 321, dpr: 2, insets: { top: 0, right: 0, bottom: 0, left: 0 }, platform: "ios" },
  { name: "Pixel 7 fullscreen", w: 915, h: 412, dpr: 2.625, insets: { top: 0, right: 0, bottom: 0, left: 0 }, platform: "android" },
  { name: "360×800 Android fullscreen", w: 800, h: 360, dpr: 2, insets: { top: 0, right: 0, bottom: 0, left: 0 }, platform: "android" },
  { name: "iPad 11-inch fullscreen", w: 1194, h: 834, dpr: 2, insets: { top: 0, right: 0, bottom: 20, left: 0 }, platform: "ios" },
];

/** The 400×225 frame as the shared fitting places it today: a whole number of device pixels, centred. */
function letterbox(d: { w: number; h: number; dpr: number }) {
  const s = fitScale(d.w * d.dpr, d.h * d.dpr, 400, 225) / d.dpr;
  return { x: (d.w - 400 * s) / 2, y: (d.h - 225 * s) / 2, w: 400 * s, h: 225 * s };
}
const fill = (d: { w: number; h: number }) => ({ x: 0, y: 0, w: d.w, h: d.h });

function circleIn(c: Circle, r: Rect): boolean {
  return c.x - c.r >= r.x0 - 1e-9 && c.x + c.r <= r.x1 + 1e-9 && c.y - c.r >= r.y0 - 1e-9 && c.y + c.r <= r.y1 + 1e-9;
}
function overlap(a: Circle, b: Circle): boolean {
  return Math.hypot(a.x - b.x, a.y - b.y) < a.r + b.r;
}
function circleMeetsRect(c: Circle, r: Rect): boolean {
  const nx = Math.max(r.x0, Math.min(c.x, r.x1));
  const ny = Math.max(r.y0, Math.min(c.y, r.y1));
  return Math.hypot(c.x - nx, c.y - ny) < c.r;
}

function cases(): { label: string; input: LayoutInput }[] {
  const out: { label: string; input: LayoutInput }[] = [];
  for (const d of DEVICES) {
    for (const [fname, frame] of [["fill", fill(d)], ["letterbox", letterbox(d)]] as const) {
      for (const hand of ["right", "left"] as Hand[]) {
        for (const size of SIZES) {
          for (const land of [true, false]) {
            out.push({ label: `${d.name}, ${fname}, ${hand}, ${size}, land ${land}`, input: { width: d.w, height: d.h, insets: d.insets, platform: d.platform, hand, size, frame, land } });
          }
        }
      }
    }
  }
  return out;
}

test("every control sits inside the usable rectangle, with no two overlapping, on every device, hand and size", () => {
  for (const { label, input } of cases()) {
    const l = layoutControls(input);
    const u = l.usable;
    const drawn = [l.boost, l.brake, ...(l.land ? [l.land] : [])];
    for (const c of drawn) assert.ok(circleIn(c, u), `${label}: ${JSON.stringify(c)} outside ${JSON.stringify(u)}`);
    const rest: Circle = { x: l.rest.x, y: l.rest.y, r: l.ring };
    assert.ok(circleIn(rest, u), `${label}: the stick's rest ring is outside`);
    for (let i = 0; i < drawn.length; i++) {
      for (let j = i + 1; j < drawn.length; j++) assert.ok(!overlap(drawn[i], drawn[j]), `${label}: ${i} overlaps ${j}`);
      assert.ok(!overlap(drawn[i], rest), `${label}: a button overlaps the stick at rest`);
      // A finger in the cluster never puts the stick down.
      assert.ok(!circleMeetsRect({ ...drawn[i], r: drawn[i].r + SLOP }, l.zone), `${label}: a button's hit area meets the stick zone`);
    }
    assert.ok(l.zone.x1 > l.zone.x0 && l.zone.y1 > l.zone.y0, `${label}: an empty stick zone`);
    assert.ok(l.zone.y0 >= u.y0 + TOP_BAND, `${label}: the zone reaches the top band`);
  }
});

test("at full size or more, every drawn control is at least 44 px across; every hit area always is", () => {
  for (const { label, input } of cases()) {
    const l = layoutControls(input);
    const t = targetsOf(l);
    for (const c of [t.boost, t.brake, ...(t.land ? [t.land] : [])]) assert.ok(2 * c.r >= 44, `${label}: hit area ${2 * c.r}`);
    if (input.size >= 1 && input.frame.w === input.width) {
      for (const c of [l.boost, l.brake, ...(l.land ? [l.land] : [])]) assert.ok(2 * c.r >= 44, `${label}: ${2 * c.r} px across`);
    }
  }
});

test("left-handed is the exact mirror of right-handed", () => {
  for (const d of DEVICES) {
    const base = { width: d.w, height: d.h, insets: d.insets, platform: d.platform, size: 1, frame: fill(d), land: true };
    const r = layoutControls({ ...base, hand: "right" });
    const l = layoutControls({ ...base, hand: "left" });
    const mirror = (x: number) => r.usable.x0 + r.usable.x1 - x;
    assert.deepEqual(l.usable, r.usable);
    for (const k of ["boost", "brake", "land"] as const) {
      assert.equal(l[k]!.x, mirror(r[k]!.x), `${d.name} ${k}`);
      assert.equal(l[k]!.y, r[k]!.y);
    }
    assert.equal(l.rest.x, mirror(r.rest.x));
    assert.equal(l.zone.x0, mirror(r.zone.x1));
  }
});

test("the sides keep clear of the system back-gesture strips, and the bottom of the home bar", () => {
  for (const d of DEVICES) {
    const u = usableRect({ width: d.w, height: d.h, insets: d.insets, platform: d.platform, hand: "right", size: 1, frame: fill(d), land: false });
    assert.ok(u.x0 >= EDGE_BUDGET[d.platform] && d.w - u.x1 >= EDGE_BUDGET[d.platform], d.name);
    assert.ok(u.x0 >= d.insets.left + 16 && d.w - u.x1 >= d.insets.right + 16, d.name);
    assert.ok(d.h - u.y1 >= Math.max(24, d.insets.bottom + 16), d.name);
  }
});

test("Land joins the cluster above Boost only while a landmark is in reach", () => {
  const d = DEVICES[0];
  const base = { width: d.w, height: d.h, insets: d.insets, platform: d.platform, hand: "right" as Hand, size: 1, frame: fill(d) };
  assert.equal(layoutControls({ ...base, land: false }).land, null);
  const l = layoutControls({ ...base, land: true });
  assert.ok(l.land && l.land.y < l.boost.y);
});

test("played sideways on an upright phone, the turned layer lays out like a landscape screen", () => {
  // iPhone 17 Safari held upright: 402×714, no insets (measured). Turned, the layer is 714×402.
  const size = layerSize(402, 714, 90);
  assert.deepEqual(size, { w: 714, h: 402 });
  const l = layoutControls({ width: size.w, height: size.h, insets: layerInsets({ top: 0, right: 0, bottom: 0, left: 0 }, 90), platform: "ios", hand: "right", size: 1, frame: { x: 0, y: 0, ...size }, land: true });
  for (const c of [l.boost, l.brake, l.land!]) assert.ok(circleIn(c, l.usable));
  assert.equal(l.scale, 1);
});
