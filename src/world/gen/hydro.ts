// S7 steps 1–4: rain carried on a south-west wind, lakes at their spill
// level, discharge, and height above nearest drainage (HAND). On G.

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

/** Moisture swept from south-west to north-east along wrapped diagonals, two laps. */
export function rainfall(h: Float64Array, n: number, isSea: Uint8Array, p: HydroParams): Float64Array {
  throw new Error("not implemented");
}

export function hydrology(h: Float64Array, n: number, isSea: Uint8Array, p: HydroParams): HydroResult {
  throw new Error("not implemented");
}
