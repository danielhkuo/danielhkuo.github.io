// The kit: the buffers made after unlock (design §6.5). The worker does the arithmetic; the main thread adopts each
// buffer into an AudioBuffer a slice at a time, one slice a frame, so no frame pays for more than a 65,536-sample
// copy. The kit is not tied to a context: it survives an engine being disposed and rebuilt.

import { FRESH_NAMES, JOBS, make, remake, type Job, type Raw } from "../synth/make.ts";

/** The slice of Worker the kit uses. */
export interface KitWorker {
  postMessage(message: unknown): void;
  onmessage: ((e: { data: unknown }) => void) | null;
  onerror: ((e: unknown) => void) | null;
  terminate(): void;
}

export interface KitOptions {
  sampleRate: number;
  seed: number;
  /** Makes the worker; null (or a throw) makes the kit compute in place, a job a step. */
  spawn?: (() => KitWorker | null) | null;
  /** Makes an AudioBuffer (the tests hand in a stand-in). */
  makeBuffer?: (channels: number, length: number, rate: number) => AudioBuffer;
}

export interface Kit {
  readonly sampleRate: number;
  /** At most one slice of work. True when it did some. */
  step(): boolean;
  /** True when the last step made an AudioBuffer (an allocation of megabytes): the frame should do no more kit work. */
  heavy(): boolean;
  /** True once every buffer of `job` is adopted. */
  ready(job: Job): boolean;
  /** True once every job is. */
  done(): boolean;
  /**
   * A buffer by name. With no generation, the kit's own (generation 0): the falls, the moments and the waves keep
   * that loop. A later generation is one the kit was asked for; a generation a newer one has written over throws.
   */
  buffer(name: string, generation?: number): AudioBuffer;
  /**
   * Asks for generation `generation` of a fresh buffer (the one after the newest adopted, and only one in flight).
   * `now` makes it in place and adopts it before returning: offline renders, which cannot wait for a worker.
   */
  request(name: string, generation: number, now?: boolean): void;
  /** The newest generation adopted for `name`, or 0 before any has been. */
  generation(name: string): number;
  /** True while a requested generation has not been adopted yet. */
  pending(): boolean;
  /** Plain bytes by name (the warp tile); throws when they have not arrived. */
  bytes(name: string): Uint8Array;
  /** Resolves when every job is adopted, stepping on a timer: for the bench, never for the game's frame loop. */
  whenDone(): Promise<void>;
  dispose(): void;
}

const SLICE = 65536;
/**
 * Samples of a fresh generation copied in one step. A quarter of a job's slice: adopting one should not make a frame
 * pay for a 65,536-sample copy on top of the mix.
 */
export const FRESH_SLICE = 16384;

const FRESH = new Set<string>(FRESH_NAMES);

/** The worker the page uses. Written out in full so the bundler sees the worker's entry. */
export function spawnWorker(): KitWorker | null {
  try {
    return new Worker(new URL("../sound.worker.ts", import.meta.url), { type: "module" }) as unknown as KitWorker;
  } catch {
    return null;
  }
}

export function createKit(opts: KitOptions): Kit {
  const makeBuffer = opts.makeBuffer ?? ((channels, length, rate) => new AudioBuffer({ numberOfChannels: channels, length, sampleRate: rate }));
  const buffers = new Map<string, AudioBuffer>();
  const blobs = new Map<string, Uint8Array>();
  const adopted = new Set<Job>();
  /** Arrived from the worker, waiting to be adopted. */
  const arrived: { job: Job; raws: Record<string, Raw> }[] = [];
  /** The buffer being adopted: a slice a step. */
  let current: { job: Job; names: string[]; raws: Record<string, Raw>; name: number; buffer: AudioBuffer | null; channel: number; at: number } | null = null;
  /** Jobs to compute in place (no worker). */
  let inline: Job[] = [];
  let worker: KitWorker | null = null;
  let disposed = false;
  let heavy = false;
  /**
   * Generations after the first take turns in three buffers: a read holds the one it plays and the one fading out,
   * and the next is written into the one before those. Generation 0 stays in `buffers` and is never written over.
   */
  interface Ring { buf: (AudioBuffer | null)[]; gen: number[] }
  const rings = new Map<string, Ring>();
  /** Newest generation fully copied, and the highest one asked for (one ahead while a request is in flight). */
  const adoptedGen = new Map<string, number>();
  const askedGen = new Map<string, number>();
  interface Copy { name: string; generation: number; raw: Raw; buffer: AudioBuffer | null; channel: number; at: number }
  /** Asked of the worker and not yet answered. */
  let awaiting: { name: string; generation: number }[] = [];
  /** To compute here: no worker, or the worker failed with one in flight. */
  const inlineFresh: { name: string; generation: number }[] = [];
  /** Raw in hand, waiting to be copied a slice at a time. */
  const freshArrived: Copy[] = [];
  let copying: Copy | null = null;

  const ringFor = (name: string): Ring => {
    let ring = rings.get(name);
    if (!ring) {
      ring = { buf: [null, null, null], gen: [-1, -1, -1] };
      rings.set(name, ring);
    }
    return ring;
  };
  const slotOf = (generation: number) => (generation - 1) % 3;
  const queueInline = (name: string, generation: number) => {
    if ((adoptedGen.get(name) ?? 0) >= generation) return;
    if (copying?.name === name && copying.generation === generation) return;
    if (freshArrived.some((j) => j.name === name && j.generation === generation)) return;
    if (inlineFresh.some((j) => j.name === name && j.generation === generation)) return;
    inlineFresh.push({ name, generation });
  };
  /** Whole, before the caller returns: an offline render schedules the move in the same step. */
  const adoptWhole = (name: string, generation: number, raw: Raw) => {
    const ring = ringFor(name);
    const slot = slotOf(generation);
    let buffer = ring.buf[slot];
    if (!buffer) {
      buffer = makeBuffer(raw.channels.length, raw.channels[0].length, raw.rate);
      ring.buf[slot] = buffer;
    }
    for (let c = 0; c < raw.channels.length; c++) buffer.copyToChannel(raw.channels[c] as Float32Array<ArrayBuffer>, c, 0);
    ring.gen[slot] = generation;
    adoptedGen.set(name, generation);
  };
  const takeRemake = (name: string, generation: number, raw: Raw | undefined) => {
    const i = awaiting.findIndex((a) => a.name === name && a.generation === generation);
    if (i < 0) return;
    awaiting.splice(i, 1);
    if (!raw) queueInline(name, generation);
    else freshArrived.push({ name, generation, raw, buffer: null, channel: 0, at: 0 });
  };

  try {
    worker = opts.spawn ? opts.spawn() : null;
  } catch {
    worker = null;
  }
  const fallBack = () => {
    worker?.terminate();
    worker = null;
    inline = JOBS.filter((j) => !adopted.has(j) && !arrived.some((a) => a.job === j) && current?.job !== j);
    for (const a of awaiting) queueInline(a.name, a.generation);
    awaiting = [];
  };
  if (worker) {
    worker.onmessage = (e) => {
      const data = e.data as { job?: Job; buffers?: Record<string, Raw>; remake?: string; generation?: number; raw?: Raw };
      if (disposed) return;
      if (typeof data.remake === "string" && typeof data.generation === "number") {
        takeRemake(data.remake, data.generation, data.raw);
        return;
      }
      const reply = data as { job: Job; buffers?: Record<string, Raw> };
      if (!reply.buffers) fallBack();
      else arrived.push({ job: reply.job, raws: reply.buffers });
    };
    worker.onerror = () => {
      if (!disposed) fallBack();
    };
    for (const job of JOBS) worker.postMessage({ job, seed: opts.seed, sampleRate: opts.sampleRate });
  } else {
    inline = [...JOBS];
  }

  /** One slice of a fresh generation, or the arithmetic that makes one when there is no worker to ask. */
  const stepFresh = (): boolean => {
    if (!copying) {
      const next = freshArrived.shift();
      if (next) {
        copying = next;
        return true;
      }
      const req = inlineFresh.shift();
      if (!req) return false;
      freshArrived.push({ name: req.name, generation: req.generation, raw: remake(req.name, req.generation, opts.seed, opts.sampleRate), buffer: null, channel: 0, at: 0 });
      heavy = true;
      return true;
    }
    const c = copying;
    const ring = ringFor(c.name);
    const slot = slotOf(c.generation);
    if (!c.buffer) {
      const existing = ring.buf[slot];
      if (existing) c.buffer = existing;
      else {
        c.buffer = makeBuffer(c.raw.channels.length, c.raw.channels[0].length, c.raw.rate);
        ring.buf[slot] = c.buffer;
        heavy = true;
      }
      // The slot's previous generation is no longer readable: the copy is about to write over it.
      ring.gen[slot] = -1;
      c.channel = 0;
      c.at = 0;
      return true;
    }
    const data = c.raw.channels[c.channel];
    const end = Math.min(data.length, c.at + FRESH_SLICE);
    c.buffer.copyToChannel(data.subarray(c.at, end) as Float32Array<ArrayBuffer>, c.channel, c.at);
    c.at = end;
    if (c.at >= data.length) {
      c.channel++;
      c.at = 0;
      if (c.channel >= c.raw.channels.length) {
        ring.gen[slot] = c.generation;
        adoptedGen.set(c.name, c.generation);
        copying = null;
      }
    }
    return true;
  };

  const step = (): boolean => {
    heavy = false;
    if (disposed) return false;
    if (!current) {
      const next = arrived.shift();
      if (next) {
        current = { job: next.job, names: Object.keys(next.raws), raws: next.raws, name: 0, buffer: null, channel: 0, at: 0 };
        return true;
      }
      const job = inline.shift();
      if (job) {
        arrived.push({ job, raws: make(job, opts.seed, opts.sampleRate) });
        return true;
      }
      // The worker stays after the jobs: generations are asked for as the beds play, and dispose is what ends it.
      return stepFresh();
    }
    const c = current;
    if (c.name >= c.names.length) {
      adopted.add(c.job);
      current = null;
      return true;
    }
    const name = c.names[c.name];
    const raw = c.raws[name];
    if (raw.bytes) {
      blobs.set(name, raw.bytes);
      c.name++;
      return true;
    }
    if (!c.buffer) {
      c.buffer = makeBuffer(raw.channels.length, raw.channels[0].length, raw.rate);
      heavy = true;
      c.channel = 0;
      c.at = 0;
      return true;
    }
    const data = raw.channels[c.channel];
    const end = Math.min(data.length, c.at + SLICE);
    c.buffer.copyToChannel(data.subarray(c.at, end) as Float32Array<ArrayBuffer>, c.channel, c.at);
    c.at = end;
    if (c.at >= data.length) {
      c.channel++;
      c.at = 0;
      if (c.channel >= raw.channels.length) {
        buffers.set(name, c.buffer);
        c.buffer = null;
        c.name++;
      }
    }
    return true;
  };

  const done = () => adopted.size === JOBS.length;

  return {
    sampleRate: opts.sampleRate,
    step,
    heavy: () => heavy,
    ready: (job) => adopted.has(job),
    done,
    buffer(name, generation = 0) {
      if (generation === 0) {
        const b = buffers.get(name);
        if (!b) throw new Error(`kit: ${name} is not ready`);
        return b;
      }
      const ring = rings.get(name);
      const held = ring?.gen[slotOf(generation)] ?? -1;
      if (held === generation) return ring!.buf[slotOf(generation)]!;
      if (generation <= (adoptedGen.get(name) ?? 0)) throw new Error(`kit: ${name} generation ${generation} is written over`);
      throw new Error(`kit: ${name} generation ${generation} is not ready`);
    },
    request(name, generation, now = false) {
      if (!FRESH.has(name)) throw new Error(`kit: ${name} is not made fresh`);
      const asked = askedGen.get(name) ?? 0;
      if (generation !== asked + 1) throw new Error(`kit: ${name} generation ${generation} is not the next one`);
      askedGen.set(name, generation);
      if (now) {
        adoptWhole(name, generation, remake(name, generation, opts.seed, opts.sampleRate));
        return;
      }
      if (worker) {
        awaiting.push({ name, generation });
        worker.postMessage({ remake: name, generation, seed: opts.seed, sampleRate: opts.sampleRate });
      } else queueInline(name, generation);
    },
    generation: (name) => adoptedGen.get(name) ?? 0,
    pending: () => copying !== null || freshArrived.length > 0 || inlineFresh.length > 0 || awaiting.length > 0,
    bytes(name) {
      const b = blobs.get(name);
      if (!b) throw new Error(`kit: ${name} is not ready`);
      return b;
    },
    whenDone() {
      return new Promise((resolve) => {
        const tick = () => {
          // Many slices a turn: nothing here is on a frame.
          for (let i = 0; i < 64 && step(); i++);
          if (done() || disposed) resolve();
          else setTimeout(tick, 4);
        };
        tick();
      });
    },
    dispose() {
      disposed = true;
      worker?.terminate();
      worker = null;
    },
  };
}
