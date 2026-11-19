import assert from "node:assert/strict";
import { test } from "node:test";
import { JOBS, make } from "../synth/make.ts";
import { createKit, type KitWorker } from "./kit.ts";

/** A stand-in AudioBuffer that records what is copied into it. */
function fakeBuffer(channels: number, length: number, rate: number) {
  const data = Array.from({ length: channels }, () => new Float32Array(length));
  const copies: number[] = [];
  return {
    numberOfChannels: channels, length, sampleRate: rate, data, copies,
    copyToChannel(src: Float32Array, c: number, at = 0) {
      copies.push(src.length);
      data[c].set(src, at);
    },
  } as unknown as AudioBuffer & { data: Float32Array[]; copies: number[] };
}

test("without a worker the kit computes in place and adopts every buffer whole", () => {
  const kit = createKit({ sampleRate: 8000, seed: 3, spawn: null, makeBuffer: fakeBuffer });
  assert.ok(!kit.ready("noise"));
  assert.throws(() => kit.buffer("brown0"));
  let steps = 0;
  while (kit.step()) steps++;
  assert.ok(kit.done());
  assert.ok(steps > 20);
  const want = make("noise", 3, 8000).brown0;
  const got = kit.buffer("brown0") as unknown as { data: Float32Array[]; copies: number[]; sampleRate: number };
  assert.deepEqual(got.data[1], want.channels[1]);
  // No copy is longer than a slice.
  assert.ok(Math.max(...got.copies) <= 65536);
  assert.equal(kit.buffer("gust").sampleRate, 3000);
  assert.equal(kit.buffer("squall").numberOfChannels, 3);
  assert.ok(!kit.step(), "nothing left to do");
});

test("with a worker: jobs are asked for in order, adopted as they arrive, and wind's are ready before the rest", () => {
  const asked: string[] = [];
  const w: KitWorker = { postMessage: (m) => asked.push((m as { job: string }).job), onmessage: null, onerror: null, terminate() {} };
  const kit = createKit({ sampleRate: 8000, seed: 3, spawn: () => w, makeBuffer: fakeBuffer });
  assert.deepEqual(asked, [...JOBS]);
  assert.ok(!kit.step(), "nothing has arrived");
  w.onmessage!({ data: { job: "noise", buffers: make("noise", 3, 8000) } });
  while (kit.step());
  assert.ok(kit.ready("noise") && !kit.ready("controls") && !kit.done());
  w.onmessage!({ data: { job: "controls", buffers: make("controls", 3, 8000) } });
  w.onmessage!({ data: { job: "surf", buffers: make("surf", 3, 8000) } });
  w.onmessage!({ data: { job: "river", buffers: make("river", 3, 8000) } });
  w.onmessage!({ data: { job: "bells", buffers: make("bells", 3, 8000) } });
  w.onmessage!({ data: { job: "probe", buffers: make("probe", 3, 8000) } });
  while (kit.step());
  assert.ok(kit.done());
  assert.equal(kit.buffer("ir").numberOfChannels, 2);
  assert.equal(kit.buffer("ring40").numberOfChannels, 1);
  // Bytes that are not sound (the warp tile) are kept as they came.
  assert.equal(kit.bytes("warp").length, 65536);
  assert.equal(kit.buffer("env1").numberOfChannels, 4);
});

test("a worker that fails hands the rest to the main thread", () => {
  const w: KitWorker = { postMessage() {}, onmessage: null, onerror: null, terminate() {} };
  const kit = createKit({ sampleRate: 8000, seed: 3, spawn: () => w, makeBuffer: fakeBuffer });
  w.onmessage!({ data: { job: "noise", buffers: make("noise", 3, 8000) } });
  w.onerror!(new Error("gone"));
  while (kit.step());
  assert.ok(kit.done());
  const thrower = createKit({
    sampleRate: 8000, seed: 3, makeBuffer: fakeBuffer,
    spawn: () => {
      throw new Error("no workers here");
    },
  });
  while (thrower.step());
  assert.ok(thrower.done());
});
