import assert from "node:assert/strict";
import { test } from "node:test";
import { rngFor } from "../../core/rng.ts";
import { BROOK, bubbleBed, bubbleHz, FLOW, PLUNGE } from "./bubbles.ts";

test("the brook is single bubbles, most of them between 600 Hz and 3 kHz; the purl is many and higher; the plunge dense and low", () => {
  const stats = (o: typeof BROOK) => {
    const hz: number[] = [];
    let energyIn = 0, energy = 0;
    const bed = bubbleBed(o, 8000, rngFor(3, "bubbles-test"), (r, amp) => {
      const f = bubbleHz(r);
      hz.push(f);
      energy += amp * amp;
      if (f >= 600 && f <= 3000) energyIn += amp * amp;
    });
    hz.sort((a, b) => a - b);
    return { bed, count: hz.length, median: hz[hz.length >> 1], share: hz.filter((f) => f >= 600 && f <= 3000).length / hz.length, energyShare: energyIn / energy };
  };
  const brook = stats(BROOK), flow = stats(FLOW), plunge = stats(PLUNGE);
  assert.equal(brook.count, Math.round(BROOK.seconds * 60));
  assert.ok(brook.share > 0.7, `${(100 * brook.share).toFixed(0)} % of the brook's bubbles in 600 Hz–3 kHz`);
  assert.ok(brook.energyShare > 0.95);
  assert.ok(flow.median > brook.median && plunge.median < brook.median);
  // Levelled alike, and seamless (each bubble wraps round the loop).
  for (const s of [brook, flow]) {
    let s2 = 0;
    for (const v of s.bed) s2 += v * v;
    assert.ok(Math.abs(Math.sqrt(s2 / s.bed.length) - 0.1) < 1e-3);
  }
});
