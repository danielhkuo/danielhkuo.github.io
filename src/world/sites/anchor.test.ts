import assert from "node:assert/strict";
import { test } from "node:test";
import { anchorOf, restRadius, type StructureLike } from "./anchor.ts";

const N = 10240;

/** A w × h structure with its north-west corner at (x, y), every cell `height` tall over `base`. */
function block(x: number, y: number, w: number, h: number, height: number, base = 10, onGround = false): StructureLike {
  return { x, y, w, h, base, onGround, top: new Float32Array(w * h).fill(height) };
}

test("the anchor is the tallest building standing near the site", () => {
  const tower = block(997, 997, 7, 7, 34);
  const cottage = block(1008, 999, 6, 5, 8.4);
  const a = anchorOf({ x: 1000, y: 1000, type: "lighthouse" }, [cottage, tower], N)!;
  assert.deepEqual(a, { x: 1000.5, y: 1000.5, halfW: 3.5, halfD: 3.5, height: 34 });
});

test("a building's height is its tallest cell over its own base, wherever it stands", () => {
  const low = block(990, 990, 20, 20, 10, 60);
  const tall = { ...block(1002, 1002, 5, 5, 0, 0), top: Float32Array.from({ length: 25 }, (_, i) => (i === 12 ? 30 : 4)) };
  assert.equal(anchorOf({ x: 1000, y: 1000, type: "abbey" }, [low, tall], N)!.height, 30);
});

test("planted things are never the anchor", () => {
  const grove = block(980, 980, 52, 16, 40, 0, true);
  const abbey = block(985, 988, 30, 24, 30.7);
  assert.equal(anchorOf({ x: 1000, y: 1000, type: "abbey" }, [grove, abbey], N)!.halfW, 15);
});

test("only buildings near the site count; the town looks further, for its bell tower", () => {
  const belfry = block(984, 1023, 7, 7, 34);
  assert.equal(anchorOf({ x: 1000, y: 1000, type: "windmill" }, [belfry], N), null);
  assert.deepEqual(anchorOf({ x: 1000, y: 1000, type: "town" }, [belfry], N), { x: 987.5, y: 1026.5, halfW: 3.5, halfD: 3.5, height: 34 });
});

test("the search reaches across the world's edge", () => {
  const tower = block(N - 4, N - 4, 7, 7, 34);
  const a = anchorOf({ x: 1, y: 1, type: "lighthouse" }, [tower], N)!;
  assert.deepEqual([a.x, a.y], [N - 0.5, N - 0.5]);
});

test("of two as tall, the nearer is the anchor", () => {
  const near = block(1001, 1001, 4, 4, 20);
  const far = block(1010, 1010, 4, 4, 20);
  assert.equal(anchorOf({ x: 1000, y: 1000, type: "yew" }, [far, near], N)!.x, 1003);
});

test("the coil rests just clear of the walls, never tighter than 9 or wider than 26", () => {
  assert.equal(restRadius({ x: 0, y: 0, halfW: 3.5, halfD: 3.5, height: 34 }, "lighthouse"), 9);
  assert.ok(Math.abs(restRadius({ x: 0, y: 0, halfW: 4.5, halfD: 4.5, height: 20 }, "windmill") - (Math.hypot(4.5, 4.5) + 4)) < 1e-9);
  assert.equal(restRadius({ x: 0, y: 0, halfW: 40, halfD: 30, height: 9 }, "bridge"), 26);
});

test("without a building, the radius goes by the kind of landmark", () => {
  assert.equal(restRadius(null, "lighthouse"), 9);
  assert.ok(restRadius(null, "abbey") > restRadius(null, "windmill"));
  for (const t of ["abbey", "town", "lighthouse", "windmill", "bridge", "cathedral", "yew", "hospice", "stave", "hermitage", "monastery", "roundchurch", "chapel"] as const) {
    const r = restRadius(null, t);
    assert.ok(r >= 9 && r <= 26, `${t}: ${r}`);
  }
});
