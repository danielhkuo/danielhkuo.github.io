// The town clock and the wonders' moments (design §4.8–4.10): each a slot where it happens, its one-shots played
// into the slot, and a small graph for whatever of it is continuous (the clock's whirr and ratchet, the train's
// spray, the seaplane's engine), alive only while its moment is.
//
//   a slot       [gain] → low-pass (air) → pan pair → moments bus        (and [send] → reverb, for the clock)
//                a moving slot also holds its Doppler shift, in cents, as a constant every source in it follows
//   the clock    chimes, clacks and thuds; the ratchet's loop where no chime sounds; the whirr:
//                white → band-pass 2.6 kHz → [× a 55 Hz sawtooth] → [wound up, run down]
//   the train    chuffs, wheel clicks, the steam swell; whistles, also into its echo (delay 0.7 s → low-pass 900 Hz);
//                the spray of rails under water: pink → band-pass 2.2 kHz, and the purl
//   the seaplane splashes and last pops; its engine: a wave whose fundamental is the half-order (rpm / 120), with
//                the blade-pass and firing harmonics, a second a shade sharp, → soft clip → low-pass; the prop wash:
//                pink → band-pass 500 Hz × the blade-pass rate; the purl under its floats as it taxis
//
// Where each actor is comes from the functions live/moments.ts exports: the picture draws from the same ones.
// One-shots are never faded by the picture's `shown`: a moment's opening sounds at full level.

import { torusDelta } from "../../core/torus.ts";
import { CARRIAGE_BEHIND, PLANE_DOWN, PLANE_MOORED, planeAt, planePlace, trainAt, trainPlace } from "../../live/moments.ts";
import { K_CLOCK, K_PLANE, K_TRAIN, TAU } from "../levels.ts";
import { CHIME, CLACK, RATCHET, THUD, WHIRR, WHIRR_DOWN, WHIRR_END } from "../schedule/chimes.ts";
import { appearance, CHUFF, CLICK, PLANE_RUNDOWN, planeRpm, POP, SPLASH, SWELL, trainRun, WHISTLE_LONG, WHISTLE_SHORT } from "../schedule/moments.ts";
import { airCutoff, cutoffCents, dbToGain, distanceGain, dopplerCents, MEDIUM, panOf, panPair, reverbSend, southCutoff, southGain, southOf, type DistanceClass } from "../space.ts";
import { chimeName, clackName, RATCHET_S, RATCHET_TICKS } from "../synth/chimes.ts";
import { chuffName, clickName } from "../synth/moments.ts";
import type { Cue, Pose } from "../types.ts";
import { bandpass, gain, loop, lowpass, panner, type Ctx, type Master, type Pan } from "./graph.ts";
import type { Kit } from "./kit.ts";

/** Starts a one-shot (the engine's register, so a mute stops it): its buffer, where it goes, when, how loud, and what bends its pitch. */
export type PlayShot = (buffer: AudioBuffer, dest: AudioNode, when: number, level: number, o?: { offset?: number; low?: boolean; detune?: AudioNode; onset?: boolean }) => boolean;

interface Slot {
  in: GainNode;
  air: BiquadFilterNode;
  pan: Pan;
  send: GainNode | null;
  cents: ConstantSourceNode | null;
  sentGain: number;
  sentHz: number;
  sentPan: number;
  sentCents: number;
  /** The distance last seen and its eased rate of closing (cells a second), for the Doppler shift. */
  d: number;
  closing: number;
}

function makeSlot(ctx: Ctx, master: Master, o: { doppler: boolean; send: boolean; at: number }): Slot {
  const g = gain(ctx, 0);
  const air = lowpass(ctx, 1000);
  const pan = panner(ctx, 0);
  g.connect(air);
  air.connect(pan.left);
  air.connect(pan.right);
  pan.out.connect(master.bus.moments);
  let send: GainNode | null = null;
  if (o.send) {
    send = gain(ctx, 0);
    air.connect(send);
    send.connect(master.send);
  }
  let cents: ConstantSourceNode | null = null;
  if (o.doppler) {
    cents = ctx.createConstantSource();
    cents.offset.value = 0;
    cents.start(o.at);
  }
  return { in: g, air, pan, send, cents, sentGain: NaN, sentHz: 1000, sentPan: 0, sentCents: 0, d: NaN, closing: 0 };
}

/** The slot follows its source at (x, y, h): gain by distance, air, pan, and (a moving slot) its Doppler shift. Returns the sends made. */
function follow(s: Slot, pose: Pose, x: number, y: number, h: number, n: number, level: number, cls: DistanceClass, sendLevel: number, dt: number, now: number, calm: boolean): number {
  const dx = torusDelta(pose.x, x, n), dy = torusDelta(pose.y, y, n), dz = pose.alt - h;
  const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
  const b = southOf(dx, dy);
  const g = level * distanceGain(cls, d) * southGain(b), hz = airCutoff(d) * southCutoff(b), pan = panOf(dx, dy, calm);
  let sends = 0;
  if (s.sentGain !== s.sentGain) {
    // Its first values, while it is silent: set outright.
    const [l, r] = panPair(pan);
    s.in.gain.setValueAtTime(g, now);
    s.air.detune.setValueAtTime(cutoffCents(hz), now);
    s.pan.left.gain.setValueAtTime(l, now);
    s.pan.right.gain.setValueAtTime(r, now);
    s.send?.gain.setValueAtTime(reverbSend(sendLevel, cls, d), now);
    s.sentGain = g;
    s.sentHz = hz;
    s.sentPan = pan;
    s.d = d;
    s.closing = 0;
    return 5;
  }
  const ga = Math.max(s.sentGain, 1e-4), gb = Math.max(g, 1e-4);
  if (gb >= ga * 1.06 || ga >= gb * 1.06) {
    s.in.gain.setTargetAtTime(g, now, 0.06);
    s.send?.gain.setTargetAtTime(reverbSend(sendLevel, cls, d), now, 0.06);
    s.sentGain = g;
    sends++;
  }
  if (hz >= s.sentHz * 1.029 || s.sentHz >= hz * 1.029) {
    s.air.detune.setTargetAtTime(cutoffCents(hz), now, 0.1);
    s.sentHz = hz;
    sends++;
  }
  if (Math.abs(pan - s.sentPan) >= 0.02) {
    const [l, r] = panPair(pan);
    const tau = calm ? 0.12 : 0.06;
    s.pan.left.gain.setTargetAtTime(l, now, tau);
    s.pan.right.gain.setTargetAtTime(r, now, tau);
    s.sentPan = pan;
    sends += 2;
  }
  if (s.cents && dt > 0 && dt < 0.25) {
    // Closing speed, eased at 150 ms; the shift follows it.
    const k = 1 - Math.exp(-dt / 0.15);
    s.closing += (-(d - s.d) / dt - s.closing) * k;
    const c = dopplerCents(s.closing, calm);
    if (Math.abs(c - s.sentCents) >= 4) {
      s.cents.offset.setTargetAtTime(c, now, 0.15);
      s.sentCents = c;
      sends++;
    }
  }
  s.d = d;
  return sends;
}

/** A slot whose moment is over (or out of earshot) goes quiet, and its next first values are set outright again. */
function rest(s: Slot, now: number): void {
  if (s.sentGain !== s.sentGain) return;
  s.in.gain.setTargetAtTime(0, now, 0.05);
  s.sentGain = NaN;
}

interface Running {
  sources: AudioScheduledSourceNode[];
  /** Audio time it ends by. */
  end: number;
  key: number;
}

function stopRunning(r: Running | null, at: number): void {
  if (!r) return;
  for (const s of r.sources) {
    try {
      s.stop(at);
    } catch {
      // already stopped
    }
  }
}

export interface Moment {
  /** One cue of this moment, at audio time `when`, `offset` seconds in when it is joined in progress. */
  cue(cue: Cue, when: number, offset: number, now: number): void;
  /** Thirty times a second: the slot follows its actor; the continuous part starts when its moment does. Returns the sends made. */
  update(pose: Pose, dt: number, now: number, at: (t: number) => number, calm: boolean): number;
  /** Stops whatever is continuous at audio time `at`. */
  stopAll(at: number): void;
  /** Where the moment happens (for earshot). */
  x: number;
  y: number;
  nodes: number;
}

export interface MomentOptions {
  kit: Kit;
  master: Master;
  n: number;
  seed: number;
  forced: boolean;
  play: PlayShot;
  /** Notes a sharp event at audio time `when` that is not a one-shot of its own (a tick of the ratchet's loop). */
  onset(when: number): void;
  at: number;
}

// ── The clock ────────────────────────────────────────────────────────────────────────────────────────────────────────

export function buildClock(ctx: Ctx, o: MomentOptions & { town: { x: number; y: number }; tuneOnly?: boolean }): Moment {
  const slot = makeSlot(ctx, o.master, { doppler: false, send: true, at: o.at });
  let whirr: Running | null = null;
  const loops: Running[] = [];
  /** The town's clock tower stands about this high. */
  const H = 20;
  return {
    x: o.town.x, y: o.town.y, nodes: 8,
    cue(cue, when, offset) {
      const v = cue.variant ?? 0, level = dbToGain(cue.db ?? 0);
      if (o.tuneOnly && (v !== CHIME || cue.key.includes("count"))) return;
      if (v === CHIME) {
        if (offset === 0) o.play(o.kit.buffer(chimeName(cue.k ?? 0)), slot.in, when, K_CLOCK.chime * level, { onset: true });
      } else if (v === CLACK) {
        if (offset === 0) o.play(o.kit.buffer(clackName(cue.k ?? 0)), slot.in, when, K_CLOCK.clack * level, { onset: true });
      } else if (v === THUD) {
        if (offset === 0) o.play(o.kit.buffer("thud"), slot.in, when, K_CLOCK.thud * level, { onset: true });
      } else if (v === RATCHET) {
        // The loop, for as long as no chime sounds: its own gain, eased in and out over 20 ms.
        const left = (cue.lasts ?? 0) - offset;
        if (left < 0.1) return;
        const src = loop(ctx, o.kit.buffer("ratchet"));
        const g = gain(ctx, 0);
        g.gain.setValueAtTime(0, when);
        g.gain.linearRampToValueAtTime(K_CLOCK.ratchet, when + 0.02);
        g.gain.setValueAtTime(K_CLOCK.ratchet, when + left - 0.03);
        g.gain.linearRampToValueAtTime(0, when + left);
        src.connect(g);
        g.connect(slot.in);
        src.start(when, offset % RATCHET_S);
        src.stop(when + left + 0.02);
        src.onended = () => {
          src.disconnect();
          g.disconnect();
        };
        loops.push({ sources: [src], end: when + left + 0.05, key: 0 });
        // Each tick of the loop is a sharp event of its own.
        const tick = RATCHET_S / RATCHET_TICKS;
        for (let k = Math.ceil((offset - 0.05 * tick) / tick); (k + 0.05) * tick < offset + left - 0.03; k++) o.onset(when + (k + 0.05) * tick - offset);
      } else if (v === WHIRR) {
        // The governor's fan: band-passed noise chopped by a 55 Hz sawtooth; wound up over 0.6 s, run down from 33.5 s.
        stopRunning(whirr, when);
        const S = when - offset;
        const src = loop(ctx, o.kit.buffer("white0"));
        const band = bandpass(ctx, 2600, 3);
        const chop = gain(ctx, 0.5);
        const fan = ctx.createOscillator();
        fan.type = "sawtooth";
        fan.frequency.setValueAtTime(55, when);
        fan.frequency.setValueAtTime(55, Math.max(when, S + WHIRR_DOWN));
        fan.frequency.linearRampToValueAtTime(20, S + WHIRR_END);
        const depth = gain(ctx, 0.5);
        fan.connect(depth);
        depth.connect(chop.gain);
        const env = gain(ctx, 0);
        env.gain.setValueAtTime(0, when);
        if (offset < 0.6) env.gain.linearRampToValueAtTime(K_CLOCK.whirr, S + 0.6);
        else env.gain.setTargetAtTime(K_CLOCK.whirr, when, TAU.rejoin);
        if (S + WHIRR_DOWN > when + 0.05) env.gain.setValueAtTime(K_CLOCK.whirr, S + WHIRR_DOWN);
        env.gain.linearRampToValueAtTime(0, S + WHIRR_END);
        src.connect(band);
        band.connect(chop);
        chop.connect(env);
        env.connect(slot.in);
        src.start(when);
        fan.start(when);
        src.stop(S + WHIRR_END + 0.05);
        fan.stop(S + WHIRR_END + 0.05);
        src.onended = () => {
          src.disconnect();
          fan.disconnect();
          env.disconnect();
        };
        whirr = { sources: [src, fan], end: S + WHIRR_END + 0.05, key: 0 };
      }
    },
    update(pose, dt, now, _at, calm) {
      for (let i = loops.length - 1; i >= 0; i--) if (loops[i].end < now) loops.splice(i, 1);
      return follow(slot, pose, o.town.x, o.town.y, H, o.n, 1, MEDIUM, K_CLOCK.send, dt, now, calm);
    },
    stopAll(at) {
      stopRunning(whirr, at);
      whirr = null;
      for (const l of loops) stopRunning(l, at);
      loops.length = 0;
    },
  };
}

// ── The train ────────────────────────────────────────────────────────────────────────────────────────────────────────

export function buildTrain(ctx: Ctx, o: MomentOptions & { shore: [number, number]; halt: [number, number]; level: number }): Moment {
  const slot = makeSlot(ctx, o.master, { doppler: true, send: false, at: o.at });
  // The whistle's echo off the far shore: one repeat, 0.7 s on, dull, 14 dB down.
  const echoIn = gain(ctx, 1);
  const delay = ctx.createDelay(1);
  delay.delayTime.value = 0.7;
  const dull = lowpass(ctx, 900);
  const back = gain(ctx, 0.2);
  echoIn.connect(delay);
  delay.connect(dull);
  dull.connect(back);
  back.connect(slot.in);
  let spray: Running | null = null;
  const detune = slot.cents as AudioNode;
  const mid = { x: o.shore[0] + torusDelta(o.shore[0], o.halt[0], o.n) / 2, y: o.shore[1] + torusDelta(o.shore[1], o.halt[1], o.n) / 2 };
  return {
    x: mid.x, y: mid.y, nodes: 12,
    cue(cue, when, offset) {
      if (offset > 0) return;
      const v = cue.variant ?? 0, level = dbToGain(cue.db ?? 0);
      if (v === CHUFF) o.play(o.kit.buffer(chuffName(cue.k ?? 0)), slot.in, when, K_TRAIN.chuff * level, { detune, onset: true });
      else if (v === CLICK) o.play(o.kit.buffer(clickName(cue.k ?? 0)), slot.in, when, K_TRAIN.click * level, { detune, low: true, onset: true });
      else if (v === SWELL) o.play(o.kit.buffer("swell"), slot.in, when, K_TRAIN.swell * level, { detune });
      else if (v === WHISTLE_LONG || v === WHISTLE_SHORT) {
        const buffer = o.kit.buffer(v === WHISTLE_LONG ? "whistleLong" : "whistleShort");
        o.play(buffer, slot.in, when, K_TRAIN.whistle * level, { detune });
        o.play(buffer, echoIn, when, K_TRAIN.whistle * level, { detune });
      }
    },
    update(pose, dt, now, at, calm) {
      const a = appearance(o.seed, "train", pose.t, o.forced);
      if (!a) {
        rest(slot, now);
        return 0;
      }
      trainAt(pose.t - a.start, a.lasts, o.shore, o.halt, o.n);
      const sends = follow(slot, pose, trainPlace.x, trainPlace.y, o.level + 2, o.n, 1, MEDIUM, 0, dt, now, calm);
      const key = Math.round(a.start * 10);
      if ((!spray || spray.key !== key) && slot.sentGain > 1e-4) {
        // The spray of rails under shallow water, for as long as the train runs: in over half a second, out with the
        // appearance's last 2.5 s. Its level goes as the train's speed.
        stopRunning(spray, now);
        const S = at(a.start), end = S + a.lasts;
        if (end - now > 0.5) {
          const v = trainRun(o.shore, o.halt, o.n, a.lasts).v;
          const top = K_TRAIN.spray * Math.min(1.5, v / 18);
          const pink = loop(ctx, o.kit.buffer("pink0")), purl = loop(ctx, o.kit.buffer("flow"));
          const band = bandpass(ctx, 2200, 0.7);
          const purlGain = gain(ctx, 0.316);
          const env = gain(ctx, 0);
          const from = Math.max(now, S);
          env.gain.setValueAtTime(0, from);
          env.gain.linearRampToValueAtTime(top, from + 0.5);
          if (end - 2.5 > from + 0.5) env.gain.setValueAtTime(top, end - 2.5);
          env.gain.linearRampToValueAtTime(0, end);
          pink.connect(band);
          band.connect(env);
          purl.connect(purlGain);
          purlGain.connect(env);
          env.connect(slot.in);
          for (const s of [pink, purl]) {
            s.start(from, (key * 0.37) % 3);
            s.stop(end + 0.05);
          }
          pink.onended = () => {
            pink.disconnect();
            purl.disconnect();
            env.disconnect();
          };
          spray = { sources: [pink, purl], end: end + 0.05, key };
        }
      }
      return sends;
    },
    stopAll(at) {
      stopRunning(spray, at);
      spray = null;
      slot.sentGain = NaN;
    },
  };
}

/** How far behind the engine the carriage's wheels sound (the schedule already delays its clicks by this). */
export const CARRIAGE_CELLS = CARRIAGE_BEHIND;

// ── The seaplane ─────────────────────────────────────────────────────────────────────────────────────────────────────

/** The engine's wave: harmonics of the half-order. 4 is the blade pass (with 8, 12, 16), 9 the firing (with 18, 27); the small ones are its unevenness. */
function planeWave(ctx: Ctx): PeriodicWave {
  const real = new Float32Array(28), imag = new Float32Array(28);
  const set = (h: number, db: number) => {
    imag[h] = Math.pow(10, db / 20);
  };
  // (The blade pass itself lies near 50 Hz, under what small speakers give: its overtones and the firing carry the note.)
  set(4, -9);
  set(8, -5);
  set(12, -5);
  set(16, -8);
  set(9, 0);
  set(18, -5);
  set(27, -9);
  set(1, -22);
  set(2, -18);
  set(3, -24);
  set(5, -20);
  set(7, -26);
  set(13, -23);
  return ctx.createPeriodicWave(real, imag);
}

const softClip = (() => {
  const c = new Float32Array(1025);
  for (let i = 0; i < c.length; i++) c[i] = Math.tanh(1.6 * ((2 * i) / (c.length - 1) - 1));
  return c;
})();

export function buildPlane(ctx: Ctx, o: MomentOptions & { pontoon: [number, number] }): Moment {
  const slot = makeSlot(ctx, o.master, { doppler: true, send: false, at: o.at });
  const detune = slot.cents as AudioNode;
  let engine: Running | null = null;
  let wave: PeriodicWave | null = null;
  return {
    x: o.pontoon[0], y: o.pontoon[1], nodes: 8,
    cue(cue, when, offset) {
      if (offset > 0) return;
      const v = cue.variant ?? 0, level = dbToGain(cue.db ?? 0);
      if (v === SPLASH) o.play(o.kit.buffer(`splash${(cue.k ?? 0) & 1}`), slot.in, when, K_PLANE.splash * level, { onset: true });
      else if (v === POP) o.play(o.kit.buffer(`pop${(cue.k ?? 0) % 3}`), slot.in, when, K_PLANE.pop * level, { onset: true });
    },
    update(pose, dt, now, at, calm) {
      const a = appearance(o.seed, "plane", pose.t, o.forced);
      if (!a) {
        rest(slot, now);
        return 0;
      }
      planeAt(pose.t - a.start, a.lasts, o.pontoon);
      const sends = follow(slot, pose, planePlace.x, planePlace.y, planePlace.alt, o.n, 1, MEDIUM, 0, dt, now, calm);
      const key = Math.round(a.start * 10);
      const off = a.start + PLANE_MOORED * a.lasts + PLANE_RUNDOWN;
      if ((!engine || engine.key !== key) && slot.sentGain > 1e-4 && pose.t < off - 0.5) {
        stopRunning(engine, now);
        wave ??= planeWave(ctx);
        const S = at(a.start), end = at(off);
        const from = Math.max(now, S), t0 = pose.t + (from - now);
        const one = ctx.createOscillator(), two = ctx.createOscillator(), blade = ctx.createOscillator();
        one.setPeriodicWave(wave);
        two.setPeriodicWave(wave);
        const twoGain = gain(ctx, 0.25);
        const sum = gain(ctx, 0.5);
        const clip = ctx.createWaveShaper();
        clip.curve = softClip;
        const low = lowpass(ctx, 2600);
        const env = gain(ctx, 0);
        const pink = loop(ctx, o.kit.buffer("pink0"));
        const band = bandpass(ctx, 500, 0.6);
        const chop = gain(ctx, 0.5);
        const depth = gain(ctx, 0.5);
        const wash = gain(ctx, K_PLANE.wash);
        const purl = loop(ctx, o.kit.buffer("flow"));
        const purlEnv = gain(ctx, 0);
        // The engine's speed, written ahead as straight lines a quarter of a second long: the half-order, the second
        // oscillator a shade sharp, the blade-pass rate that chops the wash, and the low-pass that opens with the revs.
        for (let k = 0; ; k++) {
          const tw = Math.min(off, t0 + 0.25 * k), rpm = Math.max(planeRpm(tw - a.start - 1e-6, a.lasts), 300), when = at(tw) < from ? from : at(tw);
          const h = rpm / 120;
          if (k === 0) {
            one.frequency.setValueAtTime(h, when);
            two.frequency.setValueAtTime(h * 1.004, when);
            blade.frequency.setValueAtTime(4 * h, when);
            low.frequency.setValueAtTime(1200 + rpm, when);
          } else {
            one.frequency.linearRampToValueAtTime(h, when);
            two.frequency.linearRampToValueAtTime(h * 1.004, when);
            blade.frequency.linearRampToValueAtTime(4 * h, when);
            low.frequency.linearRampToValueAtTime(1200 + rpm, when);
          }
          if (tw >= off) break;
        }
        // In over half a second; out as the engine stops.
        env.gain.setValueAtTime(0, from);
        env.gain.linearRampToValueAtTime(K_PLANE.engine, from + 0.5);
        if (end - 0.4 > from + 0.5) env.gain.setValueAtTime(K_PLANE.engine, end - 0.4);
        env.gain.linearRampToValueAtTime(0, end);
        // The purl under the floats, from touchdown to the mooring.
        const down = at(a.start + PLANE_DOWN * a.lasts), moored = at(a.start + PLANE_MOORED * a.lasts);
        purlEnv.gain.setValueAtTime(0, Math.max(from, down));
        purlEnv.gain.linearRampToValueAtTime(K_PLANE.purl, Math.max(from, down) + 0.4);
        purlEnv.gain.setValueAtTime(K_PLANE.purl, Math.max(Math.max(from, down) + 0.4, moored));
        purlEnv.gain.linearRampToValueAtTime(0, Math.max(Math.max(from, down) + 0.5, moored + 1.5));
        one.connect(sum);
        two.connect(twoGain);
        twoGain.connect(sum);
        sum.connect(clip);
        clip.connect(low);
        low.connect(env);
        pink.connect(band);
        band.connect(chop);
        blade.connect(depth);
        depth.connect(chop.gain);
        chop.connect(wash);
        wash.connect(env);
        purl.connect(purlEnv);
        env.connect(slot.in);
        purlEnv.connect(slot.in);
        const sources: AudioScheduledSourceNode[] = [one, two, blade, pink, purl];
        for (const osc of [one, two, blade]) detune.connect(osc.detune);
        for (const s of sources) {
          s.start(from);
          s.stop(Math.max(end, moored + 1.5) + 0.05);
        }
        one.onended = () => {
          for (const s of sources) s.disconnect();
          env.disconnect();
          purlEnv.disconnect();
          for (const osc of [one, two, blade]) {
            try {
              detune.disconnect(osc.detune);
            } catch {
              // already gone
            }
          }
        };
        engine = { sources, end: end + 0.05, key };
      }
      return sends;
    },
    stopAll(at) {
      stopRunning(engine, at);
      engine = null;
      slot.sentGain = NaN;
    },
  };
}
