// Quest state for the five stops: whether the visitor is following them, and which they have found.
// Pure — nothing here writes the object it was given.

import { torusDelta } from "../core/torus.ts";
import { isStopKey, STOPS, type StopKey } from "./stops.ts";

export const QUEST_KEY = "world:quest";

export type QuestMode = "unasked" | "on" | "off";

export interface QuestState {
  mode: QuestMode;
  found: StopKey[];
}

export interface StopPlace {
  key: StopKey;
  x: number;
  y: number;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function readMode(value: unknown): QuestMode | null {
  if (value === "unasked" || value === "on" || value === "off") return value;
  return null;
}

/** Known stop keys, first occurrence only, in the order stored. */
function readFound(value: unknown): StopKey[] {
  if (!Array.isArray(value)) return [];
  const found: StopKey[] = [];
  for (const item of value) {
    if (isStopKey(item) && !found.includes(item)) found.push(item);
  }
  return found;
}

function orderOf(key: StopKey): number {
  let i = 0;
  for (const stop of STOPS) {
    if (stop.key === key) return i;
    i += 1;
  }
  return i;
}

/** Junk, or a mode we do not know, is "not yet asked". Anything unreadable is too. */
export function parseQuest(raw: string | null): QuestState {
  if (raw === null) return { mode: "unasked", found: [] };
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return { mode: "unasked", found: [] };
  }
  if (!isRecord(data)) return { mode: "unasked", found: [] };
  const mode = readMode(data.mode);
  if (mode === null) return { mode: "unasked", found: [] };
  return { mode, found: readFound(data.found) };
}

/** The text `parseQuest` reads back. */
export function questText(s: QuestState): string {
  return JSON.stringify({ mode: s.mode, found: s.found });
}

/** Sets the mode and keeps what was already found. */
export function choose(s: QuestState, mode: "on" | "off"): QuestState {
  return { mode, found: s.found.slice() };
}

/** Adds `key` once, in the order found, whatever the mode. */
export function find(s: QuestState, key: StopKey): QuestState {
  if (s.found.includes(key)) return { mode: s.mode, found: s.found.slice() };
  return { mode: s.mode, found: [...s.found, key] };
}

/** True once every stop has been found. */
export function complete(s: QuestState): boolean {
  for (const stop of STOPS) {
    if (!s.found.includes(stop.key)) return false;
  }
  return true;
}

/** The offer shows only after the lesson, and only while the visitor has not answered. */
export function offerDue(s: QuestState, lessonDone: boolean): boolean {
  return lessonDone && s.mode === "unasked";
}

/**
 * The nearest place not yet found, the short way round a world of `n` on both axes.
 * Equal distances take the earlier stop. Null when the quest is not on, or nothing is left.
 */
export function nextStop(
  s: QuestState,
  from: { x: number; y: number },
  places: readonly StopPlace[],
  n: number,
): StopPlace | null {
  if (s.mode !== "on") return null;
  let best: StopPlace | null = null;
  let bestD = 0;
  let bestOrder = 0;
  for (const place of places) {
    if (s.found.includes(place.key)) continue;
    const dx = torusDelta(from.x, place.x, n);
    const dy = torusDelta(from.y, place.y, n);
    const d2 = dx * dx + dy * dy;
    const order = orderOf(place.key);
    if (best === null || d2 < bestD || (d2 === bestD && order < bestOrder)) {
      best = place;
      bestD = d2;
      bestOrder = order;
    }
  }
  return best;
}
