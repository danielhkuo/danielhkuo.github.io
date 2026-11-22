import assert from "node:assert/strict";
import { test } from "node:test";
import { hash2, hashString, mix32 } from "./hash.ts";

test("mix32 is lowbias32", () => {
  assert.equal(mix32(0), 0);
  assert.equal(mix32(1), 1753845952);
  assert.equal(mix32(0xffffffff), 1734902346);
});

test("hashString is FNV-1a over UTF-16 code units", () => {
  assert.equal(hashString(""), 2166136261);
  assert.equal(hashString("plan"), 3083585298);
  assert.equal(hashString("é"), 1812687940);
});

test("hash2 goldens, negative coordinates included", () => {
  assert.equal(hash2(1, 2, 3), 985587320);
  assert.equal(hash2(-1, 0, 0), 2536689590);
  assert.equal(hash2(6399, 6399, 42), 12173068);
});

test("every hash is a u32", () => {
  for (let i = -50; i < 50; i++) {
    for (const v of [mix32(i >>> 0), hash2(i, -i, i * 7), hashString(String(i))]) {
      assert.ok(Number.isInteger(v) && v >= 0 && v < 4294967296);
    }
  }
});
