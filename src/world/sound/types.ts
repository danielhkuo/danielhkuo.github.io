// The plain objects the world's sound passes about (design: docs/superpowers/specs/2026-11-18-world-sound-design.md,
// §1.3). All are JSON-safe. `t` is always the page clock in seconds, the same `t` the live layers get.

/** The dragon this frame. `rest` is restShare(phase): 0 flying, 1 landed. */
export interface Pose {
  t: number;
  dt: number;
  x: number;
  y: number;
  alt: number;
  /** Radians: 0 east, π/2 south. */
  heading: number;
  /** Cells a second. */
  speed: number;
  /** −1 (left) … 1 (right). */
  bank: number;
  rest: number;
}

/** An area source as the ear sums it: energy, direction sum (relative to the dragon), mean distance. */
export interface Area {
  e: number;
  dx: number;
  dy: number;
  d: number;
}

export interface ShorePoint {
  sector: number;
  cell: number;
  /** 0 calm, 1 beach, 2 shingle, 3 rock. */
  kind: 0 | 1 | 2 | 3;
  bend: number;
  x: number;
  y: number;
  w: number;
}

/** A waterfall in the frame: its foot's place and height, how many rows it falls (9 or more is tall), its weight, and how far it is inside the frame's edge (0 at the edge … 1 well inside). */
export interface FallPoint {
  x: number;
  y: number;
  h: number;
  run: number;
  w: number;
  edge: number;
}

export interface Startle {
  key: number;
  x: number;
  y: number;
  t0: number;
}

/** What the ear found in the land around the dragon. */
export interface Hearing {
  t: number;
  /** Share of the frame that was baked. */
  ready: number;
  /** The lane mask this pass used. */
  lanes: number;
  /** Beach, shingle, rock: in the frame, beyond the lanes' reach. */
  surf: [Area, Area, Area];
  /** Coast the bake does not speak for, from the land grid. */
  far: Area;
  /** Share of the frame that is open sea. */
  sea: number;
  river: Area;
  stream: Area;
  white: Area;
  shores: ShorePoint[];
  falls: FallPoint[];
  startled: Startle[];
}

export interface Pt {
  x: number;
  y: number;
}

/** A wheeling gull, as live/life.ts places it (filled in with the gulls' phase). */
export interface Wheeler {
  colony: number;
  x: number;
  y: number;
  r: number;
  h: number;
}

/** The fixed sites and anchors. */
export interface Places {
  worldId: string;
  seed: number;
  n: number;
  forced: boolean;
  abbeys: Pt[];
  towns: Pt[];
  lighthouses: Pt[];
  gulls: Wheeler[];
  wonders: { type: string; x: number; y: number; level: number; height: number; anchors: Record<string, [number, number]> }[];
}

/** A point source alive now, with its world position (filled in as the voices arrive). */
export interface CensusSource {
  kind: string;
  key: number;
  x: number;
  y: number;
  h: number;
}

export interface Census {
  /** The world's size in cells: positions wrap every n. */
  n: number;
  sources: CensusSource[];
}

/**
 * One scheduled sound event. `t` is the world time its sound starts. `key` names it in its kind's ledger. A cue that
 * leads up to a picture event also carries `anchor`, the event's time.
 */
export interface Cue {
  t: number;
  kind: string;
  key: string;
  anchor?: number;
  /** Seconds the sound lasts: how long a ledger remembers it, and how late it can still be joined in progress. */
  lasts?: number;
  /** A soft cue found late starts at once; a sharp one (the default) more than 30 ms late is dropped. */
  soft?: boolean;
  /** A wave's shore cell, its train (0 or 1), its number in the train, and its strength (0 a lull … 3 the big one). */
  cell?: number;
  train?: number;
  k?: number;
  strength?: number;
  /** Kind-specific numbers (variant, level in dB, rate …). */
  variant?: number;
  db?: number;
  rate?: number;
  /** A bell's stroke: the hour, the bell (0 the treble … 4 the tenor, 5 the tenor under the hour's hammer), which ring take, and the levels of its ring and its strike, dB. */
  H?: number;
  bell?: number;
  take?: number;
  ringDb?: number;
  strikeDb?: number;
}

/** What the listener chose, and what the device is. `calm` is reduced motion. */
export interface Prefs {
  /** 0 … 1; the master gain is its square. */
  volume: number;
  headphones: boolean;
  calm: boolean;
  touch: boolean;
}

export type SoundState = "off" | "waiting" | "running" | "suspended";

export function emptyArea(): Area {
  return { e: 0, dx: 0, dy: 0, d: 0 };
}

/** A Hearing of open, silent land: what the ear reports before it has scanned anything. */
export function emptyHearing(t = 0): Hearing {
  return {
    t, ready: 0, lanes: 0,
    surf: [emptyArea(), emptyArea(), emptyArea()],
    far: emptyArea(), sea: 0,
    river: emptyArea(), stream: emptyArea(), white: emptyArea(),
    shores: [], falls: [], startled: [],
  };
}

export const EMPTY_CENSUS: Census = { n: 10240, sources: [] };

/** A Hearing of its own, sharing nothing with `h`: the ear reuses its Hearings, so whoever keeps one copies it. */
export function copyHearing(h: Hearing): Hearing {
  const area = (a: Area): Area => ({ e: a.e, dx: a.dx, dy: a.dy, d: a.d });
  return {
    t: h.t, ready: h.ready, lanes: h.lanes,
    surf: [area(h.surf[0]), area(h.surf[1]), area(h.surf[2])],
    far: area(h.far), sea: h.sea,
    river: area(h.river), stream: area(h.stream), white: area(h.white),
    shores: h.shores.map((s) => ({ ...s })),
    falls: h.falls.map((f) => ({ ...f })),
    startled: h.startled.map((s) => ({ ...s })),
  };
}

/** Shore points and falls a Hearing can carry, and the numbers a packed Hearing takes. */
export const MAX_SHORES = 16;
export const MAX_FALLS = 4;
export const HEARING_FLOATS = 6 + 7 * 4 + MAX_SHORES * 7 + MAX_FALLS * 6;

const AREAS = (h: Hearing): Area[] => [h.surf[0], h.surf[1], h.surf[2], h.far, h.river, h.stream, h.white];

/** A Hearing as plain numbers in `out` (HEARING_FLOATS long): what the ear's worker hands back, transferred, not cloned. */
export function packHearing(h: Hearing, out: Float64Array): void {
  const n = Math.min(MAX_SHORES, h.shores.length), falls = Math.min(MAX_FALLS, h.falls.length);
  out[0] = h.t;
  out[1] = h.ready;
  out[2] = h.lanes;
  out[3] = h.sea;
  out[4] = n;
  out[5] = falls;
  let at = 6;
  for (const a of AREAS(h)) {
    out[at++] = a.e;
    out[at++] = a.dx;
    out[at++] = a.dy;
    out[at++] = a.d;
  }
  for (let i = 0; i < n; i++) {
    const p = h.shores[i];
    out[at++] = p.sector;
    out[at++] = p.cell;
    out[at++] = p.kind;
    out[at++] = p.bend;
    out[at++] = p.x;
    out[at++] = p.y;
    out[at++] = p.w;
  }
  for (let i = 0; i < falls; i++) {
    const f = h.falls[i];
    out[at++] = f.x;
    out[at++] = f.y;
    out[at++] = f.h;
    out[at++] = f.run;
    out[at++] = f.w;
    out[at++] = f.edge;
  }
}

/** A Hearing with its shore points made once, to be filled again and again by `unpackHearing` with no allocation. */
export function pooledHearing(): { hearing: Hearing; pool: ShorePoint[]; falls: FallPoint[] } {
  const pool: ShorePoint[] = [];
  for (let i = 0; i < MAX_SHORES; i++) pool.push({ sector: 0, cell: 0, kind: 0, bend: 0, x: 0, y: 0, w: 0 });
  const falls: FallPoint[] = [];
  for (let i = 0; i < MAX_FALLS; i++) falls.push({ x: 0, y: 0, h: 0, run: 0, w: 0, edge: 0 });
  return { hearing: emptyHearing(), pool, falls };
}

/** Fills `into` (from `pooledHearing`) from packed numbers. Nothing is allocated. */
export function unpackHearing(from: Float64Array, into: { hearing: Hearing; pool: ShorePoint[]; falls: FallPoint[] }): Hearing {
  const h = into.hearing;
  h.t = from[0];
  h.ready = from[1];
  h.lanes = from[2];
  h.sea = from[3];
  const n = from[4], falls = from[5];
  let at = 6;
  for (let k = 0; k < 7; k++) {
    const a = k < 3 ? h.surf[k] : k === 3 ? h.far : k === 4 ? h.river : k === 5 ? h.stream : h.white;
    a.e = from[at++];
    a.dx = from[at++];
    a.dy = from[at++];
    a.d = from[at++];
  }
  h.shores.length = 0;
  for (let i = 0; i < n; i++) {
    const p = into.pool[i];
    p.sector = from[at++];
    p.cell = from[at++];
    p.kind = from[at++] as 0 | 1 | 2 | 3;
    p.bend = from[at++];
    p.x = from[at++];
    p.y = from[at++];
    p.w = from[at++];
    h.shores.push(p);
  }
  h.falls.length = 0;
  for (let i = 0; i < falls; i++) {
    const f = into.falls[i];
    f.x = from[at++];
    f.y = from[at++];
    f.h = from[at++];
    f.run = from[at++];
    f.w = from[at++];
    f.edge = from[at++];
    h.falls.push(f);
  }
  return h;
}
