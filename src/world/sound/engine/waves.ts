// Wave emitters (design §4.3): each wave is its own emitter, fixed where it broke. A wave is fresh noise shaped by a
// prerendered envelope: the kit's Gaussian loop times one of four sign loops (eight pairings, eight independent
// streams, none of which lines up again for eighteen days), through three band paths whose gains and filter glides
// are the envelope buffer's channels. Starting a wave is one start(when); nothing is automated from the main thread.
//
//   A_i × S_j ─┬─ gain[low]  → low-pass (detune: envelope)                       rumble / boom
//              ├─ gain[mid]  → band-pass Q 0.8 (detune: envelope)                crash / body
//              └─ gain[high] → high-pass (detune: envelope) → low-pass 9 kHz → [sizzle]   hiss / spray
//   velvet × (A_i × S_j) → gain[grain] ─┐
//   plunge bed → gain[slosh] ───────────┴→ band-pass Q 1.5 (detune: envelope)    shingle rattle / rock slosh
//   all → chain: gain → low-pass (air) → pan pair
//
// Every gain's own value is 0, so an emitter is silent before, after and without an envelope.

import { hash2 } from "../../core/hash.ts";
import { rngFor } from "../../core/rng.ts";
import { K_SURF, SIZZLE, WAVE_BAND_Q, WAVE_HISS_TOP_HZ, WAVE_MID_Q, TAU } from "../levels.ts";
import { ROCK } from "../schedule/waves.ts";
import { airCutoff, cutoffCents, dbToGain, offsetTo, panOf, panPair, southCutoff, southGain, southOf, waveGain } from "../space.ts";
import { CONTROL_PLAYBACK } from "../synth/controls.ts";
import { ENV_BASE, ENV_CHANNELS, envelopeName } from "../synth/envelopes.ts";
import type { Pose } from "../types.ts";
import { bandpass, gain, highpass, kRate, loop, lowpass, panner, type Ctx, type Pan } from "./graph.ts";
import type { Kit } from "./kit.ts";
import type { EmitterState, WaveStart } from "./lanes.ts";

/** Where an emitter's chain should sit for a wave at world (x, y), heard from the dragon: gain, air (Hz), pan. */
export function emitterTargets(pose: Pose, x: number, y: number, n: number, db: number, calm: boolean, out: { gain: number; hz: number; pan: number }): void {
  const o = offsetTo(pose.x, pose.y, pose.alt, x, y, 0, n);
  const b = southOf(o.dx, o.dy);
  out.gain = K_SURF.wave * waveGain(o.d) * southGain(b) * dbToGain(db);
  out.hz = airCutoff(o.d) * southCutoff(b);
  out.pan = panOf(o.dx, o.dy, calm);
}

interface Emitter {
  /** Where this emitter's noise comes in: a wave's own source of the Gaussian loop, and of its sign loop. */
  noiseIn: ChannelSplitterNode;
  sign: AudioParam;
  signLoop: number;
  split: ChannelSplitterNode;
  slosh: GainNode;
  chain: GainNode;
  air: BiquadFilterNode;
  pan: Pan;
  /** What was last sent: gain, cutoff (Hz), pan. NaN before the first. */
  sentGain: number;
  sentHz: number;
  sentPan: number;
}

export interface Surf {
  /** Build steps still to run, one a frame (all at once offline). */
  steps: (() => void)[];
  /** Starts a wave on its emitter: its envelope at audio time `when`, its chain set for where the dragon is. */
  start(w: WaveStart, when: number, now: number, pose: Pose, calm: boolean): void;
  /** Thirty times a second: each sounding emitter's gain, air and pan follow the dragon past its fixed place. */
  update(pose: Pose, emitters: readonly EmitterState[], now: number, calm: boolean): number;
  /** Stops every envelope and slosh, started or waiting, at audio time `at`. */
  stopAll(at: number): void;
  prune(now: number): void;
  /** Stops everything, the shared loops included: the engine is being disposed. */
  end(at: number): void;
  nodes: number;
  readonly live: number;
}

const scratch = { gain: 0, hz: 0, pan: 0 };

export function buildSurf(ctx: Ctx, kit: Kit, out: AudioNode, opts: { emitters: number; seed: number; n: number; at: number; hissOnly?: boolean }): Surf {
  const rng = rngFor(opts.seed, "sound/waves/offsets");
  const emitters: Emitter[] = [];
  const running: { source: AudioBufferSourceNode; end: number }[] = [];
  const shared: AudioScheduledSourceNode[] = [];
  let flutter: ChannelSplitterNode, velvetSplit: ChannelSplitterNode;
  const surf: Surf = {
    steps: [],
    nodes: 0,
    get live() {
      return running.length;
    },
    start(w, when, now, pose, calm) {
      const e = emitters[w.emitter];
      if (!e) return;
      emitterTargets(pose, w.x, w.y, opts.n, w.db, calm, scratch);
      // The emitter is free, so silent: its chain is set outright for the new wave.
      const g = e.chain.gain, [l, r] = panPair(scratch.pan);
      for (const p of [g, e.air.detune, e.pan.left.gain, e.pan.right.gain]) p.cancelScheduledValues(now);
      if (w.offset > 0) {
        // Joined in progress: the chain comes up over 30 ms.
        g.setValueAtTime(0, now);
        g.setTargetAtTime(scratch.gain, when, TAU.rejoin);
      } else g.setValueAtTime(scratch.gain, now);
      e.air.detune.setValueAtTime(cutoffCents(scratch.hz), now);
      e.pan.left.gain.setValueAtTime(l, now);
      e.pan.right.gain.setValueAtTime(r, now);
      e.sentGain = scratch.gain;
      e.sentHz = scratch.hz;
      e.sentPan = scratch.pan;
      const buffer = kit.buffer(envelopeName(w.kind, w.strength));
      const env = ctx.createBufferSource();
      env.buffer = buffer;
      env.playbackRate.value = CONTROL_PLAYBACK;
      env.connect(e.split);
      // Offsets into a buffer are in its own seconds: a tenth of the time as played.
      env.start(when, w.offset * CONTROL_PLAYBACK);
      const lasts = buffer.duration / CONTROL_PLAYBACK - w.offset;
      running.push({ source: env, end: when + lasts + 0.05 });
      // The wave's noise: its own two sources, each started where a loop running since the context began would be,
      // so the streams are exactly those of loops that never stop; and stopped with the wave, so an idle emitter's
      // input is silence and the engine skips its whole graph.
      const noiseBuffer = kit.buffer("waveA"), signBuffer = kit.buffer(`sign${e.signLoop}`);
      const noise = loop(ctx, noiseBuffer);
      noise.connect(e.noiseIn);
      noise.start(when, when % noiseBuffer.duration);
      noise.stop(when + lasts + 0.05);
      const sign = loop(ctx, signBuffer);
      sign.connect(e.sign);
      sign.start(when, when % signBuffer.duration);
      sign.stop(when + lasts + 0.05);
      running.push({ source: noise, end: when + lasts + 0.1 }, { source: sign, end: when + lasts + 0.1 });
      if (w.kind === ROCK && !opts.hissOnly) {
        // The gully's slosh: the one frozen part, read from a hashed place at a hashed speed.
        const h = hash2(w.cue.k ?? 0, w.cue.cell ?? 0, opts.seed ^ 0x2b07);
        const plunge = kit.buffer("plunge");
        const s = loop(ctx, plunge, 0.9 + 0.2 * ((h >>> 8) / 16777216));
        s.connect(e.slosh);
        s.start(when, ((h & 255) / 256) * plunge.duration);
        s.stop(when + lasts + 0.05);
        running.push({ source: s, end: when + lasts + 0.1 });
      }
    },
    update(pose, states, now, calm) {
      let sends = 0;
      for (let i = 0; i < emitters.length; i++) {
        const st = states[i], e = emitters[i];
        if (!st || st.lane < 0 || e.sentGain !== e.sentGain) continue;
        emitterTargets(pose, st.x, st.y, opts.n, st.db, calm, scratch);
        const ga = Math.max(e.sentGain, 1e-3), gb = Math.max(scratch.gain, 1e-3);
        if (ga !== gb && Math.abs(20 * Math.log10(gb / ga)) >= 0.5) {
          e.chain.gain.setTargetAtTime(scratch.gain, now, 0.06);
          e.sentGain = scratch.gain;
          sends++;
        }
        if (Math.abs(1200 * Math.log2(scratch.hz / e.sentHz)) >= 50) {
          e.air.detune.setTargetAtTime(cutoffCents(scratch.hz), now, 0.1);
          e.sentHz = scratch.hz;
          sends++;
        }
        if (Math.abs(scratch.pan - e.sentPan) >= 0.02) {
          const [l, r] = panPair(scratch.pan);
          const tau = calm ? 0.12 : 0.06;
          e.pan.left.gain.setTargetAtTime(l, now, tau);
          e.pan.right.gain.setTargetAtTime(r, now, tau);
          e.sentPan = scratch.pan;
          sends += 2;
        }
      }
      return sends;
    },
    stopAll(at) {
      for (const r of running) {
        try {
          r.source.stop(at);
        } catch {
          // already stopped
        }
        r.end = Math.min(r.end, at);
      }
    },
    end(at) {
      surf.stopAll(at);
      for (const src of shared) {
        try {
          src.stop(at);
        } catch {
          // never started
        }
      }
    },
    prune(now) {
      for (let i = running.length - 1; i >= 0; i--) {
        // Forgotten, not disconnected: a timeline scheduled ahead of its render prunes long before the source plays.
        if (running[i].end < now) running.splice(i, 1);
      }
    },
  };

  // The shared sources: the grain, and the flutter that makes the foam sizzle. (The noise itself is each wave's own.)
  surf.steps.push(() => {
    const vel = loop(ctx, kit.buffer("velvet"));
    vel.start(opts.at);
    velvetSplit = ctx.createChannelSplitter(2);
    vel.connect(velvetSplit);
    const flut = kit.buffer("flutter");
    const f = loop(ctx, flut, CONTROL_PLAYBACK);
    f.start(opts.at, rng.float() * flut.duration);
    flutter = ctx.createChannelSplitter(2);
    f.connect(flutter);
    shared.push(vel, f);
    surf.nodes += 4;
  });

  for (let i = 0; i < opts.emitters; i++) {
    // Each emitter in three steps of a few nodes, so no frame builds more than a handful.
    let prod: GainNode, split: ChannelSplitterNode, chain: GainNode, noiseIn: ChannelSplitterNode;
    const slosh = { node: null as GainNode | null };
    const env = (ch: number, param: AudioParam) => split.connect(param, ch);
    surf.steps.push(() => {
      // This emitter's own stream: channel i & 1 of the Gaussian loop times sign loop i >> 1.
      prod = gain(ctx, 0);
      noiseIn = ctx.createChannelSplitter(2);
      noiseIn.connect(prod, i & 1);
      split = ctx.createChannelSplitter(ENV_CHANNELS);
      chain = gain(ctx, 0);
      const gHigh = gain(ctx, 0);
      const high = highpass(ctx, ENV_BASE.high);
      const top = lowpass(ctx, WAVE_HISS_TOP_HZ);
      const sizzle = gain(ctx, SIZZLE[0]);
      const depth = gain(ctx, SIZZLE[1]);
      flutter.connect(depth, i & 1);
      depth.connect(sizzle.gain);
      prod.connect(gHigh);
      gHigh.connect(high);
      high.connect(top);
      top.connect(sizzle);
      sizzle.connect(chain);
      env(2, gHigh.gain);
      env(7, high.detune);
      // The envelope and the flutter move slowly: one value a render quantum is enough, and costs far less.
      for (const p of [gHigh.gain, high.detune, sizzle.gain]) kRate(p);
    });
    surf.steps.push(() => {
      slosh.node = gain(ctx, 0);
      if (opts.hissOnly) return;
      const gLow = gain(ctx, 0);
      const low = lowpass(ctx, ENV_BASE.low);
      prod.connect(gLow);
      gLow.connect(low);
      low.connect(chain);
      env(0, gLow.gain);
      env(5, low.detune);
      const gMid = gain(ctx, 0);
      const mid = bandpass(ctx, ENV_BASE.mid, WAVE_MID_Q);
      prod.connect(gMid);
      gMid.connect(mid);
      mid.connect(chain);
      env(1, gMid.gain);
      env(6, mid.detune);
      // The envelope's detunes move only as fast as a control signal does.
      for (const p of [low.detune, mid.detune, gLow.gain, gMid.gain]) kRate(p);
    });
    surf.steps.push(() => {
      const sloshGain = slosh.node as GainNode;
      if (!opts.hissOnly) {
        // Grain: the fresh noise let through in knocks. Slosh: the plunge bed, a source per rock wave.
        const sparse = gain(ctx, 0);
        velvetSplit.connect(sparse.gain, 0);
        prod.connect(sparse);
        const gGrain = gain(ctx, 0);
        sparse.connect(gGrain);
        const band = bandpass(ctx, ENV_BASE.band, WAVE_BAND_Q);
        gGrain.connect(band);
        sloshGain.connect(band);
        band.connect(chain);
        env(3, gGrain.gain);
        env(4, sloshGain.gain);
        env(8, band.detune);
        for (const p of [band.detune, gGrain.gain, sloshGain.gain]) kRate(p);
      }
      const air = lowpass(ctx, 1000);
      const pan = panner(ctx, 0);
      chain.connect(air);
      air.connect(pan.left);
      air.connect(pan.right);
      pan.out.connect(out);
      emitters.push({ noiseIn, sign: prod.gain, signLoop: (i >> 1) & 3, split, slosh: sloshGain, chain, air, pan, sentGain: NaN, sentHz: 1000, sentPan: 0 });
      surf.nodes += opts.hissOnly ? 12 : 20;
    });
  }
  return surf;
}
