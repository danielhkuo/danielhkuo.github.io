import assert from "node:assert/strict";
import { test } from "node:test";
import { JOBS, make, remake } from "../synth/make.ts";
import { createKit, FRESH_SLICE, type KitWorker } from "./kit.ts";

// The kit's fresh generations (design §14.8): asked for by name, made off the thread (or in place), and adopted into a
// small ring of AudioBuffers a slice a step, like the rest of the kit; generation 0 is never written over.

function fakeBuffer(channels: number, length: number, rate: number) {
  const data = Array.from({ length: channels }, () => new Float32Array(length));
  const copies: number[] = [];
  return {
    numberOfChannels: channels, length, sampleRate: rate, duration: length / rate, data, copies,
    copyToChannel(src: Float32Array, c: number, at = 0) {
      copies.push(src.length);
      data[c].set(src, at);
    },
  } as unknown as AudioBuffer & { data: Float32Array[]; copies: number[] };
}

const RATE = 8000;

function inPlace() {
  let made = 0;
  const kit = createKit({ sampleRate: RATE, seed: 3, spawn: null, makeBuffer: (c, l, r) => (made++, fakeBuffer(c, l, r)) });
  while (kit.step());
  return { kit, made: () => made };
}

test("without a worker, a generation asked for is made in place and adopted a slice a step; generation 0 stays", () => {
  const { kit } = inPlace();
  const g0 = kit.buffer("pink0");
  assert.equal(kit.generation("pink0"), 0);
  assert.equal(kit.buffer("pink0", 0), g0);
  assert.ok(!kit.pending());
  kit.request("pink0", 1);
  assert.ok(kit.pending());
  assert.equal(kit.generation("pink0"), 0, "not before it is adopted");
  let steps = 0;
  while (kit.pending() && kit.step()) steps++;
  assert.ok(steps > 2, "more than one step");
  assert.equal(kit.generation("pink0"), 1);
  const g1 = kit.buffer("pink0", 1) as unknown as { data: Float32Array[]; copies: number[] };
  assert.deepEqual(g1.data[1], remake("pink0", 1, 3, RATE).channels[1]);
  assert.ok(Math.max(...g1.copies) <= FRESH_SLICE, "no copy longer than a fresh slice");
  assert.equal(kit.buffer("pink0"), g0, "buffer(name) is still generation 0: the falls and the moments keep it");
  assert.ok(kit.done());
});

test("asked for `now` (offline renders), a generation is adopted whole before request returns", () => {
  const { kit } = inPlace();
  kit.request("buffet", 1, true);
  assert.ok(!kit.pending());
  assert.equal(kit.generation("buffet"), 1);
  assert.deepEqual((kit.buffer("buffet", 1) as unknown as { data: Float32Array[] }).data[0], remake("buffet", 1, 3, RATE).channels[0]);
});

test("generations after the first take turns in three buffers: no allocation after the third, and the old are let go", () => {
  const { kit, made } = inPlace();
  const before = made();
  for (let g = 1; g <= 10; g++) {
    kit.request("white0", g, true);
    assert.equal(kit.generation("white0"), g);
  }
  assert.equal(made() - before, 3, "three buffers for ten generations");
  assert.ok(kit.buffer("white0", 10) && kit.buffer("white0", 9) && kit.buffer("white0", 8));
  assert.throws(() => kit.buffer("white0", 7), "written over");
  assert.ok(kit.buffer("white0", 0), "generation 0 is never written over");
  assert.throws(() => kit.request("white0", 10), "a generation is asked for once");
  assert.throws(() => kit.request("pink1", 1), "only the fresh names");
});

test("with a worker: a request goes to it, its answer is adopted in slices, and the worker is kept while generations are asked for", () => {
  const posted: unknown[] = [];
  let terminated = false;
  const w: KitWorker = { postMessage: (m) => posted.push(m), onmessage: null, onerror: null, terminate: () => void (terminated = true) };
  const kit = createKit({ sampleRate: RATE, seed: 3, spawn: () => w, makeBuffer: fakeBuffer });
  for (const job of JOBS) w.onmessage!({ data: { job, buffers: make(job, 3, RATE) } });
  while (kit.step());
  assert.ok(kit.done());
  assert.ok(!terminated, "the worker stays for the generations to come");
  kit.request("rush", 1);
  assert.deepEqual(posted[posted.length - 1], { remake: "rush", generation: 1, seed: 3, sampleRate: RATE });
  assert.ok(kit.pending());
  assert.ok(!kit.step() || kit.generation("rush") === 0, "nothing to adopt before the answer");
  w.onmessage!({ data: { remake: "rush", generation: 1, raw: remake("rush", 1, 3, RATE) } });
  while (kit.pending() && kit.step());
  assert.equal(kit.generation("rush"), 1);
  kit.dispose();
  assert.ok(terminated);
});

test("a worker that fails part way: the generation asked for is made in place instead", () => {
  const w: KitWorker = { postMessage() {}, onmessage: null, onerror: null, terminate() {} };
  const kit = createKit({ sampleRate: RATE, seed: 3, spawn: () => w, makeBuffer: fakeBuffer });
  for (const job of JOBS) w.onmessage!({ data: { job, buffers: make(job, 3, RATE) } });
  while (kit.step());
  kit.request("hiss", 1);
  w.onerror!(new Error("gone"));
  for (let i = 0; i < 1000 && kit.pending(); i++) kit.step();
  assert.equal(kit.generation("hiss"), 1);
});
