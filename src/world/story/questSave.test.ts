import assert from "node:assert/strict";
import { test } from "node:test";
import { parseQuest, QUEST_KEY, type QuestState } from "./quest.ts";
import { createQuestSave, type QuestMemory } from "./questSave.ts";

function memory(): QuestMemory & { raw: string | null } {
  let raw: string | null = null;
  return {
    get raw() {
      return raw;
    },
    getItem(key) {
      assert.equal(key, QUEST_KEY);
      return raw;
    },
    setItem(key, value) {
      assert.equal(key, QUEST_KEY);
      raw = value;
    },
  };
}

test("set stores text that parses back to the quest", () => {
  const store = memory();
  const save = createQuestSave(store);
  const next: QuestState = { mode: "on", found: ["desk", "pine"] };
  save.set(next);
  assert.deepEqual(parseQuest(store.raw), next);
  assert.deepEqual(save.get(), next);
});

test("a store that throws still keeps what was set", () => {
  const store: QuestMemory = {
    getItem() {
      throw new Error("get");
    },
    setItem() {
      throw new Error("set");
    },
  };
  const save = createQuestSave(store);
  const next: QuestState = { mode: "off", found: ["bell"] };
  save.set(next);
  assert.deepEqual(save.get(), next);
});
