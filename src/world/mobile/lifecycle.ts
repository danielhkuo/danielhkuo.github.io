// Why a flight on a touch screen is held still (spec 5, "Pausing"). Every reason is a hold; the flight runs only when
// none is left. Some holds lift themselves (the options panel closing); the rest wait for the visitor's Fly on, so
// they can re-grip the phone before the dragon moves. Pure: events in, holds out, and which card the page shows.

export type Hold =
  /** The first card, until Take wing. */
  | "gate"
  /** A phone held upright: until it is turned (or played sideways). */
  | "upright"
  /** The options panel is open. */
  | "options"
  /** The page was hidden, frozen or left: until Fly on. */
  | "away"
  /** Back was pressed: until Fly on. */
  | "back"
  /** Android left fullscreen: until Fly on, which asks for it again. */
  | "fullscreen"
  /** Turned back level from upright, or a stall: wait for the visitor's hands. */
  | "rest";

export type LifeEvent =
  | "takeWing"
  | "flyOn"
  | "hidden"
  | "blur"
  | "stall"
  | "back"
  | "fullscreenLost"
  | "upright"
  | "level"
  | "optionsOpen"
  | "optionsClose";

/** Holds that only Fly on lifts. */
const RESUMABLE: readonly Hold[] = ["away", "back", "fullscreen", "rest"];

export type Card = "gate" | "upright" | "paused" | null;

export type Life = ReadonlySet<Hold>;

export function startLife(gated: boolean): Life {
  return new Set<Hold>(gated ? ["gate"] : []);
}

/** The holds after `e`. While the gate is up, only Take wing, the phone's orientation and the panel count. */
export function lifeAfter(life: Life, e: LifeEvent): Life {
  const next = new Set(life);
  const gated = life.has("gate");
  switch (e) {
    case "takeWing":
      next.delete("gate");
      break;
    case "flyOn":
      for (const h of RESUMABLE) next.delete(h);
      break;
    case "hidden":
    case "blur":
      if (!gated) next.add("away");
      break;
    case "stall":
      if (!gated) next.add("rest");
      break;
    case "back":
      if (!gated) next.add("back");
      break;
    case "fullscreenLost":
      if (!gated) next.add("fullscreen");
      break;
    case "upright":
      next.add("upright");
      break;
    case "level":
      if (next.delete("upright") && !gated) next.add("rest");
      break;
    case "optionsOpen":
      next.add("options");
      break;
    case "optionsClose":
      next.delete("options");
      break;
  }
  return next;
}

export function running(life: Life): boolean {
  return life.size === 0;
}

/** The card the page shows over the flight: the gate first, then the turn-your-phone card, then Paused. */
export function cardOf(life: Life): Card {
  if (life.has("gate")) return "gate";
  if (life.has("upright")) return "upright";
  if (RESUMABLE.some((h) => life.has(h))) return "paused";
  return null;
}
