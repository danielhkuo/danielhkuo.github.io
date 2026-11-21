// Timed sights keep to their seeded clocks, the same for every visitor. A sight being watched as its time runs out
// does not vanish, though: it lingers, going on as it would (a balloon drifts off, a ship sails on, a plane rides at
// its mooring) while any of it is on the frame, and is gone only once it is out of view. What lingers is the watching
// viewer's own: a layer remembers, from one frame to the next, which of its sights it drew on the frame. Nothing else.
//
// While a sight lingers its next appearance waits, and eases in once the lingering one has gone, so no sight shows
// twice at once. A sight that rejoins (it lingers in the pose its next appearance begins from) hands over instead.

import { frameX, frameY, smooth01 } from "./art.ts";
import type { LiveFrame } from "./live.ts";
import type { LiveSprite } from "./sprites.ts";

/** Seconds a frame may come after the last and still follow it: a longer gap, or going back, is a jump in time. */
export const LINGER_GAP = 1;
/** Seconds an appearance that waited for a lingering one eases in over. */
export const LINGER_EASE = 2;

/** Whether a frame at t follows one at `last` (NaN: there was none). */
export function follows(last: number, t: number): boolean {
  return t >= last && t - last <= LINGER_GAP;
}

/** Whether any of `s`, anchored at world (x, y) and `alt` up as drawSprite places it, lies on the frame. */
export function spriteOnFrame(f: LiveFrame, s: LiveSprite, x: number, y: number, alt: number): boolean {
  const sx = frameX(f, x, s.w) - s.ax;
  const sy = frameY(f, 0.8 * y - alt, s.h) - s.ay;
  return sx < f.rect.w && sx + s.w > 0 && sy < f.rect.h && sy + s.h > 0;
}

/**
 * The timed sights of a layer, each at a fixed index (a wonder, a town's kite, a kind of rare sight), and which of
 * them linger. Each frame: `frame(t)` first; then for each sight `at`, and, when the layer draws it, `drawn`.
 */
export class Lingers {
  /** The appearance last drawn (NaN for none), and when it began. */
  private readonly slot: Float64Array;
  private readonly start: Float64Array;
  /** On the frame in the frame before, and in this one. */
  private readonly was: Uint8Array;
  private readonly now: Uint8Array;
  /** Lingering past its window. */
  private readonly stays: Uint8Array;
  /** The appearance drawn took over from a lingering one. */
  private readonly joined: Uint8Array;
  /** When a lingering one went, letting its next appearance show. */
  private readonly since: Float64Array;
  private last = NaN;
  private t = 0;

  constructor(count: number) {
    this.slot = new Float64Array(count);
    this.start = new Float64Array(count);
    this.was = new Uint8Array(count);
    this.now = new Uint8Array(count);
    this.stays = new Uint8Array(count);
    this.joined = new Uint8Array(count);
    this.since = new Float64Array(count);
    this.forget();
  }

  private forget(): void {
    this.slot.fill(NaN);
    this.start.fill(0);
    this.was.fill(0);
    this.now.fill(0);
    this.stays.fill(0);
    this.joined.fill(0);
    this.since.fill(-Infinity);
  }

  /** Starts the frame at time t. After a jump in time nothing lingers: every sight is as if never seen. */
  frame(t: number): void {
    if (!follows(this.last, t)) this.forget();
    else {
      for (let i = 0; i < this.slot.length; i++) {
        this.was[i] = this.now[i];
        this.now[i] = 0;
        // None of it was on the last frame: it has gone.
        if (this.stays[i] === 1 && this.was[i] === 0) {
          this.stays[i] = 0;
          this.since[i] = t;
        }
      }
    }
    this.last = t;
    this.t = t;
  }

  /**
   * Seconds into sight i's appearance to draw this frame, or −1 for nothing. `at` is its window (−1 outside it) and
   * `slot` which appearance that is. One drawn on the last frame as its window shut lingers, `lasts` or more seconds
   * in; while it does its next appearance waits, unless it `rejoins`, when the next takes over.
   */
  at(i: number, at: number, slot: number, rejoins: boolean): number {
    const mine = this.slot[i];
    if (this.stays[i] === 0 && this.was[i] === 1 && !Number.isNaN(mine) && (at < 0 || slot !== mine)) this.stays[i] = 1;
    if (this.stays[i] === 1) {
      if (at < 0 || slot === mine || !rejoins) return this.t - this.start[i];
      this.stays[i] = 0;
      this.joined[i] = 1;
      this.slot[i] = slot;
      this.start[i] = this.t - at;
      return at;
    }
    if (at < 0) return -1;
    if (slot !== mine) {
      this.slot[i] = slot;
      this.start[i] = this.t - at;
      this.joined[i] = 0;
    }
    return at;
  }

  /** Whether sight i is lingering past its window this frame. */
  lingering(i: number): boolean {
    return this.stays[i] === 1;
  }

  /** Which appearance of sight i is being drawn (the one lingering, while it lingers). */
  appearance(i: number): number {
    return this.slot[i];
  }

  /** After drawing sight i: whether any of it lay on the frame. */
  drawn(i: number, onFrame: boolean): void {
    if (onFrame) this.now[i] = 1;
  }

  /**
   * 0–1: how fully sight i shows, given `own`, its own fade-in. In full at once when it took over from a lingering
   * one; eased in after one it waited for.
   */
  fade(i: number, own: number): number {
    if (this.joined[i] === 1) return 1;
    return own * smooth01((this.t - this.since[i]) / LINGER_EASE);
  }
}
