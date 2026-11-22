import assert from "node:assert/strict";
import { test } from "node:test";
import { cardOf, lifeAfter, running, startLife, type Life, type LifeEvent } from "./lifecycle.ts";

const after = (life: Life, ...es: LifeEvent[]) => es.reduce(lifeAfter, life);

test("a touch flight waits behind the gate until Take wing", () => {
  const gated = startLife(true);
  assert.equal(running(gated), false);
  assert.equal(cardOf(gated), "gate");
  // Nothing else stacks under the gate, so Take wing alone starts the flight.
  const tried = after(gated, "hidden", "blur", "stall", "back", "fullscreenLost");
  assert.equal(cardOf(tried), "gate");
  assert.equal(running(after(tried, "takeWing")), true);
  assert.equal(running(startLife(false)), true);
});

test("every interruption pauses, and only Fly on resumes", () => {
  for (const e of ["hidden", "blur", "stall", "back", "fullscreenLost"] as LifeEvent[]) {
    const paused = after(startLife(false), e);
    assert.equal(running(paused), false, e);
    assert.equal(cardOf(paused), "paused", e);
    for (const other of ["level", "optionsClose", "takeWing"] as LifeEvent[]) assert.equal(running(lifeAfter(paused, other)), false, `${e} then ${other}`);
    assert.equal(running(lifeAfter(paused, "flyOn")), true, e);
  }
});

test("upright shows the turn card; turning level asks for Fly on before the dragon moves", () => {
  const upright = after(startLife(false), "upright");
  assert.equal(cardOf(upright), "upright");
  assert.equal(running(lifeAfter(upright, "flyOn")), false);
  const level = lifeAfter(upright, "level");
  assert.equal(cardOf(level), "paused");
  assert.equal(running(lifeAfter(level, "flyOn")), true);
  // Level without having been upright changes nothing.
  assert.equal(running(after(startLife(false), "level")), true);
});

test("the options panel holds the flight while open and lets it go when closed", () => {
  const open = after(startLife(false), "optionsOpen");
  assert.equal(running(open), false);
  assert.equal(cardOf(open), null);
  assert.equal(running(lifeAfter(open, "optionsClose")), true);
  // Closing the panel does not lift a pause that came while it was open.
  assert.equal(running(after(open, "hidden", "optionsClose")), false);
});

test("the quest offer holds a phone's flight while it is up, with no card of its own, and lets go when answered", () => {
  const up = after(startLife(false), "offerOpen");
  assert.equal(running(up), false);
  assert.equal(cardOf(up), null);
  assert.equal(running(lifeAfter(up, "offerClose")), true);
  // Fly on is not an answer: only the offer's own buttons (or its going away) let go.
  assert.equal(running(lifeAfter(up, "flyOn")), false);
  // Answering does not lift a pause that came while it was up, and the panel's hold is separate from the offer's.
  assert.equal(running(after(up, "hidden", "offerClose")), false);
  assert.equal(running(after(up, "optionsOpen", "optionsClose")), false);
  assert.equal(running(after(up, "optionsOpen", "offerClose")), false);
  assert.equal(running(after(up, "optionsOpen", "offerClose", "optionsClose")), true);
});

test("the gate outranks the turn card, which outranks Paused", () => {
  assert.equal(cardOf(after(startLife(true), "upright")), "gate");
  assert.equal(cardOf(after(startLife(true), "upright", "takeWing")), "upright");
  assert.equal(cardOf(after(startLife(false), "hidden", "upright")), "upright");
});
