import assert from "node:assert/strict";
import { test } from "node:test";
import { INTERESTS } from "../../components/terminal/content.ts";
import { choose, complete, find, nextStop, offerDue, parseQuest, QUEST_KEY, questText, type QuestState, type StopPlace } from "./quest.ts";
import { STOPS } from "./stops.ts";

const UNASKED: QuestState = { mode: "unasked", found: [] };

test("the quest is stored under world:quest", () => {
  assert.equal(QUEST_KEY, "world:quest");
});

test("parseQuest reads nothing, junk or an unknown mode as not yet asked", () => {
  assert.deepEqual(parseQuest(null), UNASKED);
  assert.deepEqual(parseQuest("x"), UNASKED);
  assert.deepEqual(parseQuest("[]"), UNASKED);
  assert.deepEqual(parseQuest('{"mode":"maybe"}'), UNASKED);
});

test("parseQuest keeps only known stop keys, once each, in the order stored", () => {
  assert.deepEqual(parseQuest('{"mode":"on","found":["desk",1,"nope","desk","pine"]}'), { mode: "on", found: ["desk", "pine"] });
  assert.deepEqual(parseQuest('{"mode":"off","found":"pine"}'), { mode: "off", found: [] });
});

test("questText and parseQuest round-trip", () => {
  const s: QuestState = { mode: "on", found: ["bell", "pine"] };
  assert.deepEqual(parseQuest(questText(s)), s);
});

test("find adds a stop once, whatever the mode", () => {
  const once = find(UNASKED, "bell");
  assert.deepEqual(find(once, "bell").found, ["bell"]);
  assert.deepEqual(find({ mode: "off", found: [] }, "mill").found, ["mill"]);
  // Pure: the state passed in is not changed.
  assert.deepEqual(UNASKED.found, []);
});

test("choose sets the mode and keeps what was found", () => {
  const s = choose({ mode: "unasked", found: ["desk"] }, "on");
  assert.deepEqual(s, { mode: "on", found: ["desk"] });
  assert.equal(choose(s, "off").mode, "off");
});

test("offerDue only once the lesson is done and the visitor has not answered", () => {
  assert.equal(offerDue(UNASKED, false), false);
  assert.equal(offerDue(UNASKED, true), true);
  assert.equal(offerDue({ mode: "off", found: [] }, true), false);
  assert.equal(offerDue({ mode: "on", found: [] }, true), false);
});

const N = 1000;
const PLACES: StopPlace[] = [
  { key: "pine", x: 20, y: 500 },
  { key: "desk", x: 900, y: 500 },
  { key: "bell", x: 500, y: 100 },
];

test("nextStop is the nearest unfound place, the short way round the world", () => {
  const on: QuestState = { mode: "on", found: [] };
  assert.equal(nextStop(on, { x: 990, y: 500 }, PLACES, N)?.key, "pine");
  assert.equal(nextStop(find(on, "pine"), { x: 990, y: 500 }, PLACES, N)?.key, "desk");
  // Across the top and bottom edge as well: 500→100 is 400 cells, but y 950 → 100 wraps to 150.
  assert.equal(nextStop(on, { x: 500, y: 950 }, PLACES, N)?.key, "bell");
});

test("nextStop breaks a tie by the stops' order", () => {
  const twins: StopPlace[] = [
    { key: "mill", x: 600, y: 500 },
    { key: "desk", x: 400, y: 500 },
  ];
  assert.equal(nextStop({ mode: "on", found: [] }, { x: 500, y: 500 }, twins, N)?.key, "desk");
});

test("nextStop is null off the quest, and once every place is found", () => {
  assert.equal(nextStop({ mode: "off", found: [] }, { x: 0, y: 0 }, PLACES, N), null);
  assert.equal(nextStop(UNASKED, { x: 0, y: 0 }, PLACES, N), null);
  assert.equal(nextStop({ mode: "on", found: ["pine", "desk", "bell"] }, { x: 0, y: 0 }, PLACES, N), null);
  assert.equal(nextStop({ mode: "on", found: [] }, { x: 0, y: 0 }, [], N), null);
});

test("five found survive leaving and rejoining, and leave nothing to point to", () => {
  let s: QuestState = { mode: "on", found: [] };
  for (const stop of STOPS) s = find(s, stop.key);
  assert.equal(complete(s), true);
  s = choose(choose(s, "off"), "on");
  assert.equal(s.found.length, 5);
  const all: StopPlace[] = STOPS.map((stop, i) => ({ key: stop.key, x: i * 100, y: i * 100 }));
  assert.equal(nextStop(s, { x: 0, y: 0 }, all, N), null);
  assert.equal(complete({ mode: "on", found: ["pine"] }), false);
});

test("the five stops, each with a line about Daniel", () => {
  assert.deepEqual(STOPS.map((s) => s.key), ["pine", "desk", "bell", "mill", "basket"]);
  assert.deepEqual(STOPS.map((s) => s.name), ["the small pine", "the desk", "the bell", "the mill-shed", "the basket"]);
  const keys = new Set(INTERESTS.map((i) => i.key));
  for (const s of STOPS) assert.ok(keys.has(s.interest), `${s.key}: no interest ${s.interest}`);
  assert.equal(new Set(INTERESTS.map((i) => i.key)).size, INTERESTS.length);
});

test("the interests' lines are the spec's", () => {
  assert.deepEqual(
    INTERESTS.map((i) => [i.key, i.line]),
    [
      ["bonsai", "Daniel likes slow, careful work."],
      ["reading", "Daniel reads a lot."],
      ["faith", "Daniel thinks about faith, technology and what AI is."],
      ["homelab", "Daniel runs a home lab on Unraid."],
      ["basketball", "Daniel plays basketball and follows the Houston Rockets."],
    ],
  );
});
