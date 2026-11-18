// Landing: the states that take the flier from flight down onto a landmark and back up, and the guidance that coils it
// down (design: specs/2026-11-18-landing-and-codex-design.md). Each frame the head steers for the tangent of an orbit
// round the landmark whose radius shrinks with the angle swept, slowing and sinking as it goes; the body follows the
// head's path, so it is left lying in a coil. The sweep ends at the landmark's south point, so the head rests in
// front of the building, facing across the camera. Pure: nothing passed in is changed.

import { torusDelta, wrap } from "../core/torus.ts";
import { CLIMB, DT_MAX, MIN_GAP, stepFlight, type FlightInput, type FlightState, type Terrain } from "../runtime/flight.ts";

/** Within this many cells of a landmark the page offers to land there: about two seconds of cruise. */
export const NEAR = 110;
/** The site just left stays quiet until the flier is this many times NEAR from it. */
export const QUIET_FACTOR = 1.25;
/** Fastest turn while landing, radians a second (flight's TURN is 1.6). */
export const MAX_TURN = 3.2;
/** How fast the dragon goes round once the orbit is small, radians a second: 2.9 s a turn. */
export const ORBIT_RATE = 2.2;
/** The orbit starts no wider than this, cells. */
export const START_RADIUS = 40;
/** The orbit has shrunk to the rest radius by this share of the sweep, and holds it after. */
export const SHRINK_END = 0.55;
/** It has sunk to rest height by this share of the sweep. */
export const SINK_END = 0.85;
/** Over this last share of the sweep it slows to rest. */
export const REST_PART = 0.15;
/** It crawls no slower than this until the sweep is done, cells a second. */
export const CRAWL = 3;
/** How far ahead the guidance looks when it bends in or out toward the orbit, cells. */
export const LOOK = 10;
/** How hard it turns toward the heading it wants: radians a second for each radian off. */
export const GAIN = 4;
/** At rest the head is this far over the ground: the body's own radius. */
export const REST_LIFT = 2.5;
/** A landing still going after this many seconds ends where it is. */
export const LANDING_CAP = 12;
/** A sweep is at least this many turns, so there is a coil to lie in. */
export const SWEEP_MIN = 0.9;
/** The camera moves between the flier and the landmark at this share a second. */
export const FOCUS_RATE = 1.4;
/** Rates (per second) at which speed and bank ease while landing. */
const SPEED_EASE = 3;
const BANK_EASE = 6;

const TAU = 2 * Math.PI;

/** A landmark the dragon can land at: the centre of its building and the radius its coil rests at. */
export interface Target {
  id: string;
  x: number;
  y: number;
  radius: number;
}

/** A landing in progress. */
export interface Approach {
  id: string;
  /** Centre of the coil, unwrapped near where the landing began. */
  cx: number;
  cy: number;
  /** Radius the coil rests at, and the orbit's radius at the start. */
  radius: number;
  r0: number;
  /** 1 goes round clockwise on screen (east, south, west), −1 the other way. */
  dir: 1 | -1;
  /** Angle to sweep round the centre, radians, and the angle swept so far. */
  sweep: number;
  swept: number;
  /** Angle round the centre at the last step. */
  phi: number;
  /** Speed and height it came in with. */
  v0: number;
  alt0: number;
  /** Seconds since it began. */
  time: number;
}

export type Phase =
  | { kind: "flying"; quiet: string | null }
  | { kind: "landing"; approach: Approach }
  | { kind: "landed"; id: string };

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

function smooth(u: number): number {
  const c = clamp(u, 0, 1);
  return c * c * (3 - 2 * c);
}

/** a − b as an angle in (−π, π]. */
function turned(a: number, b: number): number {
  let d = (a - b) % TAU;
  if (d > Math.PI) d -= TAU;
  else if (d <= -Math.PI) d += TAU;
  return d;
}

/** The nearest target within `within` cells of (x, y) on the torus, leaving out `skip`; null when none is. */
export function nearest(x: number, y: number, targets: readonly Target[], n: number, within = NEAR, skip: string | null = null): Target | null {
  let best: Target | null = null;
  let bestD = Infinity;
  for (const t of targets) {
    if (t.id === skip) continue;
    const d = Math.hypot(torusDelta(x, t.x, n), torusDelta(y, t.y, n));
    if (d <= within && d < bestD) {
      best = t;
      bestD = d;
    }
  }
  return best;
}

/** The landmark the page offers to land at: the nearest one in reach, while flying, unless it is the one just left. */
export function offered(phase: Phase, x: number, y: number, targets: readonly Target[], n: number): Target | null {
  return phase.kind === "flying" ? nearest(x, y, targets, n, NEAR, phase.quiet) : null;
}

/**
 * The plan for coming down at `target` from `s`: round the way the flier is already going, the orbit starting at its
 * distance (no wider than START_RADIUS), the sweep ending at the south point after at least SWEEP_MIN turns.
 */
export function beginLanding(s: FlightState, target: Target, n: number): Approach {
  const dx = torusDelta(target.x, s.x, n), dy = torusDelta(target.y, s.y, n);
  const r = Math.hypot(dx, dy);
  const phi = r > 1e-9 ? Math.atan2(dy, dx) : s.heading - Math.PI / 2;
  // Going round clockwise on screen, the way ahead at angle φ is (−sin φ, cos φ).
  const dir: 1 | -1 = -Math.cos(s.heading) * Math.sin(phi) + Math.sin(s.heading) * Math.cos(phi) >= 0 ? 1 : -1;
  let sweep = (((dir * (Math.PI / 2 - phi)) % TAU) + TAU) % TAU;
  if (sweep < SWEEP_MIN * TAU) sweep += TAU;
  return {
    id: target.id,
    cx: s.x - dx,
    cy: s.y - dy,
    radius: target.radius,
    r0: clamp(r, target.radius, Math.max(target.radius, START_RADIUS)),
    dir,
    sweep,
    swept: 0,
    phi,
    v0: Math.max(s.speed, 2 * CRAWL),
    alt0: s.alt,
    time: 0,
  };
}

/**
 * One step of the coil. The orbit's radius eases from r0 to the rest radius by SHRINK_END of the sweep; the head aims
 * along the orbit's tangent, bent toward it by atan((r − r*) / LOOK), turning no faster than MAX_TURN. Its speed is the
 * lesser of what it came in with and ORBIT_RATE round the orbit, less while it faces away, and falls to a crawl over
 * the last REST_PART. Its height sinks to the ground under it plus REST_LIFT by SINK_END. Done when the sweep is, or at
 * LANDING_CAP: then it stops.
 */
function stepApproach(s: FlightState, a: Approach, dt: number, terrain: Terrain, n: number): { s: FlightState; a: Approach; done: boolean } {
  const step = clamp(dt, 0, DT_MAX);
  const dx = torusDelta(a.cx, s.x, n), dy = torusDelta(a.cy, s.y, n);
  const r = Math.hypot(dx, dy);
  const phi = r > 1e-9 ? Math.atan2(dy, dx) : a.phi;
  const swept = a.swept + a.dir * turned(phi, a.phi);
  const u = clamp(swept / a.sweep, 0, 1);

  const rStar = a.radius + (a.r0 - a.radius) * (1 - smooth(u / SHRINK_END));
  const want = phi + a.dir * (Math.PI / 2 + Math.atan((r - rStar) / LOOK));
  const err = turned(want, s.heading);
  // The turn that holds an orbit of radius r at this speed, plus a correction toward the heading it wants: without the
  // first, the correction lags the orbit by enough to cancel the bend in, and the coil never closes.
  const rate = clamp(a.dir * s.speed / Math.max(r, a.radius) + GAIN * err, -MAX_TURN, MAX_TURN);
  const heading = s.heading + rate * step;
  const bank = s.bank + (clamp(rate / MAX_TURN, -1, 1) - s.bank) * Math.min(1, BANK_EASE * step);

  let vStar = Math.min(a.v0, ORBIT_RATE * Math.max(r, a.radius)) * (0.4 + 0.6 * Math.max(0, Math.cos(err)));
  if (u > 1 - REST_PART) vStar *= (1 - u) / REST_PART;
  vStar = Math.max(CRAWL, vStar);
  const speed = s.speed + (vStar - s.speed) * Math.min(1, SPEED_EASE * step);

  const x = wrap(s.x + Math.cos(heading) * speed * step, n);
  const y = wrap(s.y + Math.sin(heading) * speed * step, n);
  const ground = terrain.groundHeight(x, y);
  const altStar = a.alt0 + (ground + REST_LIFT - a.alt0) * smooth(u / SINK_END);
  const alt = Math.max(s.alt + clamp(altStar - s.alt, -CLIMB * step, CLIMB * step), ground + MIN_GAP);

  const time = a.time + step;
  const done = swept >= a.sweep || time >= LANDING_CAP;
  return {
    s: { x, y, heading, speed: done ? 0 : speed, alt, bank },
    a: { ...a, swept, phi, time },
    done,
  };
}

/** Lands at the landmark on offer, if there is one; otherwise the phase is unchanged. */
export function land(phase: Phase, s: FlightState, targets: readonly Target[], n: number): Phase {
  const t = offered(phase, s.x, s.y, targets, n);
  return t ? { kind: "landing", approach: beginLanding(s, t, n) } : phase;
}

/** Takes off from the landmark the dragon rests at; the site stays quiet until it is left behind. */
export function takeOff(phase: Phase): Phase {
  return phase.kind === "landed" ? { kind: "flying", quiet: phase.id } : phase;
}

/** Breaks off a landing and flies on; the site stays quiet until it is left behind. */
export function pullUp(phase: Phase): Phase {
  return phase.kind === "landing" ? { kind: "flying", quiet: phase.approach.id } : phase;
}

/**
 * One frame. Flying steps the flight model with `input` and lets the quiet site go once the flier is QUIET_FACTOR ×
 * NEAR from it; landing steps the coil, ignoring `input`, and reports the site in `landed` on the step it comes to
 * rest; landed holds still, its bank settling.
 */
export function advance(
  phase: Phase, s: FlightState, input: FlightInput, dt: number, terrain: Terrain, n: number, targets: readonly Target[],
): { phase: Phase; s: FlightState; landed: string | null } {
  if (phase.kind === "flying") {
    const next = stepFlight(s, input, dt, terrain, n);
    if (phase.quiet === null) return { phase, s: next, landed: null };
    const left = targets.find((t) => t.id === phase.quiet);
    const far = !left || Math.hypot(torusDelta(next.x, left.x, n), torusDelta(next.y, left.y, n)) > NEAR * QUIET_FACTOR;
    return { phase: far ? { kind: "flying", quiet: null } : phase, s: next, landed: null };
  }
  if (phase.kind === "landing") {
    const r = stepApproach(s, phase.approach, dt, terrain, n);
    if (r.done) return { phase: { kind: "landed", id: phase.approach.id }, s: r.s, landed: phase.approach.id };
    return { phase: { kind: "landing", approach: r.a }, s: r.s, landed: null };
  }
  const settle = 1 - Math.min(1, BANK_EASE * clamp(dt, 0, DT_MAX));
  return { phase, s: { ...s, speed: 0, bank: s.bank * settle }, landed: null };
}

/** The camera's share of the way from the flier to the landmark, moved on by dt toward 1 (`on`) or 0. */
export function easeFocus(focus: number, on: boolean, dt: number): number {
  const step = Math.max(0, dt) * FOCUS_RATE;
  return on ? Math.min(1, focus + step) : Math.max(0, focus - step);
}

/**
 * Where the camera centres (view.setCamera's arguments): on the flier at focus 0, on the landmark (its point `alt`
 * units up) at focus 1, eased between, the short way round the world.
 */
export function cameraAt(s: FlightState, site: { x: number; y: number; alt: number } | null, focus: number, n: number): { x: number; y: number } {
  const fx = s.x, fy = s.y - s.alt / 0.8;
  if (!site || focus <= 0) return { x: fx, y: fy };
  const sx = s.x + torusDelta(s.x, site.x, n), sy = s.y + torusDelta(s.y, site.y, n) - site.alt / 0.8;
  const w = smooth(focus);
  return { x: fx + (sx - fx) * w, y: fy + (sy - fy) * w };
}
