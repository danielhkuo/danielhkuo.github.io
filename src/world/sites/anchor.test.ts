import assert from "node:assert/strict";
import { test } from "node:test";
import { anchorOf, harbourOf, restingPlaces, restRadius, type StructureLike } from "./anchor.ts";

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

test("the coil rests just clear of the walls, never tighter than 8 or wider than 26", () => {
  assert.equal(restRadius({ x: 0, y: 0, halfW: 3.5, halfD: 3.5, height: 34 }, "lighthouse"), 8);
  assert.ok(Math.abs(restRadius({ x: 0, y: 0, halfW: 4.5, halfD: 4.5, height: 20 }, "windmill") - (Math.hypot(4.5, 4.5) + 3)) < 1e-9);
  assert.equal(restRadius({ x: 0, y: 0, halfW: 40, halfD: 30, height: 9 }, "bridge"), 26);
});

test("without a building, the radius goes by the kind of landmark", () => {
  assert.equal(restRadius(null, "lighthouse"), 8);
  assert.ok(restRadius(null, "abbey") > restRadius(null, "windmill"));
  for (const t of ["abbey", "town", "lighthouse", "windmill", "bridge", "cathedral", "yew"] as const) {
    const r = restRadius(null, t);
    assert.ok(r >= 8 && r <= 26, `${t}: ${r}`);
  }
});

test("a town's anchor is its harbour: the widest dredged basin near it, where the coil lies on open water", () => {
  const conforms = [
    { kind: "raise", x: 1000, y: 1050, rx: 50, ry: 18 },
    { kind: "dredge", x: 1000, y: 1068, rx: 32, ry: 12 },
    { kind: "dredge", x: 987, y: 1071, rx: 20, ry: 10 },
    { kind: "dredge", x: 1023, y: 1084, rx: 7, ry: 7 },
    { kind: "dredge", x: 3000, y: 3000, rx: 60, ry: 40 },
  ];
  const h = harbourOf({ x: 1000, y: 1000 }, conforms, N)!;
  assert.deepEqual(h, { x: 1000, y: 1068, halfW: 32, halfD: 12, height: 0, inside: true });
  // The coil lies inside it, clear of its quays: never wider than the basin is deep.
  assert.equal(restRadius(h, "town"), 9);
  assert.equal(harbourOf({ x: 5000, y: 5000 }, conforms, N), null);
});

test("resting places: each landmark's target is its building, and the town's is its harbour", () => {
  const structures = [block(997, 997, 7, 7, 34), block(1997, 1997, 7, 7, 34)];
  const conforms = [{ kind: "dredge", x: 2000, y: 2068, rx: 32, ry: 12 }];
  const places = restingPlaces(
    [
      { id: "lighthouse-0", type: "lighthouse", x: 1000, y: 1000 },
      { id: "town-0", type: "town", x: 2000, y: 2000 },
      { id: "yew-0", type: "yew", x: 4000, y: 4000 },
    ],
    { structures, conforms },
    N,
  );
  assert.deepEqual(places.targets, [
    { id: "lighthouse-0", x: 1000.5, y: 1000.5, radius: 8 },
    { id: "town-0", x: 2000, y: 2068, radius: 9 },
    { id: "yew-0", x: 4000, y: 4000, radius: 21 },
  ]);
  assert.equal(places.anchors.get("town-0")?.inside, true);
  assert.equal(places.anchors.get("yew-0"), null);
  // A town with no harbour falls back to its tallest building: the bell tower.
  const dry = restingPlaces([{ id: "town-0", type: "town", x: 2000, y: 2000 }], { structures, conforms: [] }, N);
  assert.deepEqual(dry.targets, [{ id: "town-0", x: 2000.5, y: 2000.5, radius: 8 }]);
  // Without the built world at all, the sites' own points.
  assert.deepEqual(restingPlaces([{ id: "town-0", type: "town", x: 2000, y: 2000 }], undefined, N).targets, [{ id: "town-0", x: 2000, y: 2000, radius: 8 }]);
});
