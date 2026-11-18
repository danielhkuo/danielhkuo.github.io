// Discoveries: rare sights the visitor has seen, remembered in localStorage, with a caption that shows the moment
// something new is found.

/** The part of Storage this uses; null when the browser refuses storage (private windows, blocked cookies). */
export interface KeyValue {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export const DISCOVERY_KEY = "world:discoveries";
/** How long a caption shows, in milliseconds. */
export const CAPTION_MS = 4000;

export interface Discoveries {
  /** Records `id`; true (and shows `label` as the caption) only the first time it is ever seen. */
  discover(id: string, label: string): boolean;
  /** The caption to show at time `now()`, or null when none is showing. */
  caption(): string | null;
  /** Every id discovered so far, in the order found. */
  list(): string[];
}

/**
 * Reads earlier discoveries from `store` under DISCOVERY_KEY (a JSON array of ids; anything else counts as none). Every
 * read and write is guarded: a store that throws, or no store at all, still works for this visit.
 */
export function createDiscoveries(store: KeyValue | null, now: () => number): Discoveries {
  void store;
  void now;
  throw new Error("not implemented");
}
