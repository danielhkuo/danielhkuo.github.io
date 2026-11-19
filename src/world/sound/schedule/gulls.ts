// When the gulls call (design §5.3; Recipes §6). Each colony (the nine birds of a town, the five of a lighthouse) has
// its own slots of four seconds: in each, perhaps a call, by one bird, of one kind; sometimes another bird answers.
// A harbour at peace has several seconds between calls: clusters and silences, not a metronome. Pure; no state.

import { hash2 } from "../../core/hash.ts";
import { noteShape, type GullNote } from "../synth/gulls.ts";
import type { Cue } from "../types.ts";

export const SLOT_S = 4;
/** Chance of a call in a slot: by a town, at a lighthouse. */
export const P_TOWN = 0.25, P_LIGHT = 0.12;
export const P_ANSWER = 0.35;
/** Call kinds. */
export const YELP = 0, KEKS = 1, MEW = 2, LONG = 3;
/** The longest a call can run, seconds: three squeals and eleven kyows. */
export const LONGEST_CALL = 9;
/** Seconds from one kyow of a long call to the next, for a typical performance: read off the published sonogram (https://fssbirding.org.uk/herringgullsonogram.htm). */
export const KYOW_GAP = 0.29;

export interface Colony {
  /** Its site's index. */
  id: number;
  birds: number;
  town: boolean;
}

const unit = (h: number) => h / 4294967296;

export interface CallNote {
  /** Seconds after the call's start. */
  dt: number;
  note: GullNote;
  rate: number;
  db: number;
}

/**
 * The notes of a call: `voice` is the bird's voice (0 … 5), `key` names the performance (bird and slot), so the same
 * bird never gives the same call twice running. Long call: one to three squeals, then seven to eleven kyows about
 * 0.29 s apart (3.4 a second), slowing a little, each 1–2 % lower and 0.7 dB quieter. Kek run: three to six at 0.16 s.
 */
export function callNotes(seed: number, voice: number, key: number, call: number, out: CallNote[] = []): CallNote[] {
  out.length = 0;
  const h = (k: number) => unit(hash2(key, k, seed ^ 0xca11));
  if (call === YELP) out.push({ dt: 0, note: h(1) < 0.4 ? "k2" : h(2) < 0.5 ? "k0" : "k1", rate: 1, db: 0 });
  else if (call === MEW) out.push({ dt: 0, note: "m", rate: 0.97 + 0.06 * h(1), db: -2 });
  else if (call === KEKS) {
    const n = 3 + Math.floor(4 * h(1));
    for (let i = 0; i < n; i++) out.push({ dt: 0.16 * i, note: i & 1 ? "e1" : "e0", rate: 1 - 0.01 * i, db: i === 0 ? -1 : 0 });
  } else {
    const squeals = 1 + Math.floor(3 * h(1)), kyows = 7 + Math.floor(5 * h(2));
    let t = 0;
    for (let i = 0; i < squeals; i++) {
      const note: GullNote = (i + (h(3) < 0.5 ? 0 : 1)) & 1 ? "s1" : "s0";
      // The squeals are the loudest notes of the call.
      out.push({ dt: t, note, rate: 1, db: 2 });
      t += noteShape(seed, voice, note).seconds + 0.25;
    }
    let rate = 1;
    const step = 0.01 + 0.01 * h(4);
    // About 3.4 notes a second (0.29 s apart, a tenth either way by the performance), slowing by a tenth at most.
    const gap = KYOW_GAP * (0.9 + 0.2 * h(5));
    for (let i = 0; i < kyows; i++) {
      const breaks = unit(hash2(key, 40 + i, seed ^ 0xca11)) < 0.25;
      out.push({ dt: t, note: breaks ? "k2" : i & 1 ? "k1" : "k0", rate, db: -0.7 * i });
      t += gap * (1 + (0.1 * i) / (kyows - 1));
      rate *= 1 - step;
    }
  }
  return out;
}

/** Seconds a call lasts, from its first note's start to its last note's end. */
export function callLength(seed: number, voice: number, key: number, call: number): number {
  const notes = callNotes(seed, voice, key, call);
  const last = notes[notes.length - 1];
  return last.dt + noteShape(seed, voice, last.note).seconds / last.rate + 0.04;
}

interface Raw {
  t: number;
  bird: number;
  call: number;
  answer: boolean;
}

/** What slot `slot` of a colony holds before any bird's own earlier call is counted: a call, and perhaps its answer. */
function slotCalls(seed: number, colony: Colony, slot: number, out: Raw[]): void {
  const h = (k: number) => unit(hash2(slot, colony.id * 16 + k, seed ^ 0x9011));
  if (h(0) >= (colony.town ? P_TOWN : P_LIGHT)) return;
  const t = (slot + 0.75 * h(1)) * SLOT_S;
  const bird = Math.floor(colony.birds * h(2));
  const kind = h(3);
  const call = kind < 0.55 ? YELP : kind < 0.75 ? KEKS : kind < 0.9 ? MEW : LONG;
  out.push({ t, bird, call, answer: false });
  if (h(4) < P_ANSWER) {
    // Another bird answers, 0.6–2 s on: a yelp, or now and then a long call of its own.
    const other = (bird + 1 + Math.floor((colony.birds - 1) * h(5))) % colony.birds;
    out.push({ t: t + 0.6 + 1.4 * h(6), bird: other, call: h(7) < 0.75 ? YELP : LONG, answer: true });
  }
}

/** A bird's voice: `h mod 6` of its wheeler's hash; here by colony and bird, the same wherever it is asked. */
export function voiceOf(seed: number, colony: number, bird: number): number {
  return hash2(colony, bird, seed ^ 0x601c) % 6;
}

const scratch: Raw[] = [], earlier: Raw[] = [];

/**
 * Every call of `colonies` that starts in [t0, t1), in time order. A bird does not call over itself: a call that
 * would start while the same bird's call from one of the two slots before is still going is left out.
 */
export function gullCues(seed: number, colonies: readonly Colony[], t0: number, t1: number, out: Cue[]): void {
  const first = out.length;
  for (const colony of colonies) {
    // An answer can fall in the slot after its call: the slot before the window is asked too.
    for (let slot = Math.max(0, Math.floor(t0 / SLOT_S) - 1); slot * SLOT_S < t1; slot++) {
      scratch.length = 0;
      slotCalls(seed, colony, slot, scratch);
      for (let i = 0; i < scratch.length; i++) {
        const c = scratch[i];
        if (c.t < t0 || c.t >= t1) continue;
        const voice = voiceOf(seed, colony.id, c.bird);
        const key = slot * 2 + (c.answer ? 1 : 0);
        let busy = false;
        // The same bird's own call just before in this slot (it cannot answer itself), or in the two slots before.
        for (let back = 0; back <= 2 && !busy; back++) {
          if (slot - back < 0) break;
          earlier.length = 0;
          slotCalls(seed, colony, slot - back, earlier);
          for (let j = 0; j < earlier.length; j++) {
            const e = earlier[j];
            if (e.bird !== c.bird || e.t >= c.t) continue;
            if (e.t + callLength(seed, voice, (slot - back) * 2 + (e.answer ? 1 : 0), e.call) > c.t) busy = true;
          }
        }
        if (busy) continue;
        out.push({ t: c.t, kind: "gull", key: `${colony.id}:${slot}:${c.answer ? 1 : 0}`, lasts: callLength(seed, voice, key, c.call), colony: colony.id, bird: c.bird, call: c.call, k: key, variant: voice });
      }
    }
  }
  if (out.length - first > 1) {
    const added = out.splice(first);
    added.sort((a, b) => a.t - b.t);
    for (const c of added) out.push(c);
  }
}

/** The drawn wingbeat: seven sprite frames a second over a cycle of four, the down-wing frame third. */
export const FLAP_FRAMES = 7;
const DOWN = 2;

export interface StartleNote {
  /** World time. */
  t: number;
  flap: boolean;
  /** Which run of keks it belongs to (0 the first); 0 for a flap. */
  run: number;
  note: GullNote;
  take: number;
  rate: number;
  db: number;
}

/**
 * What a gull startled at world time `t0` sounds like over the `aloft` seconds it is up: one to three runs of keks in
 * its first second, and a wingbeat each time its drawn wings come down (frame `floor(t·7 + (g & 3)) & 3` turning to
 * the down-wing frame), fading as it settles. `g` is the bird's hash, as the picture has it.
 */
export function startleNotes(seed: number, g: number, t0: number, aloft: number, out: StartleNote[] = []): StartleNote[] {
  out.length = 0;
  const h = (k: number) => unit(hash2(g >>> 0, k, seed ^ 0x57a7));
  const runs = 1 + Math.floor(3 * h(0));
  for (let r = 0; r < runs; r++) {
    const start = t0 + (r + 0.9 * h(10 + r)) / 3 * 0.75;
    const n = 3 + Math.floor(4 * h(20 + r));
    for (let i = 0; i < n; i++) out.push({ t: start + 0.16 * i, flap: false, run: r, note: (i + r) & 1 ? "e1" : "e0", take: 0, rate: 1.04 - 0.01 * i, db: r === 0 ? 0.6 : -1.5 * r });
  }
  // Downstrokes: the frame index turns to DOWN when t·7 + (g & 3) passes 4k + DOWN.
  const off = g & 3;
  for (let k = Math.ceil((t0 * FLAP_FRAMES + off - DOWN) / 4); ; k++) {
    const t = (4 * k + DOWN - off) / FLAP_FRAMES;
    if (t >= t0 + aloft) break;
    if (t < t0) continue;
    const tau = t - t0;
    // Hardest as it lifts, fading over its time aloft.
    out.push({ t, flap: true, run: 0, note: "e0", take: (k + off) % 3, rate: 1, db: -12 * (tau / aloft) });
  }
  out.sort((a, b) => a.t - b.t);
  return out;
}

/**
 * Whether call `k` of colony `colony` is still made when only a share `keep` (0–1) of the calls is: at night the
 * colonies roost (levels.ts NIGHT_GULLS). Seeded, so the same calls fall silent every time; a smaller share keeps a
 * subset of a larger one's.
 */
export function nightKeeps(seed: number, colony: number, k: number, keep: number): boolean {
  if (keep >= 1) return true;
  if (keep <= 0) return false;
  return (hash2(colony * 4099 + k, 0x6e17, seed) & 0xffff) / 65536 < keep;
}
