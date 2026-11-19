// Waterfalls (design §4.5): each a voice of its own, at its foot, for as long as the ear reports it.
//
//   pink → band-pass (1600 Hz small … 900 Hz tall) → [body] ─┐
//   white → high-pass 4 kHz → [hiss, breathing on a drift] ──┤
//   plunge bed → low-pass 1.2 kHz → [plunge] ────────────────┼→ chain: gain → low-pass (air) → pan pair
//   brown → low-pass 140 Hz → [rumble ∝ tallness] ───────────┤
//   brook bed → [brook ∝ smallness] ─────────────────────────┘
//
// Which fall a voice is, is decided by place (the tracker, pure): a reported fall within 12 cells of a voice's fall is
// that fall, and the voice follows it; no keys, so nothing flickers as the camera slides. There is one chain more
// than there are sounding falls: when a fall with no voice beats the weaker sounding one by 6 dB for half a second,
// it comes up on the spare chain as the other goes down, an equal-power crossfade, and the other's chain is the spare.

import { torusDelta } from "../../core/torus.ts";
import { FALL, K_RIVER } from "../levels.ts";
import { airCutoff, cutoffCents, distanceGain, panOf, panPair, SMALL, southCutoff, southGain, southOf, TALL_FALL } from "../space.ts";
import type { FallPoint, Pose } from "../types.ts";
import { bandpass, gain, highpass, loop, lowpass, panner, type Ctx, type Pan } from "./graph.ts";
import type { Hub } from "./hub.ts";
import type { Kit } from "./kit.ts";

/** 0 for a small fall (a run of 6 rows or fewer) … 1 for a tall one (18 or more). */
export function tallness(run: number): number {
  const t = (run - 6) / 12;
  return t < 0 ? 0 : t > 1 ? 1 : t;
}

/** How loud a fall at (x, y), height h, is from the dragon: its level by tallness, distance (the small class … the tall fall's own, which carries) and the south cue. */
export function fallGain(pose: Pose, x: number, y: number, h: number, run: number, n: number): number {
  const dx = torusDelta(pose.x, x, n), dy = torusDelta(pose.y, y, n), dz = pose.alt - h;
  const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
  const t = tallness(run);
  return (K_RIVER.fallSmall + (K_RIVER.fallTall - K_RIVER.fallSmall) * t) * ((1 - t) * distanceGain(SMALL, d) + t * distanceGain(TALL_FALL, d)) * southGain(southOf(dx, dy));
}

/** One chain's fall, as the tracker holds it. */
export interface Tracked {
  live: boolean;
  /** Where the voice is (it follows its fall), and where its fall was last reported. */
  x: number;
  y: number;
  tx: number;
  ty: number;
  h: number;
  run: number;
  /** How far inside the frame's edge its fall is (0 … 1), eased; its target is 0 once the fall is no longer reported. */
  edge: number;
  edgeTo: number;
  /** The crossfade: 1 steady, rising toward 1 (dir 1) or falling to 0 and then free (dir −1). */
  mix: number;
  dir: number;
  /** Counts up each time the chain is bound to a new fall. */
  binds: number;
}

export interface FallTracker {
  voices: Tracked[];
  /** One step: `falls` is what the ear reports now. */
  step(pose: Pose, falls: readonly FallPoint[], dt: number): void;
  /** Everything was stopped: every chain is free. */
  clear(): void;
  /** Falls given a chain outright, and falls that took the spare from a weaker one. */
  readonly bound: number;
  readonly handovers: number;
}

export function createFallTracker(opts: { chains: number; n: number; onBind?: (x: number, y: number, handover: boolean) => void }): FallTracker {
  const n = opts.n;
  const voices: Tracked[] = [];
  for (let i = 0; i < opts.chains; i++) voices.push({ live: false, x: 0, y: 0, tx: 0, ty: 0, h: 0, run: 0, edge: 0, edgeTo: 0, mix: 0, dir: 0, binds: 0 });
  /** Sounding falls at most: one chain is always the spare. */
  const most = opts.chains - 1;
  const used: boolean[] = [];
  /** The fall that is beating the weaker voice, and for how long. */
  const rival = { x: 0, y: 0, s: 0 };
  let bound = 0, handovers = 0;
  const near = (ax: number, ay: number, bx: number, by: number) => {
    const dx = torusDelta(ax, bx, n), dy = torusDelta(ay, by, n);
    return dx * dx + dy * dy <= FALL.near * FALL.near;
  };
  const take = (v: Tracked, f: FallPoint, mix: number, dir: number) => {
    v.live = true;
    v.x = v.tx = f.x;
    v.y = v.ty = f.y;
    v.h = f.h;
    v.run = f.run;
    // It starts where the frame's edge has it (a fall is given a chain while it is still 26 dB down or more at the
    // edge, and the chain's own gain eases up from nothing): from there the edge is followed, not caught up with.
    v.edge = f.edge;
    v.edgeTo = f.edge;
    v.mix = mix;
    v.dir = dir;
    v.binds++;
  };
  return {
    voices,
    get bound() {
      return bound;
    },
    get handovers() {
      return handovers;
    },
    clear() {
      for (const v of voices) v.live = false;
      rival.s = 0;
    },
    step(pose, falls, dt) {
      used.length = falls.length;
      used.fill(false);
      const k = dt > 0 ? 1 - Math.exp(-dt / FALL.tau) : 0;
      // 1. Each voice's own fall: the heaviest report within reach of where its fall last was.
      for (const v of voices) {
        if (!v.live) continue;
        let best = -1;
        for (let i = 0; i < falls.length; i++) {
          if (!near(v.tx, v.ty, falls[i].x, falls[i].y)) continue;
          if (!used[i] && (best < 0 || falls[i].w > falls[best].w)) best = i;
        }
        if (best >= 0) {
          const f = falls[best];
          v.tx = f.x;
          v.ty = f.y;
          v.h = f.h;
          v.run = f.run;
          v.edgeTo = f.edge;
          // Every report that near is this fall (a wide fall is seen in two column groups).
          for (let i = 0; i < falls.length; i++) if (near(f.x, f.y, falls[i].x, falls[i].y)) used[i] = true;
        } else v.edgeTo = 0;
        v.x += torusDelta(v.x, v.tx, n) * k;
        v.y += torusDelta(v.y, v.ty, n) * k;
        v.edge += (v.edgeTo - v.edge) * k;
        if (v.dir !== 0) {
          v.mix += (v.dir * dt) / FALL.crossS;
          if (v.mix >= 1) {
            v.mix = 1;
            v.dir = 0;
          } else if (v.mix <= 0) v.live = false;
        }
        // Gone from the frame and faded with its edge: the chain is free.
        if (v.live && best < 0 && v.edge < 1e-3) v.live = false;
      }
      // 2. Falls with no voice, heaviest first (the ear reports them so).
      let rivalSeen = false;
      for (let i = 0; i < falls.length; i++) {
        if (used[i]) continue;
        const f = falls[i];
        for (let j = i; j < falls.length; j++) if (near(f.x, f.y, falls[j].x, falls[j].y)) used[j] = true;
        let sounding = 0, free = -1, weakest = -1, weakestGain = Infinity;
        for (let c = 0; c < voices.length; c++) {
          const v = voices[c];
          if (!v.live) {
            if (free < 0) free = c;
            continue;
          }
          if (v.dir < 0) continue;
          sounding++;
          const g = fallGain(pose, v.x, v.y, v.h, v.run, n) * v.edge;
          if (v.dir === 0 && g < weakestGain) {
            weakestGain = g;
            weakest = c;
          }
        }
        // (A fall only just inside the frame's edge is not yet worth a chain.)
        if (free < 0 || f.edge < 0.05) continue;
        if (sounding < most) {
          take(voices[free], f, 1, 0);
          bound++;
          opts.onBind?.(f.x, f.y, false);
          continue;
        }
        // Every sounding place is taken: it must beat the weaker for half a second to take the spare chain.
        if (weakest < 0 || rivalSeen) continue;
        if (!(fallGain(pose, f.x, f.y, f.h, f.run, n) * f.edge > FALL.beats * weakestGain)) continue;
        rivalSeen = true;
        if (rival.s > 0 && near(rival.x, rival.y, f.x, f.y)) rival.s += dt;
        else rival.s = dt > 0 ? dt : 1e-6;
        rival.x = f.x;
        rival.y = f.y;
        if (rival.s >= FALL.forS) {
          take(voices[free], f, 0, 1);
          voices[weakest].dir = -1;
          handovers++;
          opts.onBind?.(f.x, f.y, true);
          rival.s = 0;
        }
      }
      if (!rivalSeen) rival.s = 0;
    },
  };
}

interface Chain {
  body: BiquadFilterNode;
  rumble: GainNode;
  brook: GainNode;
  ins: { pink: AudioNode; white: AudioNode; plunge: AudioNode; brown: AudioNode; brook: AudioNode };
  gain: GainNode;
  air: BiquadFilterNode;
  pan: Pan;
  sources: AudioBufferSourceNode[];
  /** The tracker's bind count this chain's sources were started for; −1 when it has none. */
  binds: number;
  sentGain: number;
  sentHz: number;
  sentPan: number;
}

export interface Falls {
  readonly tracker: FallTracker;
  /** Thirty times a second: the tracker, then each chain's sources, gain, air and pan. Returns the sends made. */
  update(pose: Pose, falls: readonly FallPoint[], dt: number, now: number, calm: boolean): number;
  /** Stops every fall at audio time `at`; they are found again on the next update. */
  stopAll(at: number): void;
  readonly nodes: number;
  /** Chains whose sources are running. */
  readonly sounding: number;
}

export function buildFalls(ctx: Ctx, kit: Kit, out: AudioNode, opts: { hub: Hub; touch: boolean; n: number; seed: number; onBind?: (x: number, y: number, handover: boolean) => void }): Falls {
  const tracker = createFallTracker({ chains: opts.touch ? 2 : 3, n: opts.n, onBind: opts.onBind });
  const chains: (Chain | null)[] = tracker.voices.map(() => null);
  let nodes = 0;
  let starts = 0;

  /** A chain's nodes, made the first time it is needed; its sources come and go with its falls. */
  const make = (): Chain => {
    const chain = gain(ctx, 0);
    const part = (level: number, ...through: AudioNode[]): { first: AudioNode; level: GainNode } => {
      const g = gain(ctx, level);
      for (let i = 0; i + 1 < through.length; i++) through[i].connect(through[i + 1]);
      if (through.length) through[through.length - 1].connect(g);
      g.connect(chain);
      return { first: through[0] ?? g, level: g };
    };
    const body = bandpass(ctx, FALL.bodyHz[0], FALL.bodyQ);
    const pink = part(FALL.body, body);
    const white = part(FALL.hiss, highpass(ctx, FALL.hissHz));
    // The spray breathes: the hiss's level rides the slower drift.
    const breath = gain(ctx, FALL.hiss * FALL.breathe);
    opts.hub.drift.connect(breath, 1);
    breath.connect(white.level.gain);
    const plunge = part(FALL.plunge, lowpass(ctx, FALL.plungeHz));
    const brown = part(0, lowpass(ctx, FALL.rumbleHz));
    const brook = part(0);
    const air = lowpass(ctx, 1000);
    const pan = panner(ctx, 0);
    chain.connect(air);
    air.connect(pan.left);
    air.connect(pan.right);
    nodes += 17;
    return {
      body, rumble: brown.level, brook: brook.level,
      ins: { pink: pink.first, white: white.first, plunge: plunge.first, brown: brown.first, brook: brook.first },
      gain: chain, air, pan, sources: [], binds: -1, sentGain: NaN, sentHz: 1000, sentPan: 0,
    };
  };

  const stop = (c: Chain, at: number) => {
    const mine = c.sources;
    for (const s of mine) {
      try {
        s.stop(at);
      } catch {
        // already stopped
      }
    }
    const last = mine[mine.length - 1];
    if (last) {
      last.onended = () => {
        for (const s of mine) s.disconnect();
        // The chain leaves the graph with them (an idle chain costs nothing), unless a newer fall has taken it meanwhile.
        if (c.sources === mine) c.pan.out.disconnect();
      };
    }
    c.binds = -1;
  };

  return {
    tracker,
    get nodes() {
      return nodes;
    },
    get sounding() {
      let k = 0;
      for (const c of chains) if (c && c.binds >= 0) k++;
      return k;
    },
    update(pose, falls, dt, now, calm) {
      tracker.step(pose, falls, dt);
      let sends = 0;
      for (let i = 0; i < chains.length; i++) {
        const v = tracker.voices[i];
        let c = chains[i];
        if (!v.live) {
          if (c && c.binds >= 0) {
            // Its fall is gone (it has already faded with the frame's edge, or with its crossfade).
            c.gain.gain.setTargetAtTime(0, now, 0.03);
            stop(c, now + 0.25);
            c.sentGain = NaN;
          }
          continue;
        }
        if (!c) c = chains[i] = make();
        const dx = torusDelta(pose.x, v.x, opts.n), dy = torusDelta(pose.y, v.y, opts.n), dz = pose.alt - v.h;
        const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
        const b = southOf(dx, dy);
        const level = fallGain(pose, v.x, v.y, v.h, v.run, opts.n) * v.edge * Math.sin((v.mix * Math.PI) / 2);
        const hz = airCutoff(d) * southCutoff(b), pan = panOf(dx, dy, calm);
        if (c.binds !== v.binds) {
          // A new fall on this chain: whatever it carried is stopped, and it is set for the new one while silent.
          if (c.binds >= 0) stop(c, now);
          const t = tallness(v.run);
          const [l, r] = panPair(pan);
          for (const p of [c.gain.gain, c.air.detune, c.pan.left.gain, c.pan.right.gain, c.body.detune, c.rumble.gain, c.brook.gain]) p.cancelScheduledValues(now);
          c.gain.gain.setValueAtTime(0, now);
          c.air.detune.setValueAtTime(cutoffCents(hz), now);
          c.pan.left.gain.setValueAtTime(l, now);
          c.pan.right.gain.setValueAtTime(r, now);
          c.body.detune.setValueAtTime(1200 * Math.log2((FALL.bodyHz[0] + (FALL.bodyHz[1] - FALL.bodyHz[0]) * t) / FALL.bodyHz[0]), now);
          c.rumble.gain.setValueAtTime(FALL.rumble * t, now);
          c.brook.gain.setValueAtTime(FALL.brook * (1 - t), now);
          // Its sources: each loop read from its own place, different for every fall.
          const sources: AudioBufferSourceNode[] = [];
          const read = (name: string, into: AudioNode, k: number) => {
            const buffer = kit.buffer(name);
            const s = loop(ctx, buffer);
            s.connect(into);
            s.start(now, (((starts * 5 + k) * 0.6180339887 + opts.seed * 0.137) % 1) * buffer.duration);
            sources.push(s);
          };
          read("pink0", c.ins.pink, 0);
          read("white0", c.ins.white, 1);
          read("plunge", c.ins.plunge, 2);
          if (t > 0) read("brown0", c.ins.brown, 3);
          if (t < 1) read("brook", c.ins.brook, 4);
          starts++;
          c.sources = sources;
          c.binds = v.binds;
          c.pan.out.connect(out);
          c.sentGain = 0;
          c.sentHz = hz;
          c.sentPan = pan;
          sends += 7;
        }
        const ga = Math.max(c.sentGain, 1e-4), gb = Math.max(level, 1e-4);
        if (gb >= ga * 1.03 || ga >= gb * 1.03) {
          c.gain.gain.setTargetAtTime(level, now, 0.06);
          c.sentGain = level;
          sends++;
        }
        if (hz >= c.sentHz * 1.029 || c.sentHz >= hz * 1.029) {
          c.air.detune.setTargetAtTime(cutoffCents(hz), now, 0.1);
          c.sentHz = hz;
          sends++;
        }
        if (Math.abs(pan - c.sentPan) >= 0.02) {
          const [l, r] = panPair(pan);
          const tau = calm ? 0.12 : 0.06;
          c.pan.left.gain.setTargetAtTime(l, now, tau);
          c.pan.right.gain.setTargetAtTime(r, now, tau);
          c.sentPan = pan;
          sends += 2;
        }
      }
      return sends;
    },
    stopAll(at) {
      for (const c of chains) if (c && c.binds >= 0) stop(c, at);
      for (const c of chains) if (c) c.sentGain = NaN;
      tracker.clear();
    },
  };
}
