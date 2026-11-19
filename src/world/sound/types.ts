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

export interface FallPoint {
  x: number;
  y: number;
  h: number;
  run: number;
  w: number;
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

export const EMPTY_CENSUS: Census = { sources: [] };

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
