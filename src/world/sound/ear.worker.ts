// The ear, off the main thread. The page copies the frame's rows a few a frame (a few microseconds) and posts them
// here ten times a second; the scans run here and the Hearing is posted back. So the frame loop pays for a copy, not
// for listening.
//
// Part of the engine's thinking is here too (engine/brain.ts): with each pass comes where the dragon now is, and the
// lanes' waves and the scheduler's cues go back with the Hearing, worked out against it. No message is added.

import { createEar } from "./ear.ts";
import { createBrain, type Brain, type BrainAsk, type BrainInit, type BrainReply } from "./engine/brain.ts";
import { packHearing, type Pose } from "./types.ts";

const scope = self as unknown as {
  onmessage: ((e: MessageEvent) => void) | null;
  postMessage(m: unknown, transfer: Transferable[]): void;
};

export type EarRequest =
  /** The land: n cells a side, and for each node of the gN × gN grid whether it is sea (1). */
  | { kind: "world"; n: number; gN: number; sea: Uint8Array | null }
  | { kind: "warp"; warp: Uint8Array }
  /** The lanes and the scheduler are to be worked here from now on; then a cue source whose voice exists; then a mute or a hide. */
  | { kind: "brain"; init: BrainInit }
  | { kind: "source"; source: string }
  | { kind: "clear" }
  /**
   * One pass: the frame `rect` (its pixel rows, as the page copied them, or only its lattice when `packed`), the dragon,
   * and the lane mask. The buffer comes back with the Hearing.
   */
  | { kind: "pass"; bake: Uint32Array; packed: boolean; heard: Float64Array; rect: { x: number; y: number; w: number; h: number }; x: number; y: number; alt: number; t: number; lanes: number; brain?: BrainAsk | null };

/**
 * Both buffers come back, transferred: the lattice to be filled again, and the Hearing packed as numbers (types.ts);
 * with them the Brain's answer, where there is one.
 */
export interface EarReply {
  heard: Float64Array;
  bake: Uint32Array;
  brain?: BrainReply;
}

const ear = createEar();
const pose: Pose = { t: 0, dt: 0, x: 0, y: 0, alt: 0, heading: 0, speed: 0, bank: 0, rest: 0 };
let brain: Brain | null = null;

scope.onmessage = (event: MessageEvent) => {
  const m = event.data as EarRequest;
  if (m.kind === "brain") {
    brain = createBrain(m.init);
  } else if (m.kind === "source") {
    brain?.source(m.source);
  } else if (m.kind === "clear") {
    brain?.clear();
  } else if (m.kind === "world") {
    let land: { gN: number; ground: Int8Array } | null = null;
    if (m.sea) {
      const ground = new Int8Array(m.sea.length);
      for (let i = 0; i < ground.length; i++) ground[i] = m.sea[i] ? -1 : 1;
      land = { gN: m.gN, ground };
    }
    ear.setWorld({ n: m.n, land });
  } else if (m.kind === "warp") {
    ear.setWarp(m.warp);
  } else {
    pose.t = m.t;
    pose.x = m.x;
    pose.y = m.y;
    pose.alt = m.alt;
    // The lanes live here once the brain does: their mask is its own.
    const hearing = ear.pass(pose, { bake: m.bake, rect: m.rect, t: m.t, packed: m.packed }, brain && m.brain ? brain.mask() : m.lanes);
    packHearing(hearing, m.heard);
    const reply: EarReply = { heard: m.heard, bake: m.bake };
    if (brain && m.brain) reply.brain = brain.step(m.brain, hearing);
    scope.postMessage(reply, [m.bake.buffer as ArrayBuffer, m.heard.buffer as ArrayBuffer]);
  }
};
