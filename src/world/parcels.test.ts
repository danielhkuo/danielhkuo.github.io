import assert from "node:assert/strict";
import { test } from "node:test";
import type { CoverInput } from "./look/contract.ts";
import {
  AXIS, ELONGATION, FURROW_PERIOD, furrowAt, newParcel, parcelAt, RIVER_BANK, RIVER_REACH, SITE_H, SITE_W, type Parcel,
} from "./parcels.ts";

const N = 6400;
const HOME = [1, 0, 0, 0, 0, 0];

/** A cell of ground rising toward (gx, gy) at slope s. */
function cell(x: number, y: number, s = 0, gx = 0, gy = 1, over: Partial<CoverInput> = {}): CoverInput {
  return {
    x, y, e: 10, slope: s, northness: gy, westness: gx, hand: 5, moisture: 0.6, wind: 0.2, exposure: 0.5, debris: 0,
    rock: 1, region: HOME, water: 0, shore: 0, riverDx: 0, riverDy: 0, ...over,
  };
}

interface Shape {
  cells: number;
  /** Variances of the field's cells along x and y, and their covariance. */
  vx: number;
  vy: number;
  vxy: number;
}

/** Every field wholly inside a size × size patch of one kind of ground, by id. */
function fields(size: number, s: number, gx: number, gy: number, x0 = 1000, y0 = 2000): Map<number, Shape> {
  const sum = new Map<number, number[]>();
  const p = newParcel();
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      parcelAt(cell(x0 + x, y0 + y, s, gx, gy), N, p);
      let a = sum.get(p.id);
      if (!a) {
        a = [0, 0, 0, 0, 0, 0, 0];
        sum.set(p.id, a);
      }
      a[0]++; a[1] += x; a[2] += y; a[3] += x * x; a[4] += y * y; a[5] += x * y;
      if (x === 0 || y === 0 || x === size - 1 || y === size - 1) a[6] = 1;
    }
  }
  const out = new Map<number, Shape>();
  for (const [id, a] of sum) {
    if (a[6] === 1) continue;
    const mx = a[1] / a[0], my = a[2] / a[0];
    out.set(id, { cells: a[0], vx: a[3] / a[0] - mx * mx, vy: a[4] / a[0] - my * my, vxy: a[5] / a[0] - mx * my });
  }
  return out;
}

function mean(xs: number[]): number {
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

test("every cell belongs to a field; fields are whole, connected and of a farmable size", () => {
  const size = 400;
  const ids = new Int32Array(size * size);
  const p = newParcel();
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      parcelAt(cell(3000 + x, 500 + y, 0.02), N, p);
      assert.ok(Number.isInteger(p.id) && p.id >= 0 && p.id <= 0xffffffff);
      assert.ok(p.edge >= 0, `edge ${p.edge}`);
      assert.ok(p.single === 0 || p.single === 1);
      assert.equal(p.bank, 0);
      ids[y * size + x] = p.id | 0;
    }
  }
  // Flood each field from one of its cells: a field in more than one piece would leave cells behind.
  const seen = new Uint8Array(size * size);
  const pieces = new Map<number, number>();
  const stack: number[] = [];
  for (let start = 0; start < size * size; start++) {
    if (seen[start]) continue;
    pieces.set(ids[start], (pieces.get(ids[start]) ?? 0) + 1);
    seen[start] = 1;
    stack.push(start);
    while (stack.length) {
      const i = stack.pop() as number;
      const x = i % size, y = (i - x) / size;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const xx = x + dx, yy = y + dy;
        if (xx < 0 || yy < 0 || xx >= size || yy >= size) continue;
        const k = yy * size + xx;
        if (!seen[k] && ids[k] === ids[start]) {
          seen[k] = 1;
          stack.push(k);
        }
      }
    }
  }
  let split = 0;
  for (const count of pieces.values()) if (count > 1) split++;
  assert.ok(split <= pieces.size * 0.03, `${split} of ${pieces.size} fields are in pieces`);

  const whole = [...fields(size, 0.02, 0, 1, 3000, 500).values()];
  assert.ok(whole.length >= 20, `${whole.length} whole fields`);
  const area = mean(whole.map((f) => f.cells));
  assert.ok(area > 0.8 * SITE_W * SITE_H && area < 5 * SITE_W * SITE_H, `mean field ${area} cells`);
  for (const f of whole) assert.ok(f.cells >= 40, `a field of ${f.cells} cells`);
});

test("fields lie along the contour: long across the fall line, short up and down it", () => {
  // Ground rising to the south: contours run west–east.
  const south = [...fields(500, 0.14, 0, 1).values()];
  const ratioS = mean(south.map((f) => Math.sqrt(f.vx / f.vy)));
  assert.ok(ratioS > 1.5, `fields on a south slope are ${ratioS.toFixed(2)} × as wide as deep`);
  // Ground rising to the east: contours run north–south.
  const east = [...fields(500, 0.14, 1, 0).values()];
  const ratioE = mean(east.map((f) => Math.sqrt(f.vy / f.vx)));
  assert.ok(ratioE > 1.5, `fields on an east slope are ${ratioE.toFixed(2)} × as deep as wide`);
  // Ground rising to the south-east: contours run from south-west to north-east, so x and y fall together.
  const r = Math.SQRT1_2;
  const diagonal = [...fields(500, 0.14, r, r).values()];
  const lean = mean(diagonal.map((f) => f.vxy / Math.sqrt(f.vx * f.vy)));
  assert.ok(lean < -0.3, `fields on a south-east slope lean ${lean.toFixed(2)}`);
  // Flat ground: no favoured direction.
  const flat = [...fields(500, 0, 0, 1).values()];
  const ratioF = mean(flat.map((f) => Math.sqrt(f.vx / f.vy)));
  assert.ok(ratioF > 0.75 && ratioF < 1.35, `flat fields are ${ratioF.toFixed(2)} × as wide as deep`);
  assert.ok(ELONGATION > 1.5);
  // The stretch needs the fall line's x-part; a caller that leaves it out gets round fields.
  const sums = new Map<number, number[]>();
  const p = newParcel();
  for (let y = 0; y < 400; y++) {
    for (let x = 0; x < 400; x++) {
      const c = cell(x, y, 0.14, 0, 1);
      delete c.westness;
      const id = parcelAt(c, N, p).id;
      let t = sums.get(id);
      if (!t) {
        t = [0, 0, 0, 0, 0, 0];
        sums.set(id, t);
      }
      t[0]++; t[1] += x; t[2] += y; t[3] += x * x; t[4] += y * y;
      if (x === 0 || y === 0 || x === 399 || y === 399) t[5] = 1;
    }
  }
  const blind: number[] = [];
  for (const t of sums.values()) {
    if (t[5] === 1) continue;
    const mx = t[1] / t[0], my = t[2] / t[0];
    blind.push(Math.sqrt((t[3] / t[0] - mx * mx) / (t[4] / t[0] - my * my)));
  }
  assert.ok(mean(blind) < 1.35, `without westness fields are ${mean(blind).toFixed(2)} × as wide as deep`);
});

test("fields are bigger on flat valley floors, smaller and more irregular on slopes", () => {
  const flat = [...fields(700, 0.01, 0, 1).values()];
  const slope = [...fields(700, 0.14, 0, 1).values()];
  const flatArea = mean(flat.map((f) => f.cells));
  const slopeArea = mean(slope.map((f) => f.cells));
  assert.ok(flatArea > 1.4 * slopeArea, `flat ${flatArea.toFixed(0)} cells, slope ${slopeArea.toFixed(0)}`);
  assert.ok(slope.length > flat.length);
  // Irregular: sizes vary by more than a third of their mean in both.
  for (const set of [flat, slope]) {
    const m = mean(set.map((f) => f.cells));
    const sd = Math.sqrt(mean(set.map((f) => (f.cells - m) * (f.cells - m))));
    assert.ok(sd / m > 0.2, `field sizes vary by ${(sd / m).toFixed(2)}`);
  }
});

test("boundaries wander: warped, not the straight edges of a plain Voronoi diagram", () => {
  // Walk rows and note where the field changes; along a straight edge those crossings move by a constant step.
  const p = newParcel();
  let bends = 0;
  let edges = 0;
  for (let x0 = 0; x0 < 2000; x0 += 97) {
    const cross: number[] = [];
    for (let y = 0; y < 40; y++) {
      let prev = parcelAt(cell(x0, 4000 + y, 0), N, p).id;
      for (let x = 1; x < 60; x++) {
        const id = parcelAt(cell(x0 + x, 4000 + y, 0), N, p).id;
        if (id !== prev) {
          cross.push(x);
          break;
        }
        prev = id;
      }
    }
    if (cross.length < 30) continue;
    edges++;
    const steps = new Set<number>();
    for (let i = 1; i < cross.length; i++) steps.add(cross[i] - cross[i - 1]);
    if (steps.size > 3) bends++;
  }
  assert.ok(edges >= 5 && bends >= edges * 0.5, `${bends} of ${edges} edges bend`);
});

test("a river is a field boundary: its two banks are never the same field", () => {
  // A river down column 3000: cells to its west see it to the east, and so on.
  const p = newParcel();
  const q = newParcel();
  const at = (x: number, y: number, out: Parcel): Parcel => {
    const d = x - 3000;
    const near = d !== 0 && Math.abs(d) < RIVER_REACH;
    return parcelAt(cell(x, y, 0.02, 0, 1, { riverDx: near ? d : 0, riverDy: 0 }), N, out);
  };
  for (let y = 0; y < 1500; y++) {
    for (let d = 1; d < RIVER_BANK; d++) {
      const west = at(3000 - d, y, p);
      const east = at(3000 + d, y, q);
      assert.notEqual(west.id, east.id, `row ${y}: one field on both banks`);
      assert.ok(west.bank !== 0 && east.bank !== 0 && west.bank !== east.bank);
    }
    assert.equal(at(3000 - 9, y, p).bank, 0);
  }

  // Boundaries do not cross: where a hedge meets one bank, no hedge leaves the other bank opposite it.
  // Without the river the same two columns are cut by the same hedges at the same rows.
  const cuts = (x: number, river: boolean): number[] => {
    const rows: number[] = [];
    let prev = -1;
    for (let y = 0; y < 6000; y++) {
      const id = river ? at(x, y, p).id : parcelAt(cell(x, y, 0.02), N, p).id;
      if (y > 0 && id !== prev) rows.push(y);
      prev = id;
    }
    return rows;
  };
  const facing = (west: number[], east: number[]): number => {
    let met = 0;
    for (const y of west) if (east.some((v) => Math.abs(v - y) <= 2)) met++;
    return met / west.length;
  };
  const plain = facing(cuts(2999, false), cuts(3001, false));
  const torn = facing(cuts(2999, true), cuts(3001, true));
  assert.ok(plain > 0.7, `with no river ${plain.toFixed(2)} of hedges run straight on`);
  assert.ok(torn < 0.4 && torn < plain * 0.5, `${torn.toFixed(2)} of hedges face one another across the river`);

  // A west–east river splits north from south the same way.
  for (let x = 0; x < 600; x++) {
    const north = parcelAt(cell(x, 2999, 0.02, 0, 1, { riverDx: 0, riverDy: -1 }), N, p);
    const south = parcelAt(cell(x, 3001, 0.02, 0, 1, { riverDx: 0, riverDy: 1 }), N, q);
    assert.notEqual(north.id, south.id);
  }
});

test("the lookup is continuous where the river's reach ends: no seam eight cells from the water", () => {
  const p = newParcel();
  let changes = 0;
  for (let y = 0; y < 2000; y++) {
    const inside = parcelAt(cell(3000 + RIVER_REACH - 1, y, 0.02, 0, 1, { riverDx: RIVER_REACH - 0.01, riverDy: 0 }), N, p).id;
    const outside = parcelAt(cell(3000 + RIVER_REACH - 1, y, 0.02), N, p).id;
    if (inside !== outside) changes++;
  }
  assert.equal(changes, 0);
});

test("parcels are a pure function of the cell and tile on the world", () => {
  const p = newParcel();
  const q = newParcel();
  for (const n of [N, 1024, 2048]) {
    for (let i = 0; i < 3000; i++) {
      const x = (i * 131) % n, y = (i * 373) % n;
      const s = (i % 5) * 0.03, gx = ((i % 7) - 3) / 3.5, gy = Math.sqrt(1 - gx * gx);
      const c = Object.freeze(cell(x, y, s, gx, gy));
      parcelAt(c, n, p);
      parcelAt(c, n, q);
      assert.deepEqual(q, p);
      for (const [dx, dy] of [[n, 0], [0, n], [-n, -n]]) {
        parcelAt(cell(x + dx, y + dy, s, gx, gy), n, q);
        assert.equal(q.id, p.id);
        assert.ok(Math.abs(q.edge - p.edge) < 1e-6);
        assert.equal(q.axis, p.axis);
      }
    }
  }
  // The mask's period is not the parcels' period.
  let same = 0;
  for (let i = 0; i < 400; i++) {
    if (parcelAt(cell(i * 37, i * 91), N, p).id === parcelAt(cell(i * 37 + 256, i * 91), N, q).id) same++;
  }
  assert.ok(same < 8);
});

test("furrows run along the contour on a slope, and one way per field on the flat", () => {
  const p = newParcel();
  const r = Math.SQRT1_2;
  assert.equal(parcelAt(cell(10, 10, 0.12, 0, 1), N, p).axis, AXIS.east);
  assert.equal(parcelAt(cell(10, 10, 0.12, 0, -1), N, p).axis, AXIS.east);
  assert.equal(parcelAt(cell(10, 10, 0.12, 1, 0), N, p).axis, AXIS.south);
  assert.equal(parcelAt(cell(10, 10, 0.12, -1, 0), N, p).axis, AXIS.south);
  // Rising to the south-east, the contour runs north-east; rising to the north-east, south-east.
  assert.equal(parcelAt(cell(10, 10, 0.12, r, r), N, p).axis, AXIS.northEast);
  assert.equal(parcelAt(cell(10, 10, 0.12, r, -r), N, p).axis, AXIS.southEast);
  // Flat ground: the axis is the field's own, the same over the whole field, and fields differ.
  const byField = new Map<number, number>();
  for (let y = 0; y < 300; y++) {
    for (let x = 0; x < 300; x++) {
      parcelAt(cell(x, y, 0.01), N, p);
      if (byField.has(p.id)) assert.equal(byField.get(p.id), p.axis);
      else byField.set(p.id, p.axis);
    }
  }
  assert.ok(new Set(byField.values()).size >= 3);
});

test("furrow lines are counted in screen pixels, so the camera's row squeeze never drops or doubles one", () => {
  // The camera draws world row y on screen row floor(0.8 y); one world row in five shares its screen row.
  for (const period of [2, 4, 5, 8]) {
    const rowsWithLine = new Set<number>();
    for (let y = 0; y < 3000; y++) {
      const screen = Math.floor(0.8 * y);
      const line = furrowAt(123, y, AXIS.east) % period === 0;
      // Two world rows on one screen row agree, so the painter cannot overwrite a line with a gap.
      if (y > 0 && Math.floor(0.8 * (y - 1)) === screen) {
        assert.equal(furrowAt(123, y - 1, AXIS.east) % period === 0, line);
      }
      if (line) rowsWithLine.add(screen);
    }
    // Exactly every period-th screen row carries a line: an even comb, no beat.
    for (let r = 0; r < 2400; r++) assert.equal(rowsWithLine.has(r), r % period === 0, `period ${period}, screen row ${r}`);
  }
  // Along y and on the diagonals a line is one pixel wide and unbroken on screen.
  for (let y = 0; y < 500; y++) {
    assert.equal(furrowAt(77, y, AXIS.south), 77 % FURROW_PERIOD);
    const row = Math.floor(0.8 * y);
    assert.equal(furrowAt(200 + row, y, AXIS.southEast), 200 % FURROW_PERIOD);
    assert.equal(furrowAt(900 - row, y, AXIS.northEast), 900 % FURROW_PERIOD);
  }
  for (const axis of Object.values(AXIS)) {
    for (let i = 0; i < 2000; i++) {
      const u = furrowAt(i * 7 - 5000, i * 13 - 3000, axis);
      assert.ok(Number.isInteger(u) && u >= 0 && u < FURROW_PERIOD);
    }
  }
  for (const period of [2, 4, 5, 8]) assert.equal(FURROW_PERIOD % period, 0);
  // Furrows meet themselves across the seam of the 6400 world: 6400 cells and 5120 screen rows round.
  assert.equal(6400 % FURROW_PERIOD, 0);
  assert.equal(5120 % FURROW_PERIOD, 0);
  for (const axis of Object.values(AXIS)) {
    for (let i = 0; i < 200; i++) assert.equal(furrowAt(i * 31 + 6400, i * 17 + 6400, axis), furrowAt(i * 31, i * 17, axis));
  }
});
