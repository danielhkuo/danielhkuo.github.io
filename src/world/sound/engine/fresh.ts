// Fresh loops (design §14.8). A bed reads a noise buffer as a loop, and before that loop can come round the read
// moves, by an equal-power crossfade, onto a new generation of the same buffer. The kit makes the generation; this
// only schedules the reads. Nothing here is random: a render that runs twice schedules the same moves.

import { hashString, mix32 } from "../../core/hash.ts";
import { gain, loop, type Ctx } from "./graph.ts";
import { endNoise, isNoiseName, noiseNode } from "./noise-worklet.ts";
import { remake, type Raw } from "../synth/make.ts";
import type { Kit } from "./kit.ts";

/**
 * When a bed's loop is read fresh (§14.8). A read asks for the next generation once it has played `requestAt` of its
 * wrap, and the wrap is the buffer's length over its playback rate and `margin` (a wandering read runs a few percent
 * fast, so the margin is the room that wander needs). The move is scheduled `lead` seconds ahead of now, and the two
 * reads crossfade for `fade` seconds.
 */
export const FRESH = { requestAt: 0.6, lead: 0.05, fade: 0.5, margin: 1.04 };

/** The slice of a kit a fresh reader uses. */
export type FreshKit = Pick<Kit, "buffer" | "generation" | "request" | "pending">;

export interface Fresh {
  /**
   * A looping read of `name` on the newest generation, through its own fade. Given `into`, each generation's fade
   * connects straight into those nodes (a worklet read's node does too) and `out` is undefined: no gain is made for
   * the read. Otherwise the fade feeds `out` and callers connect `out`. `bed` is which bed the read belongs to, so
   * one bed can be held on its first loop while another that shares the buffer moves on.
   */
  read(name: string, o: { at: number; offset: number; rate?: number; wire?: (src: AudioBufferSourceNode) => () => void; bed?: string; into?: AudioNode[] }): { out?: AudioNode; stop(when?: number): void };
  /**
   * Several continuous noises as one worklet, output `k` into `reads[k].into`. When the worklet is on for every name
   * (and each is a noise made as it plays), one node; `share` is the earlier layer whose mixed noise this one filters.
   * Otherwise one fresh read each, at the offset, rate and wander the bed passed, and the handle stops them all.
   */
  group(bed: string | undefined, at: number, reads: { name: string; into: AudioNode[]; share?: number; offset?: number; rate?: number; wire?: (src: AudioBufferSourceNode) => () => void }[]): { stop(when?: number): void };
  /** Requests, moves and cleanups that fall due at `now`. True when it did any of that. */
  frame(now: number): boolean;
  /** How many reads have moved onto a new generation. */
  readonly swaps: number;
}

/** Points in the crossfade. Enough that the curve is smooth, few enough to schedule in one call. */
const CURVE_N = 64;
/**
 * Equal power: the new read rises on sin (0→1) and the old falls on the same curve reversed (cos, 1→0). At every
 * point the squares sum to 1, so two uncorrelated noises keep their level across the join.
 */
const FADE_UP = new Float32Array(CURVE_N);
const FADE_DOWN = new Float32Array(CURVE_N);
for (let i = 0; i < CURVE_N; i++) FADE_UP[i] = Math.sin((i / (CURVE_N - 1)) * (Math.PI / 2));
FADE_UP[0] = 0;
FADE_UP[CURVE_N - 1] = 1;
for (let i = 0; i < CURVE_N; i++) FADE_DOWN[i] = FADE_UP[CURVE_N - 1 - i];

function noop(): void {}

/** A read this far round its wrap is moved in the next call, whatever else is moved then. */
const URGENT = 0.85;

/** Where generation `generation` of `name` is entered. The same inputs always give the same place, so a render repeats. */
function place(seed: number, nameHash: number, generation: number, index: number, duration: number): number {
  const h = mix32((nameHash ^ Math.imul(generation + 1, 0x9e3779b1) ^ Math.imul(index + 1, 0x85ebca6b) ^ mix32(seed >>> 0)) >>> 0);
  return (h / 4294967296) * duration;
}

interface Playing {
  node: AudioBufferSourceNode;
  fade: GainNode;
  generation: number;
  /** Audio time the source was started at. */
  at: number;
  rate: number;
  duration: number;
  /** NaN until stop has been asked; a source can be stopped only once. */
  stopAt: number;
  unwire: () => void;
  /** True once its drive is undone and its fade has left the graph. */
  gone: boolean;
}

interface Read {
  name: string;
  bed?: string;
  /** Stable among reads of this name, including ones already let go. */
  index: number;
  /** Where every generation's fade connects. Without `into`, this is the read's own unity gain. */
  into: AudioNode[];
  rate: number;
  wire?: (src: AudioBufferSourceNode) => () => void;
  sources: Playing[];
  /** Stopped by the caller: it is never moved again. */
  stopped: boolean;
}

interface NameState {
  name: string;
  nameHash: number;
  reads: Read[];
  /** Highest generation asked for. One request is in flight while this is ahead of the kit. */
  asked: number;
  /** Next read index. It only climbs, so a place does not depend on which reads are still alive. */
  made: number;
}

/** How long the source may play before the loop would come round, allowing for the wander. */
function wrapOf(p: Playing): number {
  return p.duration / (p.rate * FRESH.margin);
}

function gone(list: Playing[]): boolean {
  for (let i = 0; i < list.length; i++) if (!list[i].gone) return false;
  return list.length > 0;
}

function current(read: Read): Playing {
  return read.sources[read.sources.length - 1];
}

/** A u32 for one worklet read. The same engine seed, name and index always rebuild the same noise. */
function noiseSeed(engineSeed: number, name: string, index: number): number {
  return mix32((hashString(name) ^ Math.imul(index + 1, 0x85ebca6b) ^ mix32(engineSeed >>> 0)) >>> 0);
}

export function createFresh(ctx: Ctx, kit: FreshKit, opts: {
  offline: boolean;
  seed: number;
  on?: (name: string, bed?: string) => boolean;
  /**
   * True when this read should be worklet noise. The bed is passed because one buffer is shared by several beds
   * and LOOPS is per bed: a bed held at 0 stays on its plain loop. Only the continuous names take the worklet;
   * drops and bubbles stay loops even when this returns true.
   */
  worklet?: (name: string, bed?: string) => boolean;
}): Fresh {
  const names: NameState[] = [];
  let swaps = 0;
  // Worklet reads are not in `names`: they never move and are never asked of the kit, so they must not share the
  // loop index either. Their own index only climbs, so a bed built again does not replay an earlier read's noise.
  const spunName: string[] = [];
  const spunCount: number[] = [];
  const nextIndex = (name: string): number => {
    for (let i = 0; i < spunName.length; i++) if (spunName[i] === name) return spunCount[i]++;
    spunName.push(name);
    spunCount.push(1);
    return 0;
  };

  const stateFor = (name: string): NameState => {
    for (let i = 0; i < names.length; i++) if (names[i].name === name) return names[i];
    const ns: NameState = { name, nameHash: hashString(name), reads: [], asked: 0, made: 0 };
    names.push(ns);
    return ns;
  };

  /** False holds the read on the loop it has: no request for it, and no move. */
  const onRead = (read: Read): boolean => opts.on?.(read.name, read.bed) !== false;

  /** Undoes a source's drive and takes its fade out of the graph, once. */
  const letGo = (p: Playing): void => {
    if (p.gone) return;
    p.unwire();
    try {
      p.fade.disconnect();
    } catch {
      // Already disconnected.
    }
    p.gone = true;
  };

  const halt = (p: Playing, when: number): void => {
    const at = Math.max(when, p.at);
    if (p.stopAt === p.stopAt) return;
    try {
      p.node.stop(at);
    } catch {
      // Already stopped.
    }
    p.stopAt = at;
    // Offline the stop is only scheduled. frame() has already run, ahead of the first sample, and a disconnect is
    // not scheduled, so the chain leaves when the render reaches this end and the ended event fires.
    if (opts.offline) p.node.onended = () => letGo(p);
  };

  /** A source that finished its fade is unwired once the stop has had a moment to land. */
  const release = (p: Playing, now: number): boolean => {
    // Offline, frame() lets nothing go: that disconnect would land before the first sample and silence the source
    // for the whole render. The ended event lets it go once the render has really reached its stop.
    if (opts.offline || p.gone || p.stopAt !== p.stopAt || !(now > p.stopAt + 0.1)) return false;
    letGo(p);
    return true;
  };

  const sweep = (ns: NameState, now: number): boolean => {
    let did = false;
    let kept = 0;
    for (let i = 0; i < ns.reads.length; i++) {
      const read = ns.reads[i];
      const list = read.sources;
      let w = 0;
      for (let s = 0; s < list.length; s++) {
        const p = list[s];
        if (release(p, now)) did = true;
        // The read's current source stays, so a stopped read still has something to show; older fades go.
        if (!(p.gone && s !== list.length - 1)) list[w++] = p;
      }
      list.length = w;
      if (read.stopped && gone(list)) continue;
      ns.reads[kept++] = read;
    }
    ns.reads.length = kept;
    return did;
  };

  /**
   * `from`: the fade's value until its curve begins. A move's source starts at 0 and rises on its curve: at 1, the
   * render can take its first sample before the curve's first point and the new noise starts with a click.
   */
  const start = (read: Read, buffer: AudioBuffer, generation: number, at: number, offset: number, from = 1): Playing => {
    const node = loop(ctx, buffer, read.rate);
    const fade = gain(ctx, from);
    node.connect(fade);
    for (let i = 0; i < read.into.length; i++) fade.connect(read.into[i]);
    const unwire = read.wire?.(node) ?? noop;
    node.start(at, offset);
    const playing: Playing = { node, fade, generation, at, rate: read.rate, duration: buffer.duration, stopAt: NaN, unwire, gone: false };
    read.sources.push(playing);
    return playing;
  };

  const moveRead = (read: Read, ns: NameState, now: number): void => {
    const cur = current(read);
    const g = kit.generation(read.name);
    const buffer = kit.buffer(read.name, g);
    const when = now + FRESH.lead;
    const next = start(read, buffer, g, when, place(opts.seed, ns.nameHash, g, read.index, buffer.duration), 0);
    next.fade.gain.setValueCurveAtTime(FADE_UP, when, FRESH.fade);
    cur.fade.gain.setValueCurveAtTime(FADE_DOWN, when, FRESH.fade);
    halt(cur, when + FRESH.fade);
    swaps++;
  };

  const canMove = (read: Read): boolean => {
    if (read.stopped || !onRead(read)) return false;
    return current(read).generation < kit.generation(read.name);
  };

  /**
   * The read closest to coming round, so a crowd of moves does not let the urgent one lap the buffer; and any other
   * read already past URGENT of its wrap (a page whose frames are all busy reaches few moves a second).
   */
  const moveOne = (now: number): boolean => {
    let did = false;
    for (let i = 0; i < names.length; i++) {
      const ns = names[i];
      for (let r = 0; r < ns.reads.length; r++) {
        const read = ns.reads[r];
        if (!canMove(read) || (now - current(read).at) / wrapOf(current(read)) < URGENT) continue;
        moveRead(read, ns, now);
        did = true;
      }
    }
    return moveMost(now) || did;
  };

  const moveMost = (now: number): boolean => {
    let best: Read | null = null;
    let bestNs: NameState | null = null;
    let bestU = -Infinity;
    for (let i = 0; i < names.length; i++) {
      const ns = names[i];
      for (let r = 0; r < ns.reads.length; r++) {
        const read = ns.reads[r];
        if (!canMove(read)) continue;
        const u = (now - current(read).at) / wrapOf(current(read));
        if (u > bestU) {
          best = read;
          bestNs = ns;
          bestU = u;
        }
      }
    }
    if (!best || !bestNs) return false;
    moveRead(best, bestNs, now);
    return true;
  };

  const moveAll = (now: number): boolean => {
    let did = false;
    for (let i = 0; i < names.length; i++) {
      const ns = names[i];
      for (let r = 0; r < ns.reads.length; r++) {
        if (!canMove(ns.reads[r])) continue;
        moveRead(ns.reads[r], ns, now);
        did = true;
      }
    }
    return did;
  };

  /** Asks for the next generation when some live read of the name has played FRESH.requestAt of a wrap on the one it is on (three fifths, which leaves the kit over a second to answer before the fade must begin: each move costs the audio thread a crossfade, and the kit a copy). */
  const requestNext = (ns: NameState, now: number): boolean => {
    const newest = kit.generation(ns.name);
    if (ns.asked > newest) return false;
    let due = false;
    for (let i = 0; i < ns.reads.length && !due; i++) {
      const read = ns.reads[i];
      if (read.stopped || !onRead(read)) continue;
      const cur = current(read);
      if (cur.generation !== newest) continue;
      if (now - cur.at >= FRESH.requestAt * wrapOf(cur)) due = true;
    }
    if (!due) return false;
    const g = newest + 1;
    kit.request(ns.name, g, opts.offline);
    ns.asked = g;
    return true;
  };

  const read = (name: string, o: { at: number; offset: number; rate?: number; wire?: (src: AudioBufferSourceNode) => () => void; bed?: string; into?: AudioNode[] }) => {
    // Made as it plays: there is no loop, so the wander (wire) and the playback rate do not apply, and the kit is
    // not asked for a generation. The node starts as it is connected; beds read at the frame's now.
    if (isNoiseName(name) && opts.worklet?.(name, o.bed) === true) {
      // The node is the read's output itself: a gain after it would be one more node the audio thread visits.
      // Given `into`, it connects straight there and is not handed back.
      const node = noiseNode(ctx, [{ name, seed: noiseSeed(opts.seed, name, nextIndex(name)) }]);
      if (o.into) for (let i = 0; i < o.into.length; i++) node.connect(o.into[i]);
      return {
        out: o.into ? undefined : node,
        stop(when?: number) {
          endNoise(node, when ?? 0);
        },
      };
    }
    const ns = stateFor(name);
    const g = kit.generation(name);
    const buffer = kit.buffer(name, g);
    // No gain of the read's own when the fade has somewhere to go: one less node every render quantum.
    const into = o.into ?? [gain(ctx, 1)];
    const rec: Read = { name, bed: o.bed, index: ns.made++, into, rate: o.rate ?? 1, wire: o.wire, sources: [], stopped: false };
    ns.reads.push(rec);
    start(rec, buffer, g, o.at, o.offset);
    return {
      out: o.into ? undefined : into[0],
      stop(when?: number) {
        rec.stopped = true;
        const at = when ?? 0;
        for (let i = 0; i < rec.sources.length; i++) halt(rec.sources[i], at);
      },
    };
  };

  const group = (bed: string | undefined, at: number, reads: { name: string; into: AudioNode[]; share?: number; offset?: number; rate?: number; wire?: (src: AudioBufferSourceNode) => () => void }[]) => {
    // One node only when every layer would have been worklet noise. A bed held on its loops, or a name that stays a
    // loop, takes the reads it used to: the same offset, rate and wander, so a plain-loop render does not move.
    const spun = reads.length > 0 && reads.every((r) => isNoiseName(r.name) && opts.worklet?.(r.name, bed) === true);
    if (spun) {
      const node = noiseNode(ctx, reads.map((r) => {
        const layer: { name: string; seed: number; share?: number } = { name: r.name, seed: noiseSeed(opts.seed, r.name, nextIndex(r.name)) };
        if (r.share !== undefined) layer.share = r.share;
        return layer;
      }));
      for (let k = 0; k < reads.length; k++) {
        const into = reads[k].into;
        for (let i = 0; i < into.length; i++) node.connect(into[i], k);
      }
      return {
        stop(when?: number) {
          // Each layer is told the end time on the shared port. The processor keeps one time; a repeat sets it again.
          const at = when ?? 0;
          for (let i = 0; i < reads.length; i++) endNoise(node, at);
        },
      };
    }
    const handles: { stop(when?: number): void }[] = [];
    for (let i = 0; i < reads.length; i++) {
      const r = reads[i];
      handles.push(read(r.name, { at, offset: r.offset ?? 0, rate: r.rate, wire: r.wire, bed, into: r.into }));
    }
    return {
      stop(when?: number) {
        for (let i = 0; i < handles.length; i++) handles[i].stop(when);
      },
    };
  };

  const frame = (now: number): boolean => {
    let did = false;
    for (let i = 0; i < names.length; i++) if (sweep(names[i], now)) did = true;
    for (let i = 0; i < names.length; i++) if (requestNext(names[i], now)) did = true;
    // Offline, every move that is due happens in this call (a render must not wait a frame). On the page, one.
    if (opts.offline) {
      if (moveAll(now)) did = true;
    } else if (moveOne(now)) did = true;
    return did;
  };

  return { read, group, frame, get swaps() { return swaps; } };
}

/** Builds one generation's raw samples. The page uses remake; a test can pass its own. */
type MakeGeneration = (name: string, generation: number, seed: number, sampleRate: number) => Raw;

/**
 * Made generations, one map per maker, shared by every ownGenerations in the process. Keyed by name, generation, seed
 * and sample rate, so a scene rendered again (the bench keeps the best of several) reuses the samples instead of
 * making them during the timed render. At most 64; the one made earliest is dropped.
 */
const MADE_MAX = 64;
const madeGenerations = new WeakMap<MakeGeneration, Map<string, Raw>>();

function cachedRaw(make: MakeGeneration, name: string, generation: number, seed: number, sampleRate: number): Raw {
  let cache = madeGenerations.get(make);
  if (!cache) madeGenerations.set(make, (cache = new Map()));
  // Name last: it is the only part that is not a number, so two keys cannot collide.
  const key = `${sampleRate}:${seed}:${generation}:${name}`;
  const found = cache.get(key);
  if (found) return found;
  const raw = make(name, generation, seed, sampleRate);
  cache.set(key, raw);
  if (cache.size > MADE_MAX) {
    for (const oldest of cache.keys()) {
      cache.delete(oldest);
      break;
    }
  }
  return raw;
}

/**
 * Generations an offline engine makes for itself, in place, one engine's worth: its renders must not depend on what
 * other engines on the same kit rendered before (the bench renders every scene on one kit, and the page's kit carries
 * its generations from one engine to the next). Generation 0 is the kit's own buffer; the last three are kept, each
 * copied into a buffer of this context. The raw samples come from `make` through the process cache, so the same
 * generation is the same samples wherever it is heard.
 */
export function ownGenerations(ctx: Ctx, kit: Pick<Kit, "buffer">, seed: number, make: MakeGeneration = remake): FreshKit {
  const made = new Map<string, { newest: number; held: Map<number, AudioBuffer> }>();
  const of = (name: string) => {
    let m = made.get(name);
    if (!m) made.set(name, (m = { newest: 0, held: new Map() }));
    return m;
  };
  return {
    buffer(name, generation = 0) {
      if (generation === 0) return kit.buffer(name);
      const b = of(name).held.get(generation);
      if (!b) throw new Error(`fresh: ${name} generation ${generation} is not held`);
      return b;
    },
    generation: (name) => of(name).newest,
    pending: () => false,
    request(name, generation) {
      const m = of(name);
      if (generation !== m.newest + 1) throw new Error(`fresh: ${name} generation ${generation} is not the next one`);
      const raw = cachedRaw(make, name, generation, seed, ctx.sampleRate);
      const b = ctx.createBuffer(raw.channels.length, raw.channels[0].length, raw.rate);
      for (let c = 0; c < raw.channels.length; c++) b.copyToChannel(raw.channels[c] as Float32Array<ArrayBuffer>, c, 0);
      m.held.set(generation, b);
      m.held.delete(generation - 3);
      m.newest = generation;
    },
  };
}
