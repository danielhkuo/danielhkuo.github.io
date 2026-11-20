import assert from "node:assert/strict";
import { test } from "node:test";
import { make, type Raw } from "../synth/make.ts";
import { emptyHearing, type Pose, type Prefs } from "../types.ts";
import { createEngine } from "./engine.ts";
import { FakeContext, fakeKit, type FakeNode } from "./fake.ts";
import type { Ctx } from "./graph.ts";
import type { Kit } from "./kit.ts";
import { NOISE_NAMES, NOISE_SOURCE, noiseOptions } from "./noise-worklet.ts";

// Noise made as it plays (design §14.8): the continuous beds' noises come from an AudioWorklet that never repeats,
// instead of from loops the page must copy in. Each is the kit's buffer of the same name as a sound: the same colour,
// level, filters and width. The bubbles and drops (sparse events) stay fresh loops.

const RATE = 48000;

/** The processor as the audio thread runs it: NOISE_SOURCE evaluated with stand-ins for the worklet scope. */
function processorClass(): new (o: { processorOptions: unknown; outputChannelCount?: number[] }) => { process(i: Float32Array[][], o: Float32Array[][], p: Record<string, Float32Array>): boolean; port: { onmessage: ((e: { data: unknown }) => void) | null } } {
  let made: unknown = null;
  const scope = {
    sampleRate: RATE,
    currentTime: 0,
    AudioWorkletProcessor: class {
      port = { onmessage: null as ((e: { data: unknown }) => void) | null, postMessage() {} };
    },
    registerProcessor(name: string, cls: unknown) {
      assert.equal(name, "fresh-noise");
      made = cls;
    },
  };
  new Function("sampleRate", "currentTime", "AudioWorkletProcessor", "registerProcessor", NOISE_SOURCE)(scope.sampleRate, scope.currentTime, scope.AudioWorkletProcessor, scope.registerProcessor);
  assert.ok(made, "the source registers its processor");
  return made as never;
}

/** `seconds` of a processor's output, channel by channel, in render quanta of 128. */
function play(name: string, seed: number, seconds: number): Float32Array[] {
  const Cls = processorClass();
  const o = noiseOptions(name, seed, RATE);
  const p = new Cls({ processorOptions: o, outputChannelCount: [o.channels] });
  const n = Math.floor((seconds * RATE) / 128) * 128;
  const out = Array.from({ length: o.channels }, () => new Float32Array(n));
  const block = Array.from({ length: o.channels }, () => new Float32Array(128));
  for (let at = 0; at < n; at += 128) {
    assert.ok(p.process([], [block], {}), "keeps playing");
    for (let c = 0; c < o.channels; c++) out[c].set(block[c], at);
  }
  return out;
}

const kit: Record<string, Raw> = { ...make("noise", 3, RATE), ...make("surf", 3, RATE) };

const rmsDb = (x: Float32Array) => 10 * Math.log10(x.reduce((a, v) => a + v * v, 0) / x.length);

function fft(re: Float64Array, im: Float64Array): void {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const step = (-2 * Math.PI) / len;
    for (let i = 0; i < n; i += len) {
      for (let k = 0; k < len / 2; k++) {
        const c = Math.cos(step * k), s = Math.sin(step * k);
        const a = i + k, b = a + len / 2;
        const tr = re[b] * c - im[b] * s, ti = re[b] * s + im[b] * c;
        re[b] = re[a] - tr;
        im[b] = im[a] - ti;
        re[a] += tr;
        im[a] += ti;
      }
    }
  }
}

/** Octave band energies from 62.5 Hz, dB, averaged over 4096-point Hann windows (an octave under that is three bins). */
function bands(x: Float32Array): number[] {
  const n = 4096, sum: number[] = [];
  const re = new Float64Array(n), im = new Float64Array(n);
  for (let at = 0; at + n <= x.length; at += n) {
    for (let i = 0; i < n; i++) {
      re[i] = (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / n)) * x[at + i];
      im[i] = 0;
    }
    fft(re, im);
    let band = 0;
    for (let lo = 62.5; lo < RATE / 2; lo *= 2, band++) {
      let e = 0;
      for (let f = 1; f < n / 2; f++) {
        const hz = (f * RATE) / n;
        if (hz >= lo && hz < 2 * lo) e += re[f] * re[f] + im[f] * im[f];
      }
      sum[band] = (sum[band] ?? 0) + e / Math.floor(x.length / n);
    }
  }
  return sum.map((e) => 10 * Math.log10(e + 1e-30));
}

const correlation = (a: Float32Array, b: Float32Array) => {
  let ab = 0, aa = 0, bb = 0;
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    ab += a[i] * b[i];
    aa += a[i] * a[i];
    bb += b[i] * b[i];
  }
  return ab / Math.sqrt(aa * bb + 1e-30);
};

test("the names made as they play: the wind's four layers and the beds' plain noises (not the bubbles or the drops)", () => {
  assert.deepEqual([...NOISE_NAMES].sort(), ["breeze", "brown0", "buffet", "hiss", "pink0", "rush", "velvet", "white0"]);
});

test("each noise is its kit buffer as a sound: the same channels, level, colour and width", () => {
  for (const name of NOISE_NAMES) {
    const ref = kit[name].channels;
    const got = play(name, 11, 6);
    assert.equal(got.length, ref.length, `${name}: channels`);
    for (let c = 0; c < ref.length; c++) {
      const d = rmsDb(got[c]) - rmsDb(ref[c]);
      assert.ok(Math.abs(d) < 0.3, `${name} channel ${c}: ${d.toFixed(2)} dB from the buffer`);
      const b0 = bands(ref[c]), b1 = bands(got[c]);
      const top = Math.max(...b0);
      for (let k = 0; k < b0.length; k++) if (b0[k] > top - 40) assert.ok(Math.abs(b1[k] - b0[k]) < 1, `${name} channel ${c} band ${k}: ${(b1[k] - b0[k]).toFixed(2)} dB`);
    }
    if (ref.length === 2) {
      const want = correlation(ref[0], ref[1]), have = correlation(got[0], got[1]);
      assert.ok(Math.abs(have - want) < 0.05, `${name}: channels correlate ${have.toFixed(3)} against ${want.toFixed(3)}`);
    }
    if (name === "velvet") {
      // The grain is a gain between about 0.36 and 1.
      for (const ch of got) for (const v of ch) assert.ok(v >= 0.35 && v <= 1.0001);
    }
  }
});

test("a seed gives the same noise every time, and another seed a noise of its own", () => {
  const a = play("rush", 5, 1), b = play("rush", 5, 1), c = play("rush", 6, 1);
  assert.deepEqual(a[0], b[0]);
  // (Over one second of pink noise, two independent draws correlate up to about ±0.1 by chance.)
  assert.ok(Math.abs(correlation(a[0], c[0])) < 0.15);
  assert.ok(Math.abs(correlation(a[1], c[1])) < 0.15);
});

test("nothing comes round: over twenty seconds no 80 ms window of the noise is found again", () => {
  for (const name of ["pink0", "buffet", "white0"]) {
    const x = play(name, 9, 20)[0];
    const w = Math.round(0.08 * RATE);
    // Windows a fixed lag apart, for every lag a loop of a few seconds would have: none lines up.
    for (const lag of [4.855, 5.0, 5.46, 4.58, 4.396].map((s) => Math.round(s * RATE))) {
      let worst = 0;
      for (let at = 0; at + lag + w <= x.length; at += w) worst = Math.max(worst, Math.abs(correlation(x.subarray(at, at + w), x.subarray(at + lag, at + lag + w))));
      assert.ok(worst < 0.5, `${name} at lag ${lag}: ${worst.toFixed(2)}`);
    }
  }
});

test("told to end at a time, a noise is silent from then and lets the audio thread drop it", () => {
  const Cls = processorClass();
  const o = noiseOptions("pink0", 3, RATE);
  const p = new Cls({ processorOptions: o, outputChannelCount: [o.channels] });
  const block = [new Float32Array(128), new Float32Array(128)];
  assert.ok(p.process([], [block], {}));
  // The end is told by message, in context time; the processor reads the scope's currentTime.
  p.port.onmessage?.({ data: { end: -1 } });
  const alive = p.process([], [block], {});
  assert.equal(alive, false);
  assert.ok(block[0].every((v) => v === 0) && block[1].every((v) => v === 0));
});

// ── In the engine ───────────────────────────────────────────────────────────────────────────────────────────────────

const PREFS: Prefs = { volume: 0.7, headphones: false, calm: false, touch: false };

/** A FakeContext that can make worklet nodes (recorded as nodes of kind "worklet", with the messages sent them). */
function workletContext() {
  const ctx = new FakeContext();
  const posted: { node: FakeNode; data: unknown }[] = [];
  (globalThis as { AudioWorkletNode?: unknown }).AudioWorkletNode = class {
    constructor(c: FakeContext, name: string, opts: { processorOptions: { name: string }; outputChannelCount: number[] }) {
      const node = c.createGain();
      Object.assign(node, { kind: "worklet", processor: name, options: opts, port: { postMessage: (data: unknown) => posted.push({ node, data }) } });
      return node as unknown as object;
    }
  };
  return { ctx, posted };
}

test("in the engine, with the worklet loaded: the continuous beds play worklet noise, the bubbles and drops fresh loops", () => {
  const { ctx, posted } = workletContext();
  try {
    const engine = createEngine(ctx as unknown as Ctx, fakeKit() as unknown as Kit, { touch: false, seed: 3, noise: () => true });
    engine.enable(true);
    const h = emptyHearing();
    h.surf[0].e = 4;
    h.surf[0].d = 30;
    h.sea = 0.8;
    h.stream.e = 3;
    h.stream.d = 20;
    const fly = (from: number, seconds: number, rain: number) => {
      for (let k = 0; k < 60 * seconds; k++) {
        const t = from + k / 60;
        ctx.currentTime = t;
        const pose: Pose = { t, dt: 1 / 60, x: 0, y: 0, alt: 30, heading: 0, speed: 60, bank: 0, rest: 0, rain };
        engine.frame(pose, h, PREFS);
      }
    };
    fly(10, 10, 1);
    const worklets = ctx.nodes.filter((n) => n.kind === "worklet");
    const names = new Set(worklets.map((n) => (n.options as { processorOptions: { name: string } }).processorOptions.name));
    for (const name of ["buffet", "rush", "hiss", "breeze", "brown0", "pink0", "white0", "velvet"]) assert.ok(names.has(name), `${name} is worklet noise`);
    // No loop is read of those names (the falls, the moments and the waves' own velvet keep theirs: none here).
    const loops = ctx.nodes.filter((n) => n.kind === "bufferSource" && n.buffer && ["buffet", "rush", "hiss", "breeze"].includes(String((n.buffer as { name?: string }).name ?? "")));
    assert.equal(loops.length, 0);
    // The rain stops: two seconds under its floor and the bed is let go, its noises told to end.
    fly(20, 6, 0);
    const ended = posted.filter((p) => typeof (p.data as { end?: number }).end === "number");
    assert.ok(ended.length >= 2, `${ended.length} noises told to end`);
  } finally {
    delete (globalThis as { AudioWorkletNode?: unknown }).AudioWorkletNode;
  }
});

test("without the worklet (not loaded, or no audioWorklet), the beds read fresh loops as before", () => {
  const ctx = new FakeContext();
  const engine = createEngine(ctx as unknown as Ctx, fakeKit() as unknown as Kit, { touch: false, seed: 3, noise: () => false });
  engine.enable(true);
  for (let k = 0; k < 120; k++) {
    const t = 10 + k / 60;
    ctx.currentTime = t;
    engine.frame({ t, dt: 1 / 60, x: 0, y: 0, alt: 30, heading: 0, speed: 60, bank: 0, rest: 0 }, emptyHearing(), PREFS);
  }
  assert.equal(ctx.nodes.filter((n) => n.kind === "worklet").length, 0);
  assert.ok(ctx.nodes.some((n) => n.kind === "bufferSource" && n.loop));
});
