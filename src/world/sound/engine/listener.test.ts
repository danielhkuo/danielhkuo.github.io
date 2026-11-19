import assert from "node:assert/strict";
import { test } from "node:test";
import { latticeOf } from "../ear.ts";
import type { Pose } from "../types.ts";
import { remoteEar } from "./engine.ts";

interface Posted {
  t: number;
  rows: number;
  length: number;
}

/** A stand-in for the ear's worker: it records each pass and hands both buffers back at the start of the next frame. */
function fakeWorker(posted: Posted[], pending: (() => void)[]) {
  return class FakeWorker {
    onmessage: ((e: { data: unknown }) => void) | null = null;
    onerror: (() => void) | null = null;
    postMessage(m: { kind: string; bake: Uint32Array; heard: Float64Array; rect: { x: number; y: number; w: number; h: number }; t: number }) {
      if (m.kind !== "pass") return;
      posted.push({ t: m.t, rows: latticeOf(m.rect).rows, length: m.bake.length });
      const reply = { heard: m.heard, bake: m.bake };
      pending.push(() => this.onmessage?.({ data: reply }));
    }
    terminate() {}
  };
}

test("the ear in its worker keeps listening while the camera crosses rows of an odd-sized frame", () => {
  const posted: Posted[] = [];
  const pending: (() => void)[] = [];
  const saved = (globalThis as { Worker?: unknown }).Worker;
  (globalThis as { Worker?: unknown }).Worker = fakeWorker(posted, pending);
  try {
    const ear = remoteEar(512, null);
    assert.ok(ear);
    // 400 × 225: an odd height, so the lattice has 113 rows when the frame's first row is even and 112 when it is odd.
    const w = 400, h = 225;
    const bake = new Uint32Array(w * h);
    const pose: Pose = { t: 0, dt: 0, x: 0, y: 0, alt: 40, heading: 0, speed: 20, bank: 0, rest: 0 };
    // Ten seconds at 60 Hz, flying north: the frame's first row moves up a row every three frames.
    for (let f = 0; f < 600; f++) {
      for (const deliver of pending.splice(0)) deliver();
      pose.t = f / 60;
      pose.y = -f / 3;
      ear.step(pose, { bake, rect: { x: 0, y: Math.floor(-f / 3), w, h }, t: pose.t }, 0);
    }
    // A pass every tenth of a second or so (six frames of a sixtieth fall a hair short of one, so most take seven), all
    // the way through. Before buffers had room for both row counts, they ran out after ten passes.
    assert.ok(posted.length >= 85, `${posted.length} passes in ten seconds`);
    assert.ok(posted[posted.length - 1].t > 9.7, `the last pass began at ${posted[posted.length - 1].t.toFixed(2)} s`);
    // Both row counts were gathered, each into a buffer big enough for it.
    assert.deepEqual([...new Set(posted.map((p) => p.rows))].sort(), [112, 113]);
    for (const p of posted) assert.ok(p.length >= 200 * p.rows, `a ${p.length}-sample buffer for ${p.rows} rows`);
  } finally {
    (globalThis as { Worker?: unknown }).Worker = saved;
  }
});
