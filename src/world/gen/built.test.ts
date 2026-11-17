import assert from "node:assert/strict";
import { test } from "node:test";
import {
  type Conform, conformed, conformGrid, conformsIn, conformWeight, emptyBuilt, imageOffset, indexBuilt, structuresIn,
} from "./built.ts";
import { sculpt } from "./structures.ts";

const flat = (over: Partial<Conform> = {}): Conform => ({ kind: "flat", x: 100, y: 100, rx: 15, ry: 12, round: false, level: 20, skirt: 8, limit: 3, ...over });

test("a pad is level inside, fades over a smoothstep skirt, and never cuts or fills more than its limit", () => {
  const c = flat();
  assert.equal(conformWeight(c, 0, 0), 1);
  assert.equal(conformWeight(c, 15, -12), 1);
  assert.equal(conformWeight(c, 15 + 8, 0), 0);
  assert.equal(conformWeight(c, 15 + 4, 0), 0.5);
  assert.ok(conformWeight(c, 17, 0) > conformWeight(c, 21, 0));
  // Within the limit the pad is exactly level.
  for (const h of [17.5, 20, 22.9]) assert.equal(conformed(c, h, 3, -4), 20);
  // Beyond it the ground moves by the limit and no more.
  assert.equal(conformed(c, 10, 0, 0), 13);
  assert.equal(conformed(c, 31, 0, 0), 28);
  // Outside the skirt nothing changes; inside it the change is partial.
  assert.equal(conformed(c, 22, 40, 0), 22);
  const part = conformed(c, 22, 19, 0);
  assert.ok(part < 22 && part > 20);
  // A round pad measures its skirt from the ellipse.
  const r = flat({ round: true, rx: 10, ry: 10 });
  assert.equal(conformWeight(r, 7, 7), 1);
  assert.ok(conformWeight(r, 8, 8) < 1 && conformWeight(r, 8, 8) > 0);
});

test("terraces step the ground by 2–3 units and leave the beach alone; the harbour is cut, the quay built up", () => {
  const t: Conform = { kind: "terrace", x: 0, y: 0, rx: 50, ry: 50, round: true, level: 1.8, skirt: 10, limit: 2.5 };
  const steps = new Set<number>();
  for (let h = 1.3; h < 30; h += 0.07) {
    const v = conformed(t, h, 0, 0);
    assert.ok(Math.abs(v - h) <= 1.25 + 1e-9, `moved ${v - h} at ${h}`);
    steps.add(Math.round(v * 100));
  }
  const levels = [...steps].sort((a, b) => a - b);
  for (let k = 1; k < levels.length; k++) assert.equal(levels[k] - levels[k - 1], 250);
  assert.equal(conformed(t, 0.6, 0, 0), 0.6);
  assert.equal(conformed(t, -4, 0, 0), -4);

  const d: Conform = { kind: "dredge", x: 0, y: 0, rx: 30, ry: 10, round: false, level: -3, skirt: 3, limit: 0 };
  assert.equal(conformed(d, -1, 0, 0), -3);
  assert.equal(conformed(d, 2, 0, 0), -3);
  assert.equal(conformed(d, -9, 0, 0), -9);
  const q: Conform = { kind: "raise", x: 0, y: 0, rx: 30, ry: 5, round: false, level: 1.8, skirt: 1.5, limit: 0 };
  assert.ok(Math.abs(conformed(q, 0.2, 0, 0) - 1.8) < 1e-9);
  assert.ok(Math.abs(conformed(q, -3, 0, 0) - 1.8) < 1e-9);
  assert.equal(conformed(q, 5, 0, 0), 5);
});

test("conforms apply to a torus grid across its seam", () => {
  const gN = 64, h = new Float64Array(gN * gN).fill(10);
  conformGrid(h, gN, 4, [flat({ x: 2, y: 254, rx: 10, ry: 10, level: 12, skirt: 0 })]);
  assert.equal(h[63 * gN + 0], 12);
  assert.equal(h[0 * gN + 63], 12);
  assert.equal(h[1 * gN + 1], 12);
  assert.equal(h[10 * gN + 10], 10);
  let changed = 0;
  for (const v of h) if (v !== 10) changed++;
  assert.equal(changed, 25);
});

test("the index returns everything that touches a rectangle, once, in order, across the seam", () => {
  const b = emptyBuilt();
  const at = (x: number, y: number, w: number, h: number) => {
    const s = sculpt(w, h);
    s.x = x;
    s.y = y;
    b.structures.push(s);
  };
  at(10, 10, 8, 8);
  at(1020, 500, 10, 5); // straddles the east seam of a 1024 world
  at(300, 300, 130, 70); // spans several buckets
  b.conforms.push(flat({ x: 5, y: 5 }));
  const ix = indexBuilt(b, 1024);
  assert.deepEqual(structuresIn(ix, 0, 0, 64, 64), [0]);
  assert.deepEqual(structuresIn(ix, 0, 480, 20, 520), [1]);
  assert.deepEqual(structuresIn(ix, 1000, 480, 1030, 520), [1]);
  assert.deepEqual(structuresIn(ix, -30, 480, -1, 520), [1]);
  assert.deepEqual(structuresIn(ix, 0, 0, 1024, 1024), [0, 1, 2]);
  assert.deepEqual(structuresIn(ix, 390, 330, 400, 340), [2]);
  assert.deepEqual(structuresIn(ix, 600, 600, 700, 700), []);
  // The pad reaches across the north-west corner.
  assert.deepEqual(conformsIn(ix, 1000, 1000, 1024, 1024), [0]);
  // Where a thing lands in a window's frame, whichever world period the window is in.
  assert.equal(imageOffset(1020, 10, 1000, 1024), 20);
  assert.equal(imageOffset(1020, 10, 0, 1024), -4);
  assert.equal(imageOffset(1020, 10, 1024 * 3, 1024), -4);
  assert.equal(imageOffset(10, 8, -1024 + 5, 1024), 5);
});
