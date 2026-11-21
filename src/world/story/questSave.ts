// The quest as it is remembered: read once from a store, then kept for the visit even when the store refuses.
// The page's questStore holds the one the flight and React share.

import { parseQuest, QUEST_KEY, questText, type QuestState } from "./quest.ts";

/** The part of Storage the quest uses. */
export interface QuestMemory {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export interface QuestSave {
  get(): QuestState;
  set(next: QuestState): void;
  subscribe(listener: () => void): () => void;
}

/** A quest remembered in `store`, or only for this visit when `store` is missing or throws. */
export function createQuestSave(store: QuestMemory | null): QuestSave {
  let current: QuestState | null = null;
  const listeners = new Set<() => void>();

  const read = (): string | null => {
    if (!store) return null;
    try {
      return store.getItem(QUEST_KEY);
    } catch {
      return null;
    }
  };

  return {
    /** The quest in force. The store is read once; after that the memory here wins. */
    get() {
      if (!current) current = parseQuest(read());
      return current;
    },
    set(next) {
      current = next;
      try {
        store?.setItem(QUEST_KEY, questText(next));
      } catch {
        // storage refused: the choice still holds this visit
      }
      for (const listener of listeners) listener();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
