// S7 steps 1–4: rain carried on a south-west wind, lakes at their spill
// level, discharge, and height above nearest drainage (HAND). On G.

import { NB8_DX, NB8_DY, wrap, wrapIndex } from "../core/torus.ts";
import { accumulate, priorityFlood, receivers } from "./flood.ts";

export interface HydroParams {
  /** Rain on flat land and sea per node. */
  rainBase: number;
  /** Extra rain per unit of rise along the wind, scaled by the moisture carried. */
  orographic: number;
  /** Share of the moisture deficit restored per node over open sea. */
  recharge: number;
  /** Moisture lost per unit of rain dropped. */
  depletion: number;
  /** A basin becomes a lake at ≥ this many nodes … */
  lakeMinNodes: number;
  /** … and ≥ this depth below its spill level; smaller basins are filled. */
  lakeMinDepth: number;
  /** Channels are nodes whose discharge reaches this. */
  qChannel: number;
}

export interface Lake {
  id: number;
  /** Water surface height: the spill level. */
  level: number;
  /** Nodes covered. */
  area: number;
  /** The rim node the lake drains through. */
  outlet: number;
}

export interface HydroResult {
  /** Ground with small basins filled; lake beds keep their depth. */
  ground: Float64Array;
  /** Water surface where there is a lake, else ground. Routing runs on this. */
  surface: Float64Array;
  /** −1, or the lake's id. */
  lakeId: Int32Array;
  lakes: Lake[];
  rain: Float64Array;
  rcv: Int32Array;
  order: Uint32Array;
  /** Accumulated rain, in node-rains. */
  q: Float64Array;
  channel: Uint8Array;
  /** Height above the channel (or sea, or lake) each node drains to; ≥ 0, 0 on channels. */
  hand: Float64Array;
}

const ROUTING_EPS = 1e-6;

/** Moisture swept from south-west to north-east along wrapped diagonals, two laps. */
export function rainfall(h: Float64Array, n: number, isSea: Uint8Array, p: HydroParams): Float64Array {
  const rain = new Float64Array(n * n);
  const rainBase = p.rainBase;
  const orographic = p.orographic;
  const recharge = p.recharge;
  const depletion = p.depletion;

  // Wind is (+1, −1): each line of constant (x + y) mod n is a loop of n nodes.
  // One lap spins moisture up from m = 1; the second lap is the recorded rain.
  for (let s = 0; s < n; s++) {
    let m = 1;
    let prev = wrapIndex(-1, s + 1, n);
    for (let lap = 0; lap < 2; lap++) {
      for (let x = 0; x < n; x++) {
        const y = wrap(s - x, n);
        const i = y * n + x;
        let dropped: number;
        if (isSea[i]) {
          m += recharge * (1 - m);
          dropped = rainBase * m;
        } else {
          const rise = Math.max(0, h[i] - h[prev]);
          dropped = (rainBase + orographic * rise) * m;
          m = Math.max(0, Math.min(1, m - depletion * dropped));
        }
        if (lap === 1) rain[i] = dropped;
        prev = i;
      }
    }
  }
  return rain;
}

/**
 * Successor of the last lake that spills through `outlet` on the natural
 * downhill path. Keeps the outlet's edge from running back into that lake
 * after interior nodes are redirected toward the outlet.
 */
function hopPastOutlet(
  outlet: number,
  rcv: Int32Array,
  lakeId: Int32Array,
  lakes: Lake[],
  isSea: Uint8Array,
): number {
  const nn = isSea.length;
  let exit = rcv[outlet];
  let j = outlet;
  for (let s = 0; s < nn; s++) {
    const next = rcv[j];
    const lid = lakeId[j];
    if (lid >= 0 && lakes[lid].outlet === outlet) exit = next;
    j = next;
    if (j === outlet || isSea[j]) break;
  }
  return exit === outlet ? rcv[outlet] : exit;
}

/** Receivers before donors, by walking upstream from the sea. */
function topoOrder(rcv: Int32Array, isSea: Uint8Array): Uint32Array {
  const nn = isSea.length;
  const donorCount = new Uint32Array(nn);
  for (let i = 0; i < nn; i++) {
    if (isSea[i] === 0) donorCount[rcv[i]]++;
  }
  const ofs = new Uint32Array(nn + 1);
  let sum = 0;
  for (let i = 0; i < nn; i++) {
    ofs[i] = sum;
    sum += donorCount[i];
  }
  ofs[nn] = sum;
  const donors = new Uint32Array(sum);
  const cursor = new Uint32Array(nn);
  for (let i = 0; i < nn; i++) cursor[i] = ofs[i];
  for (let i = 0; i < nn; i++) {
    if (isSea[i] === 0) {
      const j = rcv[i];
      donors[cursor[j]++] = i;
    }
  }

  const order = new Uint32Array(nn);
  const seen = new Uint8Array(nn);
  let qt = 0;
  for (let i = 0; i < nn; i++) {
    if (isSea[i]) {
      order[qt++] = i;
      seen[i] = 1;
    }
  }
  let qh = 0;
  while (qh < qt) {
    const i = order[qh++];
    const end = ofs[i + 1];
    for (let p = ofs[i]; p < end; p++) {
      const d = donors[p];
      if (seen[d]) continue;
      seen[d] = 1;
      order[qt++] = d;
    }
  }
  // A cycle would be unreachable from the sea; append it so the array is complete.
  if (qt < nn) {
    for (let i = 0; i < nn; i++) {
      if (seen[i]) continue;
      order[qt++] = i;
    }
  }
  return order;
}

export function hydrology(h: Float64Array, n: number, isSea: Uint8Array, p: HydroParams): HydroResult {
  const nn = n * n;
  const rain = rainfall(h, n, isSea, p);

  const F = priorityFlood(h, n, isSea, 0).filled;
  const ground = new Float64Array(h);
  const surface = new Float64Array(h);
  const lakeId = new Int32Array(nn);
  lakeId.fill(-1);

  const seen = new Uint8Array(nn);
  const queue = new Uint32Array(nn);
  const members = new Uint32Array(nn);
  let cursor = 0;
  const lakeStart: number[] = [];
  const lakes: Lake[] = [];

  for (let i = 0; i < nn; i++) {
    if (isSea[i] || seen[i] || !(F[i] > h[i])) continue;
    const level = F[i];
    let qh = 0;
    let qt = 0;
    queue[qt++] = i;
    seen[i] = 1;
    const base = cursor;
    let maxDepth = 0;
    while (qh < qt) {
      const c = queue[qh++];
      members[cursor++] = c;
      const depth = level - h[c];
      if (depth > maxDepth) maxDepth = depth;
      const x = c % n;
      const y = (c - x) / n;
      for (let k = 0; k < 8; k++) {
        const j = wrapIndex(x + NB8_DX[k], y + NB8_DY[k], n);
        if (seen[j] || isSea[j] || !(F[j] > h[j]) || F[j] !== level) continue;
        seen[j] = 1;
        queue[qt++] = j;
      }
    }
    const count = cursor - base;
    if (count >= p.lakeMinNodes && maxDepth >= p.lakeMinDepth) {
      const id = lakes.length;
      lakes.push({ id, level, area: count, outlet: -1 });
      lakeStart.push(base);
      for (let t = base; t < cursor; t++) {
        const c = members[t];
        lakeId[c] = id;
        surface[c] = level;
      }
    } else {
      for (let t = base; t < cursor; t++) {
        const c = members[t];
        ground[c] = level;
        surface[c] = level;
      }
      cursor = base;
    }
  }

  for (let L = 0; L < lakes.length; L++) {
    const level = lakes[L].level;
    const start = lakeStart[L];
    const end = start + lakes[L].area;
    let bestH = Infinity;
    let best = -1;
    let anyH = Infinity;
    let any = -1;
    for (let t = start; t < end; t++) {
      const c = members[t];
      const x = c % n;
      const y = (c - x) / n;
      for (let k = 0; k < 8; k++) {
        const j = wrapIndex(x + NB8_DX[k], y + NB8_DY[k], n);
        if (lakeId[j] >= 0) continue;
        const sj = surface[j];
        if (sj < anyH || (sj === anyH && j < any)) {
          anyH = sj;
          any = j;
        }
        if (sj > level) continue;
        if (sj < bestH || (sj === bestH && j < best)) {
          bestH = sj;
          best = j;
        }
      }
    }
    lakes[L].outlet = best >= 0 ? best : any;
  }

  const slope = priorityFlood(surface, n, isSea, ROUTING_EPS).filled;
  const rcv = receivers(slope, n, isSea, null).rcv;

  const hopTo = new Int32Array(nn);
  const hopped = new Uint8Array(nn);
  for (let L = 0; L < lakes.length; L++) {
    const o = lakes[L].outlet;
    if (o < 0 || hopped[o] || isSea[o]) continue;
    hopped[o] = 1;
    hopTo[o] = hopPastOutlet(o, rcv, lakeId, lakes, isSea);
  }

  seen.fill(0);
  for (let L = 0; L < lakes.length; L++) {
    const id = lakes[L].id;
    const outlet = lakes[L].outlet;
    if (outlet < 0) continue;
    const ox = outlet % n;
    const oy = (outlet - ox) / n;
    let qh = 0;
    let qt = 0;
    for (let k = 0; k < 8; k++) {
      const j = wrapIndex(ox + NB8_DX[k], oy + NB8_DY[k], n);
      if (lakeId[j] !== id || seen[j]) continue;
      seen[j] = 1;
      rcv[j] = outlet;
      queue[qt++] = j;
    }
    while (qh < qt) {
      const c = queue[qh++];
      const x = c % n;
      const y = (c - x) / n;
      for (let k = 0; k < 8; k++) {
        const j = wrapIndex(x + NB8_DX[k], y + NB8_DY[k], n);
        if (lakeId[j] !== id || seen[j]) continue;
        seen[j] = 1;
        rcv[j] = c;
        queue[qt++] = j;
      }
    }
  }
  for (let L = 0; L < lakes.length; L++) {
    const o = lakes[L].outlet;
    if (o < 0 || isSea[o] || !hopped[o]) continue;
    rcv[o] = hopTo[o];
  }

  for (let i = 0; i < nn; i++) {
    if (lakeId[i] < 0) surface[i] = slope[i];
  }

  const order = topoOrder(rcv, isSea);
  const q = accumulate(order, rcv, isSea, rain);

  const channel = new Uint8Array(nn);
  const qChannel = p.qChannel;
  for (let i = 0; i < nn; i++) {
    if (isSea[i] === 0 && lakeId[i] < 0 && q[i] >= qChannel) channel[i] = 1;
  }

  const hand = new Float64Array(nn);
  const target = new Int32Array(nn);
  for (let k = 0; k < nn; k++) {
    const i = order[k];
    if (isSea[i] || lakeId[i] >= 0 || channel[i]) {
      target[i] = i;
    } else {
      const t = target[rcv[i]];
      target[i] = t;
      const drop = surface[i] - surface[t];
      hand[i] = drop > 0 ? drop : 0;
    }
  }

  return { ground, surface, lakeId, lakes, rain, rcv, order, q, channel, hand };
}
