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

test("the brain in the ear's worker: its answer rides home with the Hearing; answers from before a mute are dropped", async () => {
  // The worker's own code, run here: `self` stands in for its scope, and a stand-in Worker carries the messages each
  // way; the worker's replies wait until the test delivers them.
  const inbox: { onmessage: ((e: { data: unknown }) => void) | null; postMessage(m: unknown): void } = { onmessage: null, postMessage() {} };
  const savedSelf = (globalThis as { self?: unknown }).self, savedWorker = (globalThis as { Worker?: unknown }).Worker;
  (globalThis as { self?: unknown }).self = inbox;
  const toPage: unknown[] = [];
  const asked: { brain?: { t: number; epoch: number; surf: boolean; look: number } | null }[] = [];
  class Wire {
    onmessage: ((e: { data: unknown }) => void) | null = null;
    onerror: (() => void) | null = null;
    postMessage(m: { kind?: string; brain?: { t: number; epoch: number; surf: boolean; look: number } | null }) {
      // (The pass's ask is cloned as a message would clone it: the page goes on writing to its own.)
      if (m.kind === "pass") {
        m = { ...m, brain: m.brain ? { ...m.brain } : m.brain };
        asked.push(m);
      }
      inbox.onmessage?.({ data: m });
    }
    terminate() {}
  }
  let wire: Wire | null = null;
  (globalThis as { Worker?: unknown }).Worker = class extends Wire {
    constructor() {
      super();
      // eslint-disable-next-line @typescript-eslint/no-this-alias
      wire = this;
    }
  };
  inbox.postMessage = (m) => toPage.push(m);
  const deliver = () => {
    for (const m of toPage.splice(0)) wire?.onmessage?.({ data: m });
  };
  try {
    await import("../ear.worker.ts");
    const ear = remoteEar(512, null);
    assert.ok(ear?.brain);
    const brain = ear.brain({ seed: 3, n: 512, touch: false, forced: false, colonies: [], railway: null });
    assert.ok(brain.alive());
    brain.source("bell");
    brain.ask.look = 0.25;
    brain.ask.surf = true;
    const w = 400, h = 225;
    const bake = new Uint32Array(w * h);
    const pose: Pose = { t: 12, dt: 0, x: 0, y: 0, alt: 40, heading: 0, speed: 20, bank: 0, rest: 0 };
    // Frames at 60 Hz until a pass has gone out: the ask goes with it, at the dragon's place and time as it is sent.
    const frames = (seconds: number) => {
      for (let f = 0; f < seconds * 60; f++) {
        pose.t += 1 / 60;
        ear.step(pose, { bake, rect: { x: 0, y: 0, w, h }, t: pose.t }, 0);
      }
    };
    assert.equal(brain.take(), null);
    frames(0.2);
    assert.ok(asked.length >= 1 && asked[0].brain, "the pass carries the ask");
    assert.ok(Math.abs((asked[0].brain?.t ?? 0) - 12.1167) < 0.02 && asked[0].brain?.surf === true);
    assert.equal(brain.take(), null, "not before the answer arrives");
    deliver();
    const first = brain.take();
    assert.ok(first, "an answer");
    // Into the peal the bells' source, just joined, finds the rings already sounding.
    assert.ok((first.due ?? []).some((d) => d.rejoin));
    // An ask whose answer is still on its way when the sound is muted: the answer is to something already stopped.
    while (brain.take());
    frames(0.15);
    brain.clear();
    deliver();
    assert.equal(brain.take(), null, "dropped");
    frames(0.25);
    deliver();
    let rejoined = false;
    for (let r = brain.take(); r; r = brain.take()) rejoined ||= (r.due ?? []).some((d) => d.rejoin);
    assert.ok(rejoined, "after the clear, what is sounding is joined again");
  } finally {
    (globalThis as { self?: unknown }).self = savedSelf;
    (globalThis as { Worker?: unknown }).Worker = savedWorker;
  }
});
