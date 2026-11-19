import assert from "node:assert/strict";
import { test } from "node:test";
import { loadPinnedRepos } from "./github.ts";

test("without a token, the build gets the sample repos, marked as samples", async (t) => {
  t.mock.method(console, "warn", () => {});
  const { repos, source } = await loadPinnedRepos("");
  assert.equal(source, "sample");
  assert.ok(repos.length > 0);
});
