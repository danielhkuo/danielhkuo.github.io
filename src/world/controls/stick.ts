// The floating stick a thumb puts down: its base appears under the thumb, the knob follows the thumb up to `travel`,
// and past that the base is dragged after the thumb so steering never sticks at the rim. Pure: positions in, a
// direction out. Lengths are CSS pixels.

export interface StickFeel {
  /** How far the knob travels from the base, px: a deflection of `travel` reads as 1. */
  travel: number;
  /** A radial dead zone, as a share of `travel`: inside it the stick reads 0, past it the reading starts from 0. */
  dead: number;
}

/** Starting numbers, to tune on a phone (spec 4.1, 4.2). */
export const STICK: StickFeel = { travel: 48, dead: 0.12 };

export interface Stick {
  baseX: number;
  baseY: number;
  /** Where the thumb is. */
  x: number;
  y: number;
}

/** What the stick says: a direction scaled by how far it is pushed (0–1), screen axes (y down). */
export interface StickRead {
  x: number;
  y: number;
  /** Length of (x, y), 0–1. */
  mag: number;
}

export const STILL: StickRead = { x: 0, y: 0, mag: 0 };

/** A stick put down by a thumb at (x, y): the base is under the thumb. */
export function putDown(x: number, y: number): Stick {
  return { baseX: x, baseY: y, x, y };
}

/** The thumb moved to (x, y). Past `travel` from the base, the base comes after it, keeping `travel` between them. */
export function moveThumb(s: Stick, x: number, y: number, feel: StickFeel = STICK): Stick {
  const dx = x - s.baseX;
  const dy = y - s.baseY;
  const d = Math.hypot(dx, dy);
  if (d <= feel.travel) return { baseX: s.baseX, baseY: s.baseY, x, y };
  const k = (d - feel.travel) / d;
  return { baseX: s.baseX + dx * k, baseY: s.baseY + dy * k, x, y };
}

/** Where the knob is drawn: at the thumb, never past `travel` from the base. */
export function knobAt(s: Stick, feel: StickFeel = STICK): { x: number; y: number } {
  const dx = s.x - s.baseX;
  const dy = s.y - s.baseY;
  const d = Math.hypot(dx, dy);
  if (d <= feel.travel) return { x: s.x, y: s.y };
  return { x: s.baseX + (dx * feel.travel) / d, y: s.baseY + (dy * feel.travel) / d };
}

/** The reading: zero inside the dead zone, then rescaled so it rises from 0 at the dead zone's edge to 1 at `travel`. */
export function readStick(s: Stick, feel: StickFeel = STICK): StickRead {
  const dx = s.x - s.baseX;
  const dy = s.y - s.baseY;
  const d = Math.hypot(dx, dy);
  const m = Math.min(1, d / feel.travel);
  if (m <= feel.dead || d === 0) return STILL;
  const mag = (m - feel.dead) / (1 - feel.dead);
  return { x: (dx / d) * mag, y: (dy / d) * mag, mag };
}
