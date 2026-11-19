// The ear, off the main thread. The page gathers the frame's lattice a few rows a frame (a few microseconds) and
// posts it here ten times a second; the scans run here and the Hearing is posted back. So the frame loop pays for a
// copy, not for listening.

import { createEar } from "./ear.ts";
import { copyHearing, type Hearing, type Pose } from "./types.ts";

const scope = self as unknown as {
  onmessage: ((e: MessageEvent) => void) | null;
  postMessage(m: unknown, transfer: Transferable[]): void;
};

export type EarRequest =
  /** The land: n cells a side, and for each node of the gN × gN grid whether it is sea (1). */
  | { kind: "world"; n: number; gN: number; sea: Uint8Array | null }
  | { kind: "warp"; warp: Uint8Array }
  /** One pass: the lattice of the frame `rect`, the dragon, and the lane mask. The buffer comes back with the Hearing. */
  | { kind: "pass"; bake: Uint32Array; rect: { x: number; y: number; w: number; h: number }; x: number; y: number; alt: number; t: number; lanes: number };

export interface EarReply {
  hearing: Hearing;
  bake: Uint32Array;
}

const ear = createEar();
const pose: Pose = { t: 0, dt: 0, x: 0, y: 0, alt: 0, heading: 0, speed: 0, bank: 0, rest: 0 };

scope.onmessage = (event: MessageEvent) => {
  const m = event.data as EarRequest;
  if (m.kind === "world") {
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
    const hearing = copyHearing(ear.pass(pose, { bake: m.bake, rect: m.rect, t: m.t, packed: true }, m.lanes));
    scope.postMessage({ hearing, bake: m.bake } satisfies EarReply, [m.bake.buffer as ArrayBuffer]);
  }
};
