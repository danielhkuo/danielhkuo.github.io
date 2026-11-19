import assert from "node:assert/strict";
import { test } from "node:test";
import { copyHearing, emptyHearing, HEARING_FLOATS, packHearing, pooledHearing, unpackHearing } from "./types.ts";

test("a Hearing packed as numbers and unpacked is the same Hearing, and unpacking allocates no shore points", () => {
  const h = emptyHearing(12.5);
  h.ready = 0.9;
  h.lanes = 0b1010_0001;
  h.sea = 0.4;
  h.surf[0] = { e: 3, dx: 2, dy: -1, d: 80 };
  h.surf[2] = { e: 1, dx: 0, dy: 1, d: 40 };
  h.far = { e: 5, dx: -4, dy: 0, d: 300 };
  for (let i = 0; i < 5; i++) h.shores.push({ sector: i, cell: -123456789 + i, kind: (i % 4) as 0 | 1 | 2 | 3, bend: 17 * i, x: 5000.5 + i, y: 4000 - i, w: 1 / (i + 1) });
  const packed = new Float64Array(HEARING_FLOATS);
  packHearing(h, packed);
  const held = pooledHearing();
  const back = unpackHearing(packed, held);
  assert.deepEqual(copyHearing(back), copyHearing(h));
  // Again with fewer points: the same objects are reused.
  const first = back.shores[0];
  h.shores.length = 2;
  packHearing(h, packed);
  unpackHearing(packed, held);
  assert.equal(held.hearing.shores.length, 2);
  assert.equal(held.hearing.shores[0], first);
});
