import assert from "node:assert/strict";
import { test } from "node:test";
import { makeShapes, SHAPE_COUNTS, SHAPE_SIZES, type CloudShape } from "./shapes.ts";

let memo: CloudShape[] | null = null;
/** Built on first use, so the test runner can list these tests before the shapes exist. */
const all = (): CloudShape[] => (memo ??= makeShapes(7, SHAPE_COUNTS));
const of = (kind: CloudShape["kind"]) => all().filter((s) => s.kind === kind);
/** Pixels per row with cover over 0.5. */
const rowWidths = (s: CloudShape) => Array.from({ length: s.h }, (_, y) => {
  let k = 0;
  for (let x = 0; x < s.w; x++) if (s.cover[y * s.w + x] > 0.5) k++;
  return k;
});

test("the same seed gives the same shapes, another seed others", () => {
  assert.deepEqual(makeShapes(7, SHAPE_COUNTS), all());
  assert.notDeepEqual(makeShapes(8, SHAPE_COUNTS), all());
});

test("shapes come in the asked counts, ordered by kind", () => {
  const kinds = all().map((s) => s.kind);
  const want = [
    ...Array(SHAPE_COUNTS.heap).fill("heap"), ...Array(SHAPE_COUNTS.wisp).fill("wisp"),
    ...Array(SHAPE_COUNTS.bank).fill("bank"), ...Array(SHAPE_COUNTS.streak).fill("streak"),
  ];
  assert.deepEqual(kinds, want);
  assert.equal(makeShapes(1, { heap: 2, wisp: 0, bank: 1, streak: 0 }).length, 3);
});

test("sizes lie inside their ranges, and every value is 0–1", () => {
  for (const s of all()) {
    const r = SHAPE_SIZES[s.kind];
    assert.ok(s.w >= r.w[0] && s.w <= r.w[1], `${s.kind} w ${s.w}`);
    assert.ok(s.h >= r.h[0] && s.h <= r.h[1], `${s.kind} h ${s.h}`);
    assert.equal(s.cover.length, s.w * s.h);
    assert.equal(s.dome.length, s.w * s.h);
    for (let i = 0; i < s.cover.length; i++) {
      assert.ok(s.cover[i] >= 0 && s.cover[i] <= 1 && s.dome[i] >= 0 && s.dome[i] <= 1);
    }
  }
});

test("nothing touches the box's edge, so no cloud is cut off square", () => {
  for (const s of all()) {
    for (let x = 0; x < s.w; x++) assert.equal(s.cover[x] + s.cover[(s.h - 1) * s.w + x], 0, `${s.kind} top/bottom`);
    for (let y = 0; y < s.h; y++) assert.equal(s.cover[y * s.w] + s.cover[y * s.w + s.w - 1], 0, `${s.kind} sides`);
  }
});

test("heaps and banks are solid enough to read as cloud", () => {
  for (const s of [...of("heap"), ...of("bank")]) {
    let k = 0;
    for (const c of s.cover) if (c > 0.5) k++;
    assert.ok(k >= 0.25 * s.w * s.h, `${s.kind} ${s.w}x${s.h}: ${k} solid pixels`);
  }
});

test("a heap sits on a flat base under a rounded top", () => {
  for (const s of of("heap")) {
    const widths = rowWidths(s);
    const widest = Math.max(...widths);
    const filled = widths.map((w, y) => (w > 0 ? y : -1)).filter((y) => y >= 0);
    const top = filled[0], bottom = filled[filled.length - 1];
    assert.ok(widths[bottom] >= 0.5 * widest, `base ${widths[bottom]} of ${widest}`);
    assert.ok(widths[top] < 0.5 * widest, `top ${widths[top]} of ${widest}`);
  }
});

test("wisps and streaks are long and thin", () => {
  for (const s of [...of("wisp"), ...of("streak")]) assert.ok(s.w >= 4 * s.h, `${s.kind} ${s.w}x${s.h}`);
});

test("the dome is zero off the cloud and peaks inside it", () => {
  for (const s of all()) {
    let peak = -1, at = -1;
    for (let i = 0; i < s.dome.length; i++) {
      if (s.cover[i] === 0) assert.equal(s.dome[i], 0, `${s.kind} dome off the cloud`);
      if (s.dome[i] > peak) { peak = s.dome[i]; at = i; }
    }
    assert.ok(peak > 0, `${s.kind} has a dome`);
    assert.ok(s.cover[at] > 0.5, `${s.kind} peaks on solid cloud`);
  }
});

test("no two shapes of a kind are the same", () => {
  for (const kind of ["heap", "wisp", "bank", "streak"] as const) {
    const keys = of(kind).map((s) => `${s.w}x${s.h}:${Array.from(s.cover.subarray(0, 400)).join(",")}`);
    assert.equal(new Set(keys).size, keys.length, kind);
  }
});
