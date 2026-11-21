// The listener's choices: whether sound is wanted, and how loud. Kept in localStorage; missing or unreadable storage
// means off. Sound is off until asked for (WCAG 1.4.2, G171).

/** "on" | "off". */
export const KEY_WANTED = "world.sound";
/** 0 … 100. */
export const KEY_VOLUME = "world.sound.volume";
/** "on" | "off": read only once the headphones (HRTF) phase lands. */
export const KEY_HEADPHONES = "world.sound.headphones";

/** Half: −12 dB. (It was 0.7; the owner found that really loud on first hearing, 2026-11-19.) */
export const DEFAULT_VOLUME = 0.5;

/** The slice of Storage the prefs use. */
export interface PrefStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export interface StoredPrefs {
  wanted: boolean;
  /** 0 … 1. */
  volume: number;
  headphones: boolean;
}

function read(store: PrefStore | null, key: string): string | null {
  try {
    return store ? store.getItem(key) : null;
  } catch {
    return null;
  }
}

function write(store: PrefStore | null, key: string, value: string): void {
  try {
    store?.setItem(key, value);
  } catch {
    // storage full or blocked: the choice lasts for this visit only
  }
}

export function readPrefs(store: PrefStore | null): StoredPrefs {
  const v = read(store, KEY_VOLUME);
  const n = v === null || v.trim() === "" ? NaN : Number(v);
  return {
    wanted: read(store, KEY_WANTED) === "on",
    volume: Number.isFinite(n) ? Math.min(1, Math.max(0, n / 100)) : DEFAULT_VOLUME,
    headphones: read(store, KEY_HEADPHONES) === "on",
  };
}

export function writeWanted(store: PrefStore | null, wanted: boolean): void {
  write(store, KEY_WANTED, wanted ? "on" : "off");
}

export function writeVolume(store: PrefStore | null, volume: number): void {
  write(store, KEY_VOLUME, String(Math.round(Math.min(1, Math.max(0, volume)) * 100)));
}

/** The volume law: the master gain is the slider squared, so half way (the default) is −12 dB and 0.7 is −6 dB. */
export function volumeGain(volume: number): number {
  const v = Math.min(1, Math.max(0, volume));
  return v * v;
}
