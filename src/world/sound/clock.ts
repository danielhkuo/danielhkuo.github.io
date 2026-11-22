// World time → audio time (design §6.4). There is one clock: an eased offset `o`, with `when = cue.t + o + LEAD`.
// Each frame gives one sample of `o`, from the output timestamp when it can be trusted and from currentTime and the
// output latency when it cannot; both are eased the same way.

/** Sound is asked for this much after its picture's frame time, seconds: a frame reaches the screen later than its rAF
 *  time, and sound that is a little late is not noticed where sound that is early is. */
export const LEAD = 0.025;
/** The offset moves this share of the way to each sample, for samples a sixtieth of a second apart … */
export const EASE = 0.02;
/**
 * The page samples the offset this often, seconds, not every frame: reading the output timestamp is the dearest thing
 * the sound does each frame, and an offset that takes most of a second to move loses nothing by it. Each sample then
 * pulls as far as the frames it stands for would have (`easeFor`).
 */
export const SAMPLE_EVERY = 0.1;
/** … and snaps when a sample is further off than this, seconds (a resume, a device change). */
export const SNAP = 0.12;
/** A timestamp older than this against performance.now(), seconds, is stale (just after a resume it can be). */
export const FRESH = 0.1;
/** The scheduler looks this far ahead, seconds, and up to as much again when the output is slow to be heard (Bluetooth). */
export const LOOKAHEAD = 0.25;

export interface ClockReading {
  /** ctx.currentTime, seconds. */
  currentTime: number;
  /** ctx.outputLatency, seconds, where the engine has it. */
  outputLatency?: number;
  /** ctx.getOutputTimestamp(), where the engine has it. */
  stamp?: { contextTime?: number; performanceTime?: number } | null;
  /** performance.now(), milliseconds. */
  now: number;
}

/** True when the output timestamp can be used: it has a non-zero performance time, within FRESH of now. */
export function stampUsable(r: ClockReading): boolean {
  const s = r.stamp;
  if (!s || typeof s.contextTime !== "number" || typeof s.performanceTime !== "number") return false;
  if (!(s.performanceTime > 0) || !Number.isFinite(s.contextTime)) return false;
  return Math.abs(r.now - s.performanceTime) / 1000 <= FRESH;
}

/** One sample of the offset: audio time minus page time, aimed at the moment of hearing. */
export function sampleOffset(r: ClockReading): number {
  if (stampUsable(r)) return (r.stamp!.contextTime as number) - (r.stamp!.performanceTime as number) / 1000;
  const latency = Number.isFinite(r.outputLatency) ? Math.max(0, r.outputLatency as number) : 0;
  return r.currentTime - latency - r.now / 1000;
}

/** The share of the way one sample pulls the offset when it stands for `dt` seconds of frames. */
export function easeFor(dt: number): number {
  return 1 - Math.pow(1 - EASE, Math.max(1, dt * 60));
}

/** The offset after one more sample: NaN (none yet) and far samples snap; near ones pull it `ease` of the way (2 % a frame). */
export function easeOffset(o: number, sample: number, ease = EASE): number {
  if (o !== o || Math.abs(sample - o) > SNAP) return sample;
  return o + ease * (sample - o);
}

/** How far ahead cues are looked for: longer when what is scheduled now is heard late. */
export function lookaheadFor(r: ClockReading): number {
  const heard = stampUsable(r) ? (r.stamp!.contextTime as number) : r.currentTime - (Number.isFinite(r.outputLatency) ? (r.outputLatency as number) : 0);
  const late = r.currentTime - heard;
  return LOOKAHEAD + Math.min(LOOKAHEAD, Math.max(0, late === late ? late : 0));
}

/** The audio time at which a cue with world time `t` starts, kept inside [currentTime + 5 ms, currentTime + lookahead + 0.1]. */
export function whenFor(t: number, o: number, currentTime: number, lookahead: number): number {
  const when = t + o + LEAD;
  const lo = currentTime + 0.005, hi = currentTime + lookahead + 0.1;
  return when < lo ? lo : when > hi ? hi : when;
}

/** How late a cue would start, seconds (0 when it is on time): its wanted time against the earliest it can be given. */
export function lateness(t: number, o: number, currentTime: number): number {
  return Math.max(0, currentTime + 0.005 - (t + o + LEAD));
}
