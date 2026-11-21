"use client";

// The quest as a tiny store: read from localStorage once, changed by the offer and the options, read by the frame
// loop each frame and by React through useSyncExternalStore.

import { useSyncExternalStore } from "react";
import { createQuestSave, type QuestSave } from "../../world/story/questSave";
import type { QuestState } from "../../world/story/quest";

const SERVER: QuestState = { mode: "unasked", found: [] };

function storage() {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

let save: QuestSave | null = null;
// True while the offer is on screen: it takes Q and Esc, and the flight keeps every other key.
let cardUp = false;

function questSave(): QuestSave {
  if (!save) save = createQuestSave(storage());
  return save;
}

/** The quest in force. */
export function getQuest(): QuestState {
  return questSave().get();
}

/** Puts `next` in force and stores it. */
export function setQuest(next: QuestState): void {
  questSave().set(next);
}

function subscribe(listener: () => void): () => void {
  return questSave().subscribe(listener);
}

function serverQuest(): QuestState {
  return SERVER;
}

/** The quest, kept current in React. */
export function useQuest(): QuestState {
  return useSyncExternalStore(subscribe, getQuest, serverQuest);
}

/** True while the quest card shows and takes Q and Esc. */
export function questCardUp(): boolean {
  return cardUp;
}

/** The card sets this while it is on screen. */
export function setQuestCardUp(up: boolean): void {
  cardUp = up;
}
