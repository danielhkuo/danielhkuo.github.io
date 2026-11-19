// The kit: the buffers made after unlock (design §6.5). The worker does the arithmetic; the main thread adopts each
// buffer into an AudioBuffer a slice at a time, one slice a frame, so no frame pays for more than a 65,536-sample
// copy. The kit is not tied to a context: it survives an engine being disposed and rebuilt.

import { JOBS, make, type Job, type Raw } from "../synth/make.ts";

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
  /** True once every buffer of `job` is adopted. */
  ready(job: Job): boolean;
  /** True once every job is. */
  done(): boolean;
  /** A buffer by name; throws when it is not adopted yet (ask `ready` first). */
  buffer(name: string): AudioBuffer;
  /** Resolves when every job is adopted, stepping on a timer: for the bench, never for the game's frame loop. */
  whenDone(): Promise<void>;
  dispose(): void;
}

const SLICE = 65536;

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
  const adopted = new Set<Job>();
  /** Arrived from the worker, waiting to be adopted. */
  const arrived: { job: Job; raws: Record<string, Raw> }[] = [];
  /** The buffer being adopted: a slice a step. */
  let current: { job: Job; names: string[]; raws: Record<string, Raw>; name: number; buffer: AudioBuffer | null; channel: number; at: number } | null = null;
  /** Jobs to compute in place (no worker). */
  let inline: Job[] = [];
  let worker: KitWorker | null = null;
  let disposed = false;

  try {
    worker = opts.spawn ? opts.spawn() : null;
  } catch {
    worker = null;
  }
  const fallBack = () => {
    worker?.terminate();
    worker = null;
    inline = JOBS.filter((j) => !adopted.has(j) && !arrived.some((a) => a.job === j) && current?.job !== j);
  };
  if (worker) {
    worker.onmessage = (e) => {
      const reply = e.data as { job: Job; buffers?: Record<string, Raw>; error?: string };
      if (disposed) return;
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

  const step = (): boolean => {
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
      if (worker && adopted.size === JOBS.length) {
        worker.terminate();
        worker = null;
      }
      return false;
    }
    const c = current;
    if (c.name >= c.names.length) {
      adopted.add(c.job);
      current = null;
      return true;
    }
    const name = c.names[c.name];
    const raw = c.raws[name];
    if (!c.buffer) {
      c.buffer = makeBuffer(raw.channels.length, raw.channels[0].length, raw.rate);
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
    ready: (job) => adopted.has(job),
    done,
    buffer(name) {
      const b = buffers.get(name);
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
