import assert from "node:assert/strict";
import { test } from "node:test";
import { featureFor } from "./assign.ts";

test("features suit their sites", () => {
  assert.equal(featureFor("lighthouse"), "jetty");
  assert.equal(featureFor("town"), "jetty");
  assert.equal(featureFor("bridge"), "jetty");
  assert.equal(featureFor("windmill"), "sheepfold");
  assert.equal(featureFor("yew"), "sheepfold");
  assert.equal(featureFor("cathedral"), "wayside-cross");
});
