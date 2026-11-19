import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { rngFor } from "./core/rng.ts";
import { BOUNDARY_HALF, cover, fieldAt, hueField, hueVariant, HUE_CLASS, MARGIN, RULE, ruleJitter, WORLD_N } from "./cover.ts";
import type { CoverInput } from "./look/contract.ts";
import { isCrop, isWater, MATERIAL as M, MATERIAL_COUNT, MATERIAL_NAMES } from "./look/materials.ts";

const MASK = new Uint8Array(readFileSync(fileURLToPath(new URL("../../public/world/bluenoise.bin", import.meta.url))));

const HOME = [1, 0, 0, 0, 0, 0];
const HIGHLAND = [0, 1, 0, 0, 0, 0];
const SLATE = [0, 0, 1, 0, 0, 0];
const LAKES = [0, 0, 0, 1, 0, 0];
const KARST = [0, 0, 0, 0, 1, 0];
const SKERRY = [0, 0, 0, 0, 0, 1];

/** Plain low pasture on a skerry: matches no rule but the last. Every value sits well clear of every threshold. */
function cell(over: Partial<CoverInput> = {}): CoverInput {
  return {
    x: 1000, y: 2000, e: 12, slope: 0.3, northness: 0, hand: 12, moisture: 0.36, wind: 0.2, exposure: 0.7,
    debris: 0, rock: 1, region: SKERRY, water: 0, shore: 0, ...over,
  };
}

/** The covers over a 16 × 16 patch of one input; a test value clear of every threshold gives one answer whatever the jitter. */
function patch(over: Partial<CoverInput>): Set<number> {
  const seen = new Set<number>();
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) seen.add(cover(cell({ ...over, x: 3000 + x * 17, y: 500 + y * 13 }), MASK));
  }
  return seen;
}

function names(s: Set<number>): string[] {
  return [...s].map((id) => MATERIAL_NAMES[id]);
}

function only(over: Partial<CoverInput>, mat: number): void {
  assert.deepEqual(names(patch(over)), [MATERIAL_NAMES[mat]]);
}

/** Every cell of the patch is one of the three variants of a family. */
function family(over: Partial<CoverInput>, base: number): void {
  for (const id of patch(over)) assert.ok(id >= base && id <= base + 2, `${MATERIAL_NAMES[id]} is not ${MATERIAL_NAMES[base]}`);
}

function none(over: Partial<CoverInput>, lo: number, hi: number): void {
  for (const id of patch(over)) assert.ok(id < lo || id > hi, `${MATERIAL_NAMES[id]} from ${JSON.stringify(over)}`);
}

/** Open hill ground: grass moor, its bracken beds and its gorse. */
function openMoor(id: number): boolean {
  return (id >= M.moorCool && id <= M.moorWarm) || id === M.bracken || id === M.gorse;
}

/** The share of a 64 × 64 block of one input, sampled every `step` cells, that `is` holds for. */
function shareOf(over: Partial<CoverInput>, is: (id: number) => boolean, step = 3): number {
  let hit = 0;
  for (let i = 0; i < 4096; i++) if (is(cover(cell({ ...over, x: 900 + step * (i & 63), y: 4100 + step * (i >> 6) }), MASK))) hit++;
  return hit / 4096;
}

test("the mask is the committed 256² blue noise", () => {
  assert.equal(MASK.length, 65536);
});

test("water is sea, lake or river, whatever else the cell says", () => {
  only({ water: 1, e: -5 }, M.sea);
  only({ water: 1, e: -5, region: KARST }, M.seaClear);
  only({ water: 2 }, M.lake);
  only({ water: 3 }, M.river);
  only({ water: 3, e: 120, slope: 2.5, wind: 1, region: HIGHLAND }, M.river);
});

test("sand: only a real beach, sheltered and nearly flat; low flat ground inland is never sand", () => {
  only({ shore: 1, e: 0.6, slope: 0.1, exposure: 0.2 }, M.sand);
  only({ shore: 4, e: 0.6, slope: 0.1, exposure: 0.2, region: KARST }, M.sandPale);
  // The beach class alone is not enough: an exposed or sloping shore keeps its grass or rock.
  none({ shore: 1, e: 0.6, slope: 0.1, exposure: 0.8 }, M.sand, M.sandPale);
  none({ shore: 1, e: 0.6, slope: 0.35, exposure: 0.2 }, M.sand, M.sandPale);
  // A floodplain is low, flat and sheltered, and it is not a beach.
  none({ e: 0.8, exposure: 0.1, slope: 0.03, hand: 0.3 }, M.sand, M.sandPale);
  none({ e: 0.8, exposure: 0.1, slope: 0.03, hand: 3 }, M.sand, M.sandPale);
});

test("rocky shores get a shingle line and a rock bench", () => {
  only({ shore: 2, e: 0.5, slope: 0.2 }, M.shingle);
  only({ shore: 2, e: 1.4, slope: 0.2, rock: 2 }, M.rockSed);
  only({ shore: 2, e: 1.4, slope: 0.2, rock: 0 }, M.rockHard);
  // The bench is narrow: above it the shore is whatever the land is.
  none({ shore: 2, e: 3, slope: 0.2, rock: 0 }, M.rockHard, M.cliffSlate);
});

test("snow: altitude first, above a wandering line; lower in shade, in hollows, couloirs and on benches; shed by crests; never far below the line", () => {
  const snow = (over: Partial<CoverInput>): number => shareOf({ hand: 60, slope: 0.5, ...over }, (id) => id === M.snow);
  only({ e: 125, hand: 60 }, M.snow);
  none({ e: 74, hand: 60 }, M.snow, M.snow);
  none({ e: 58, hand: 60 }, M.snow, M.snowLate);
  // A face turned north holds it lower than one turned south, and the form's aspect is what counts where it is known.
  only({ e: 112, northness: 1, hand: 60 }, M.snow);
  none({ e: 84, northness: -1, hand: 60 }, M.snow, M.snow);
  assert.ok(snow({ e: 93, northness: -1, formNorth: 1 }) > snow({ e: 93, northness: 1, formNorth: -1 }) + 0.3, "aspect is read off the form");
  // Near the line the lie of the ground decides: cirques, couloirs and gentle benches hold snow below it.
  assert.ok(snow({ e: 90, curve: -2 }) > snow({ e: 90 }) + 0.3, "a cirque gathers snow");
  assert.ok(snow({ e: 90, relief: -1 }) > snow({ e: 90 }) + 0.2, "a couloir holds snow");
  assert.ok(snow({ e: 91, slope: 0.15 }) > snow({ e: 91 }) + 0.15, "a bench holds snow");
  // A sharp crest or a scarp's lip sheds: no ribbon of snow along a ridge that only just tops the line, on its shaded side either.
  none({ e: 99, curve: 2.6, slope: 0.6 }, M.snow, M.snow);
  none({ e: 93, curve: 2.6, slope: 0.3, northness: 1 }, M.snow, M.snow);
  assert.ok(snow({ e: 100, curve: 2.6 }) < snow({ e: 100 }) - 0.5, "a crest sheds");
  only({ e: 124, curve: 2.6, slope: 0.3 }, M.snow);
  // The lie counts only near the line: no hollow, couloir or bench far below it is ever white, whatever its shape.
  none({ e: 70, curve: -3, relief: -2, slope: 0.1, northness: 1 }, M.snow, M.snow);
  none({ e: 68, hand: 1, curve: -3, relief: -2, slope: 0.6, northness: 1 }, M.snow, M.snow);
  // Steep ground sheds it, a sunny face sooner than a shaded one, and a rib sooner than the couloir beside it.
  assert.ok(snow({ e: 100, slope: 1.05 }) < snow({ e: 100, slope: 0.5 }) - 0.5, "steep ground sheds");
  assert.ok(snow({ e: 106, slope: 0.85, northness: -1 }) < snow({ e: 106, slope: 0.85, northness: 1 }) - 0.5, "the sunny side sheds sooner");
  assert.ok(snow({ e: 101, slope: 0.85, relief: 1 }) < snow({ e: 101, slope: 0.85, relief: -1 }) - 0.3, "ribs show through");
});

test("at the snowline, ground that sheds its snow is bare rock, bedded, with snow on its ledges", () => {
  const seen = new Set<number>();
  let snow = 0, rock = 0, total = 0;
  for (let y = 0; y < 120; y++) {
    for (let x = 0; x < 120; x++) {
      // A south face at slope 0.95, across the snowline.
      const h = 121 - 0.08 * y;
      const id = cover(cell({ x: 2000 + x, y: 3000 + y, e: h - 7, form: h - 7, slope: 0.95, steep: 0.95, northness: -1, hand: 60, rock: 0 }), MASK);
      seen.add(id);
      total++;
      if (id === M.snow) snow++;
      if (id === M.rockHard || id === M.cliffHard) rock++;
    }
  }
  for (const id of seen) assert.ok(id === M.snow || id === M.snowLate || id === M.rockHard || id === M.cliffHard, MATERIAL_NAMES[id]);
  assert.ok(seen.has(M.rockHard) && seen.has(M.cliffHard), "steps and benches");
  assert.ok(rock / total > 0.5, `rock on ${rock / total} of the face`);
  assert.ok(snow / total > 0.02 && snow / total < 0.45, `snow on ${snow / total} of the face`);
});

test("the snow's edge is feathered over a few cells and wanders: no stair steps, no contour line, no field of static", () => {
  // A slope rising to the north through the snowline, at a mountain's own gradient.
  const size = 220;
  const snow = new Uint8Array(size * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const id = cover(cell({ x: 900 + x, y: 4100 + y, e: 112 - y * 0.12, hand: 60, slope: 0.3 }), MASK);
      snow[y * size + x] = id === M.snow ? 1 : 0;
    }
  }
  let lonely = 0, white = 0;
  const edgeRows = new Set<number>();
  const bands: number[] = [];
  for (let x = 1; x < size - 1; x++) {
    let first = -1, last = -1;
    for (let y = 1; y < size - 1; y++) {
      const i = y * size + x;
      white += snow[i];
      const same = (snow[i - 1] === snow[i] ? 1 : 0) + (snow[i + 1] === snow[i] ? 1 : 0) + (snow[i - size] === snow[i] ? 1 : 0) + (snow[i + size] === snow[i] ? 1 : 0);
      if (same === 0) lonely++;
      if (snow[i] !== snow[i + size]) {
        edgeRows.add(y);
        if (first < 0) first = y;
        last = y;
      }
    }
    bands.push(last - first);
  }
  assert.ok(white > 2000 && white < size * size - 2000, "the patch must straddle the snowline");
  // The feather is a band in every column, a few cells deep on a slope this gentle; isolated cells are few.
  bands.sort((a, b) => a - b);
  const median = bands[bands.length >> 1];
  assert.ok(median >= 1 && median <= 14, `the edge is ${median} cells deep`);
  assert.ok(lonely < 0.004 * size * size, `${lonely} lone cells`);
  // The line wanders: it is not one row.
  assert.ok(edgeRows.size >= 12, `the snowline lies on ${edgeRows.size} rows`);
});

test("bare rock is the exception: true cliffs, high exposed summits, and nothing merely steep", () => {
  only({ slope: 2.2, rock: 0 }, M.cliffHard);
  only({ slope: 2.2, rock: 2 }, M.cliffSed);
  only({ slope: 1.45, rock: 0 }, M.cliffHard);
  only({ slope: 2.2, rock: 0, region: KARST }, M.cliffLime);
  only({ slope: 2.2, rock: 2, region: SLATE }, M.cliffSlate);
  // A cliffed shore shows its face at a gentler slope.
  only({ slope: 1.1, rock: 2, shore: 3, e: 8 }, M.cliffSed);
  // Steep but not a cliff: no rock at all below the crag slope, at any height or rock.
  for (const e of [4, 20, 45, 60]) {
    for (const rock of [0, 1, 2]) none({ slope: 0.7, rock, e, hand: 40 }, M.rockHard, M.cliffSlate);
  }
  // A summit: high, wind-blown and convex together.
  only({ e: 62, slope: 0.6, wind: 1, curve: 5, hand: 60, rock: 0, northness: -1 }, M.rockHard);
  // Any one of the three missing, and it keeps its cover.
  none({ e: 20, slope: 0.6, wind: 1, curve: 5, rock: 0, northness: -1 }, M.rockHard, M.cliffSlate);
  none({ e: 62, slope: 0.6, wind: 0.2, curve: 5, hand: 60, rock: 0, northness: -1 }, M.rockHard, M.cliffSlate);
  none({ e: 62, slope: 0.6, wind: 1, curve: -5, hand: 60, rock: 0, northness: -1 }, M.rockHard, M.cliffSlate);
  // A gully's wall is no cliff: where the form is merely steep, a cell's own slope does not make rock.
  none({ slope: 1.7, steep: 0.72, rock: 0, e: 30, hand: 40 }, M.rockHard, M.cliffSlate);
  // A scarp too small to show in the form still is one.
  only({ slope: 1.7, steep: 0.5, rock: 0, e: 30, hand: 40 }, M.cliffHard);
  // Exposure bares a summit sooner than shelter does: never the other way round.
  let exposed = 0, sheltered = 0;
  for (let e = 40; e <= 96; e += 2) {
    if (patch({ e, slope: 0.6, wind: 0.85, hand: 60, rock: 0, northness: -1 }).has(M.rockHard)) exposed++;
    if (patch({ e, slope: 0.6, wind: 0.3, hand: 60, rock: 0, northness: -1 }).has(M.rockHard)) sheltered++;
  }
  assert.ok(exposed > sheltered, `exposed ${exposed}, sheltered ${sheltered}`);
});

test("merely steep ground is heather, bracken or rough grass, by height, wind and aspect", () => {
  // Low and sheltered: bracken on the sunny side; in the shade rough grass, pasture in the home lowland and moor on the hill.
  only({ slope: 0.7, e: 15, hand: 40, wind: 0.2, northness: -1 }, M.bracken);
  family({ slope: 0.7, e: 15, hand: 40, wind: 0.2, northness: 1, region: HOME }, M.pastureCool);
  for (const id of patch({ slope: 0.7, e: 15, hand: 40, wind: 0.2, northness: 1 })) assert.ok(openMoor(id), MATERIAL_NAMES[id]);
  // High or wind-blown: heath and moor.
  for (const id of patch({ slope: 0.7, e: 60, hand: 40, wind: 0.2, northness: -1 })) assert.ok((id >= M.heathCool && id <= M.heathWarm) || openMoor(id), MATERIAL_NAMES[id]);
});

test("crag bands: thin ribbons of rock along the contour of steep ground, not slabs", () => {
  // A uniform south face at slope 1.1, from 20 units at its foot to 90 at its top: contours run west–east.
  const size = 300, rows = 64;
  const rock = new Uint8Array(size * size);
  let total = 0;
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < size; x++) {
      const id = cover(cell({ x: 2000 + x, y: 3000 + y, e: 20 + (rows - y) * 1.1, slope: 1.1, rock: 0, hand: 40, northness: -1, wind: 0.2 }), MASK);
      if (id >= M.rockHard && id <= M.cliffSlate) {
        rock[y * size + x] = 1;
        total++;
      }
    }
  }
  const share = total / (size * rows);
  assert.ok(share > 0.04 && share < 0.4, `${share.toFixed(2)} of a steep face is rock`);
  // Runs of rock are long along the contour and short across it.
  const runs = (alongX: boolean): number => {
    let count = 0, length = 0;
    for (let a = 0; a < (alongX ? rows : size); a++) {
      let run = 0;
      for (let b = 0; b <= (alongX ? size : rows); b++) {
        const v = b < (alongX ? size : rows) ? (alongX ? rock[a * size + b] : rock[b * size + a]) : 0;
        if (v) run++;
        else if (run > 0) {
          count++;
          length += run;
          run = 0;
        }
      }
    }
    return length / Math.max(1, count);
  };
  const along = runs(true), across = runs(false);
  assert.ok(across < 5, `bands are ${across.toFixed(1)} cells thick`);
  assert.ok(along > 2.5 * across, `bands run ${along.toFixed(1)} cells along the contour, ${across.toFixed(1)} across`);
  // Gentler ground carries thinner bands, and none below the crag slope.
  none({ slope: 0.72, rock: 0, hand: 40, e: 30 }, M.rockHard, M.cliffSlate);
});

test("where two rock classes meet, the line between their stones is bent, not ruled", () => {
  // A cliff across a straight north–south class boundary eight cells wide.
  const edge: number[] = [];
  for (let y = 0; y < 300; y++) {
    let at = -1;
    for (let x = 0; x < 40; x++) {
      const t = x < 16 ? 0 : x > 24 ? 1 : (x - 16) / 8;
      const id = cover(cell({ x: 5000 + x, y: 700 + y, slope: 2.2, rock: t }), MASK);
      assert.ok(id === M.cliffHard || id === M.cliffSed);
      if (at < 0 && id === M.cliffSed) at = x;
    }
    edge.push(at);
  }
  assert.ok(Math.min(...edge) >= 16 && Math.max(...edge) <= 25, "pure classes keep their stone");
  assert.ok(new Set(edge).size >= 4, `the line sits at ${new Set(edge).size} columns`);
});

test("scree: fans under a cliff's own cells only, thickened by rockfall; graded stones, bigger at the toe; never on a face", () => {
  const fanAt = (id: number): boolean => id === M.scree || id === M.screeSlate || id === M.screeStone;
  const high = { e: 84, hand: 20, slope: 0.6, rock: 2 };
  // The foot of a cliff is scree; rockfall with no rock standing over it is not, however thick.
  for (const id of patch({ ...high, cliffAbove: 1 })) assert.ok(id === M.scree || id === M.screeStone, MATERIAL_NAMES[id]);
  for (const id of patch({ ...high, cliffAbove: 1, region: SLATE })) assert.ok(id === M.screeSlate || id === M.screeStone, MATERIAL_NAMES[id]);
  for (const id of patch({ ...high, debris: 0.95 })) assert.ok(!fanAt(id), MATERIAL_NAMES[id]);
  // The fan thins with the cliff's feed: lobes, then scattered stones, then nothing.
  const share = (cliffAbove: number, over: Partial<CoverInput> = {}): number => shareOf({ ...high, cliffAbove, ...over }, fanAt, 1);
  assert.ok(share(0.95) > 0.97, `thick ${share(0.95)}`);
  assert.ok(share(0.42) > 0.15 && share(0.42) < 0.85, `edge ${share(0.42)}`);
  assert.ok(share(0.3) < share(0.42) && share(0.42) < share(0.6));
  assert.equal(share(0.1), 0);
  // Rockfall lying in a fan thickens it.
  assert.ok(share(0.3, { debris: 0.9 }) > share(0.3) + 0.3, "debris thickens a fan");
  // Low down the fan is grown over: the same feed is bare high up and green at the foot of the hills.
  assert.equal(share(0.45, { e: 12 }), 0);
  assert.ok(share(0.45, { e: 84 }) > 0.5);
  // Stones are dots a tone under the wash: fine and few at the head, in clusters at the toe, where the fan has thinned.
  const stones = (cliffAbove: number): number => shareOf({ ...high, cliffAbove, debris: 0.95 }, (id) => id === M.screeStone, 1);
  assert.ok(stones(0.9) > 0.04 && stones(0.9) < 0.2, `stones on ${stones(0.9)} of the head`);
  assert.ok(stones(0.3) > 1.6 * stones(0.9) && stones(0.3) < 0.5, `stones on ${stones(0.3)} of the toe`);
  // At the toe they lie in blocks: more of them have a stone beside them than fine dots would.
  const beside = (cliffAbove: number): number => {
    let pairs = 0, all = 0;
    for (let y = 0; y < 96; y++) for (let x = 0; x < 96; x++) {
      const at = (dx: number): number => cover(cell({ ...high, debris: 0.95, cliffAbove, x: 5000 + x + dx, y: 900 + y }), MASK);
      if (at(0) !== M.screeStone) continue;
      all++;
      if (at(1) === M.screeStone) pairs++;
    }
    return pairs / all;
  };
  assert.ok(beside(0.3) > beside(0.9) + 0.15, `clusters: ${beside(0.3)} at the toe, ${beside(0.9)} at the head`);
  // No debris and no cliff above: no scree, however steep.
  none({ ...high, cliffAbove: 0, debris: 0 }, M.scree, M.screeSlate);
  none({ ...high, cliffAbove: 0, debris: 0 }, M.screeStone, M.screeStone);
  // Flat ground is not a fan, and ground steep enough to be hatched as a face is the face.
  none({ ...high, debris: 0.95, slope: 0.1 }, M.scree, M.screeSlate);
  none({ ...high, debris: 0.95, slope: 1.2 }, M.scree, M.screeSlate);
  none({ ...high, debris: 0.95, slope: 1.2 }, M.screeStone, M.screeStone);
});

test("shore plants: marram on dunes, saltmarsh cut by creeks; sand only on beaches and cove backs", () => {
  only({ shore: 5, e: 2, slope: 0.1, hand: 2 }, M.duneGrass);
  // Saltmarsh turf, its creeks, and sea lavender flecking the turf.
  for (const id of patch({ shore: 6, e: 0.8, slope: 0.02, hand: 0.5 })) assert.ok(id === M.saltmarsh || id === M.saltCreek || id === M.flowerMauve, MATERIAL_NAMES[id]);
  let creek = 0;
  for (let i = 0; i < 4096; i++) if (cover(cell({ shore: 6, e: 0.8, slope: 0.02, hand: 0.5, x: 300 + (i & 63), y: 700 + (i >> 6) }), MASK) === M.saltCreek) creek++;
  assert.ok(creek > 40 && creek < 700, `creeks on ${creek} of 4096 cells`);
  for (const shore of [5, 6]) none({ shore, e: 0.6, slope: 0.05, exposure: 0.2, hand: 1 }, M.sand, M.shingle);
  // Above the shore's own ground the land's cover returns.
  none({ shore: 5, e: 9, slope: 0.1 }, M.duneGrass, M.saltCreek);
  none({ shore: 6, e: 5, slope: 0.02 }, M.duneGrass, M.saltCreek);
});

test("late snow lies under the permanent snow", () => {
  // Climbing any one hillside: its own cover, then a band of late snow a few units deep, then snow.
  for (const region of [SKERRY, HIGHLAND]) {
    for (let k = 0; k < 24; k++) {
      let late = -1, snow = -1;
      const ids: number[] = [];
      for (let e = 56; e <= 128; e++) {
        const id = cover(cell({ e, hand: 50, region, x: 3000 + 41 * k, y: 500 + 29 * k }), MASK);
        ids[e] = id;
        if (id === M.snowLate && late < 0) late = e;
        if (id === M.snow && snow < 0) snow = e;
      }
      assert.ok(late > 0 && snow > late && snow - late >= 2 && snow - late <= 9, `late snow from ${late}, snow from ${snow}`);
      for (let e = 56; e <= 128; e++) {
        if (e < late) assert.ok(ids[e] !== M.snow && ids[e] !== M.snowLate);
        // The feather is a few units deep; past it there is nothing but snow.
        if (e > snow + 4) assert.equal(ids[e], M.snow, "nothing but snow above the snowline");
        if (e > late && e < snow) assert.equal(ids[e], M.snowLate, "late snow is one band");
      }
    }
  }
});

test("alpine meadow: highland or lake country, cold, gentle; in patches, never a band under every crest", () => {
  const alpine = (id: number): boolean => id >= M.alpineCool && id <= M.alpineWarm;
  for (const region of [HIGHLAND, LAKES, [0, 0.4, 0, 0.4, 0, 0.2]]) {
    const share = shareOf({ e: 63, hand: 40, region }, alpine);
    assert.ok(share > 0.25 && share < 0.8, `alpine meadow on ${share}`);
    // Between the meadows the hill keeps its moor.
    for (const id of patch({ e: 63, hand: 40, region })) assert.ok(alpine(id) || openMoor(id) || (id >= M.heathCool && id <= M.heathWarm) || (id >= M.pastureCool && id <= M.pastureWarm), MATERIAL_NAMES[id]);
  }
  none({ e: 63, hand: 40, region: HOME }, M.alpineCool, M.alpineWarm);
  none({ e: 63, hand: 40, slope: 0.75, region: HIGHLAND }, M.alpineCool, M.alpineWarm);
  none({ e: 40, hand: 40, region: HIGHLAND }, M.alpineCool, M.alpineWarm);
});

test("heath: wind-blown ground and the tops of valley country; heather where dry or slaty, moor where wet", () => {
  family({ wind: 0.95, moisture: 0.05, region: SLATE }, M.heathCool);
  for (const id of patch({ wind: 0.8, moisture: 0.95, e: 30 })) assert.ok(openMoor(id), MATERIAL_NAMES[id]);
  // Heather keeps to the tops, in patches: a slaty top high over its valleys is mostly heath, the open slope under it
  // grass moor.
  const heather = (id: number): boolean => id >= M.heathCool && id <= M.heathWarm;
  const top = shareOf({ wind: 0.2, hand: 45, region: SLATE, moisture: 0.3, curve: 1.6 }, heather);
  assert.ok(top > 0.4 && top < 0.95, `heather on ${top.toFixed(2)} of a slaty top`);
  const slope = shareOf({ wind: 0.2, hand: 45, region: SLATE, moisture: 0.3, curve: 0 }, heather);
  assert.ok(slope < 0.25 && slope < top / 2, `heather on ${slope.toFixed(2)} of the slope below`);
  // High HAND alone is not heath outside valley country.
  none({ wind: 0.2, hand: 45 }, M.heathCool, M.moorWarm);
});

test("grass moor has grain: bracken beds, gorse in groups and tussocky grass, none of it spread evenly", () => {
  const moor = { wind: 0.7, moisture: 0.95, e: 30, slope: 0.4, hand: 12 };
  const bracken = shareOf(moor, (id) => id === M.bracken);
  const gorse = shareOf(moor, (id) => id === M.gorse);
  assert.ok(bracken > 0.04 && bracken < 0.4, `bracken on ${bracken}`);
  assert.ok(gorse > 0.004 && gorse < 0.12, `gorse on ${gorse}`);
  // All three grass tones show within one small patch of moor.
  const tones = new Set<number>();
  for (let i = 0; i < 1024; i++) {
    const id = cover(cell({ ...moor, x: 2100 + (i & 31), y: 800 + (i >> 5) }), MASK);
    if (id >= M.moorCool && id <= M.moorWarm) tones.add(id);
  }
  assert.equal(tones.size, 3);
  // High on the hill it is grass alone.
  assert.equal(shareOf({ ...moor, e: 85 }, (id) => id === M.bracken || id === M.gorse), 0);
});

test("upland woods are copses and hangers: clumps that cross the spurs, feathered at the edge, thinned by wind, drought, steepness and cold", () => {
  const wood = { hand: 12, slope: 0.3, moisture: 0.7, wind: 0.2, e: 20 };
  const isWood = (id: number): boolean => id === M.floorBroadleaf || id === M.floorConifer;
  const share = (over: Partial<CoverInput>): number => shareOf({ ...wood, ...over }, isWood, 4);
  const base = share({});
  assert.ok(base > 0.3 && base < 0.85, `woods on ${base} of good ground`);
  // Height above the stream hardly counts: no strip up every gully.
  assert.ok(Math.abs(share({ hand: 4 }) - share({ hand: 22 })) < 0.08);
  // Clumps, not speckle: a wood cell's neighbour is nearly always wood.
  let woodCells = 0, kept = 0;
  for (let y = 0; y < 200; y++) for (let x = 0; x < 200; x++) {
    if (!isWood(cover(cell({ ...wood, x: 400 + x, y: 5000 + y }), MASK))) continue;
    woodCells++;
    if (isWood(cover(cell({ ...wood, x: 401 + x, y: 5000 + y }), MASK))) kept++;
  }
  assert.ok(kept / woodCells > 0.85, `${kept / woodCells} of wood cells have wood to their east`);
  // Never on ground too dry, too wind-blown, too steep or too cold; less of it in the wind, on steep ground, in the sun and by the stream.
  for (const no of [{ moisture: 0.3 }, { wind: 0.98 }, { slope: 1.15 }, { e: 90, hand: 5 }]) assert.equal(share(no), 0, JSON.stringify(no));
  assert.ok(share({ wind: 0.6 }) < base - 0.15, "wind");
  assert.ok(share({ slope: 0.9 }) < share({ slope: 0.6 }) - 0.1, "steepness");
  assert.ok(share({ slope: 0.5, northness: -1 }) < share({ slope: 0.5, northness: 1 }) - 0.05, "aspect");
  assert.ok(share({ e: 66 }) < base - 0.1 && share({ e: 66 }) > 0, "the tree line is a wide feather");
  // Highland and lake country carry their tree line lower.
  assert.equal(share({ e: 66, region: HIGHLAND }), 0);
  // The home lowland keeps its own woods: there the valley sides are wooded whatever the copse mask says.
  none({ ...wood, region: HOME, hand: 45 }, M.floorBroadleaf, M.floorConifer);
});

test("the conifer line is a wide belt of mixed wood, in blocks", () => {
  const wood = { hand: 12, slope: 0.3, moisture: 0.7, wind: 0.2 };
  const share = (e: number): number => {
    let conifer = 0, all = 0;
    for (let i = 0; i < 4096; i++) {
      const id = cover(cell({ ...wood, e, x: 200 + 2 * (i & 63), y: 300 + 2 * (i >> 6) }), MASK);
      if (id === M.floorConifer) conifer++;
      if (id === M.floorConifer || id === M.floorBroadleaf) all++;
    }
    assert.ok(all > 40, `too little wood at ${e} to judge`);
    return conifer / all;
  };
  // The belt is some 30 units of height deep: conifers stand in blocks among the broadleaf, never in a row at one height.
  assert.equal(share(25), 0);
  assert.ok(share(40) > 0.03 && share(40) < 0.3, `${share(40)}`);
  assert.ok(share(50) > 0.25 && share(50) < 0.65, `${share(50)}`);
  assert.ok(share(56) > 0.5 && share(56) < 0.9, `${share(56)}`);
  assert.ok(share(62) > 0.8 && share(62) < 1, `${share(62)}`);
  assert.equal(share(78), 1);
});

/** What a field cell may be: a crop or its texture, grass, a copse floor, or the boundary. */
function enclosed(id: number): boolean {
  return isCrop[id] === 1 || id === M.hedge || id === M.wall || id === M.floorBroadleaf ||
    (id >= M.meadowCool && id <= M.pastureWarm) || (id >= M.scrubCool && id <= M.scrubWarm) || (id >= M.moorCool && id <= M.moorWarm);
}

/** The base crop of a textured cell: a row, stripe or stubble belongs to its field. */
function cropOf(id: number): number {
  if (id === M.wheatRow || id === M.stubble || id === M.stubbleRow) return M.wheat;
  if (id === M.barleyRow) return M.barley;
  if (id === M.leyStripe) return M.ley;
  if (id === M.hayRow) return M.hay;
  if (id === M.ploughRow) return M.plough;
  if (id === M.vineRow) return M.vine;
  return id;
}

/** Shares of a patch of gently sloping lowland by kind of cover. */
function lowlandShares(over: Partial<CoverInput>, size = 400): { arable: number; grass: number; wood: number; boundary: number; kinds: Set<number> } {
  let arable = 0, grass = 0, wood = 0, boundary = 0;
  const kinds = new Set<number>();
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const id = cover(cell({ x: 800 + x, y: 900 + y, slope: 0.05, hand: 6, westness: 0, northness: 1, ...over }), MASK);
      assert.ok(enclosed(id), `a gap in the farmland: ${MATERIAL_NAMES[id]} at ${x}, ${y}`);
      if (id === M.hedge || id === M.wall) boundary++;
      else if (id === M.floorBroadleaf) wood++;
      else if (isCrop[id] === 1) {
        arable++;
        kinds.add(cropOf(id));
      } else grass++;
    }
  }
  const total = size * size;
  return { arable: arable / total, grass: grass / total, wood: wood / total, boundary: boundary / total, kinds };
}

test("lowland farmland has no gaps: every cell is a crop, grass, a copse or a hedge", () => {
  const home = lowlandShares({ region: HOME });
  assert.ok(home.kinds.size >= 5, `only ${home.kinds.size} crops`);
  assert.ok(home.arable > 0.45 && home.arable < 0.75, `arable ${home.arable}`);
  assert.ok(home.grass > 0.2 && home.grass < 0.45, `grass ${home.grass}`);
  assert.ok(home.wood < 0.08, `copses ${home.wood}`);
  assert.ok(home.boundary > 0.015 && home.boundary < 0.09, `hedges ${home.boundary}`);
  // Lowland boundaries are hedges, never walls.
  for (let i = 0; i < 4000; i++) {
    assert.notEqual(cover(cell({ x: i * 3, y: 700 + (i % 50), slope: 0.05, hand: 6, region: HOME }), MASK), M.wall);
  }
});

test("farmland keeps to gentle low ground of the home lowland and the karst valley floors", () => {
  for (const no of [{ slope: 0.3 }, { hand: 40 }, { region: SKERRY }, { wind: 0.9 }, { e: 0.6 }]) {
    for (const id of patch({ slope: 0.05, hand: 6, moisture: 0.36, region: HOME, ...no })) {
      assert.ok(isCrop[id] === 0 && id !== M.hedge && id !== M.wall, `${MATERIAL_NAMES[id]} with ${JSON.stringify(no)}`);
    }
  }
  const floor = lowlandShares({ region: KARST, hand: 3 }, 300);
  assert.ok(floor.kinds.has(M.vine), "the karst grows vines");
  for (const id of patch({ slope: 0.05, hand: 15, region: KARST })) assert.ok(isCrop[id] === 0 && id !== M.hedge);
});

test("upland in-bye land is walled grass: valley and lake country, and the highland's margins", () => {
  for (const region of [SLATE, LAKES, HIGHLAND]) {
    let wall = 0, grass = 0, other = 0;
    for (let y = 0; y < 300; y++) {
      for (let x = 0; x < 300; x++) {
        const id = cover(cell({ x: 2000 + x, y: 3000 + y, slope: 0.1, hand: 5, e: 15, region }), MASK);
        assert.ok(enclosed(id), MATERIAL_NAMES[id]);
        assert.notEqual(id, M.hedge);
        if (id === M.wall) wall++;
        else if ((id >= M.meadowCool && id <= M.pastureWarm) || id === M.hay || id === M.hayRow) grass++;
        else other++;
      }
    }
    assert.ok(wall / 90000 > 0.008 && wall / 90000 < 0.08, `walls ${wall / 90000}`);
    assert.ok(grass / 90000 > 0.75, `grass ${grass / 90000}`);
    assert.ok(other / 90000 < 0.2);
  }
  // Not on the tops, not on steep ground, not in the cold.
  for (const no of [{ hand: 30 }, { slope: 0.4 }, { e: 60 }, { wind: 0.7 }]) {
    assert.ok(!patch({ slope: 0.1, hand: 5, e: 15, region: SLATE, ...no }).has(M.wall), JSON.stringify(no));
  }
});

test("a field is one use: its crop, with its own rows, inside a margin and a boundary", () => {
  const byField = new Map<number, number>();
  for (let y = 0; y < 300; y++) {
    for (let x = 0; x < 300; x++) {
      const c = cell({ x: 4000 + x, y: 100 + y, slope: 0.05, hand: 6, region: HOME, westness: 0, northness: 1 });
      const id = cover(c, MASK);
      const f = fieldAt(c);
      if (f.edge < BOUNDARY_HALF) {
        assert.equal(id, M.hedge);
        continue;
      }
      assert.notEqual(id, M.hedge);
      if (f.edge < MARGIN) continue;
      // Wheat and barley both leave stubble, so they count as one use here.
      const crop = cropOf(id) === M.barley ? M.wheat : cropOf(id);
      const use = id >= M.pastureCool && id <= M.pastureWarm ? M.pastureCool : id >= M.meadowCool && id <= M.meadowWarm ? M.meadowCool : crop;
      if (byField.has(f.id)) assert.equal(MATERIAL_NAMES[byField.get(f.id) as number], MATERIAL_NAMES[use]);
      else byField.set(f.id, use);
    }
  }
  assert.ok(byField.size > 12);
});

test("crop texture: single-pixel lines along the field's axis, broken by the mask, a tone from the field", () => {
  // South-rising ground: furrows run west–east, counted in screen rows.
  const lines = new Map<number, { line: number; all: number; rows: Set<number> }>();
  const pair: [number, number][] = [[M.wheat as number, M.wheatRow as number], [M.barley, M.barleyRow], [M.hay, M.hayRow], [M.plough, M.ploughRow], [M.stubble, M.stubbleRow]];
  const lineOf = new Map(pair.map(([base, row]) => [row, base]));
  for (let y = 0; y < 500; y++) {
    for (let x = 0; x < 500; x++) {
      const c = cell({ x: 1200 + x, y: 5200 + y, slope: 0.08, hand: 6, region: HOME, westness: 0, northness: 1 });
      const id = cover(c, MASK);
      const base = lineOf.get(id) ?? id;
      if (!pair.some(([b]) => b === base)) continue;
      let t = lines.get(base);
      if (!t) {
        t = { line: 0, all: 0, rows: new Set() };
        lines.set(base, t);
      }
      t.all++;
      const row = Math.floor((4 * (5200 + y)) / 5);
      if (id !== base) {
        t.line++;
        t.rows.add(row);
      }
    }
  }
  const period = new Map<number, number>([[M.wheat, 8], [M.barley, 5], [M.hay, 5], [M.plough, 2], [M.stubble, 4]]);
  for (const [base, t] of lines) {
    const p = period.get(base) as number;
    // Lines sit only on every p-th screen row, and not on all of each: broken, not ruled.
    for (const row of t.rows) assert.equal(row % p, 0, `${MATERIAL_NAMES[base]}: a line off its row`);
    const share = t.line / t.all;
    // A line row that is one of the doubled screen rows holds two world rows, so up to a third more cells.
    assert.ok(share > 0.4 / p && share < 1.35 / p, `${MATERIAL_NAMES[base]}: ${share.toFixed(3)} of the field is line`);
  }
  assert.ok(lines.size >= 4, `${lines.size} textured crops in the patch`);
});

test("arable fields keep a grass margin inside the hedge", () => {
  let margin = 0, inner = 0, marginGrass = 0, innerGrass = 0;
  for (let y = 0; y < 400; y++) {
    for (let x = 0; x < 400; x++) {
      const c = cell({ x: 5000 + x, y: 2500 + y, slope: 0.05, hand: 6, region: HOME, westness: 0, northness: 1 });
      const id = cover(c, MASK);
      const f = fieldAt(c);
      if (f.edge < BOUNDARY_HALF) continue;
      if (f.edge < MARGIN) {
        margin++;
        if (id === M.pastureMid) marginGrass++;
      } else if (f.edge > 4) {
        inner++;
        if (id === M.pastureMid) innerGrass++;
      }
    }
  }
  assert.ok(marginGrass / margin > 2.5 * (innerGrass / inner), `margin ${marginGrass / margin}, inside ${innerGrass / inner}`);
  assert.ok(marginGrass / margin > 0.3);
});

test("a river through farmland is never ploughed across: its banks are a meadow verge", () => {
  for (let y = 0; y < 400; y++) {
    for (const d of [-2, -1, 1, 2]) {
      const id = cover(cell({ x: 3000 + d, y: 1000 + y, slope: 0.05, hand: 3, region: HOME, riverDx: d, riverDy: 0 }), MASK);
      assert.ok(id === M.hedge || (id >= M.meadowCool && id <= M.meadowWarm), MATERIAL_NAMES[id]);
    }
    assert.equal(cover(cell({ x: 3000, y: 1000 + y, slope: 0.05, hand: 0, region: HOME, water: 3 }), MASK), M.river);
  }
});

test("floodplains: reeds at the water, marsh in the hollows, wet meadow between; never sand or plough", () => {
  only({ hand: 0.05, slope: 0.005 }, M.reeds);
  only({ hand: 0.5, slope: 0.005, riverDx: 1, riverDy: 0 }, M.reeds);
  const kinds = new Set<number>();
  for (let y = 0; y < 200; y++) {
    for (let x = 0; x < 200; x++) {
      const id = cover(cell({ x: 600 + x, y: 800 + y, hand: 0.5, slope: 0.005, e: 3, exposure: 0.1, region: HOME }), MASK);
      assert.ok(id === M.marsh || (id >= M.meadowCool && id <= M.meadowWarm), MATERIAL_NAMES[id]);
      kinds.add(id === M.marsh ? M.marsh : M.meadowCool);
    }
  }
  assert.equal(kinds.size, 2, "marsh and wet meadow both");
  none({ hand: 0.5, slope: 0.09 }, M.marsh, M.reeds);
  none({ hand: 3, slope: 0.005 }, M.marsh, M.reeds);
});

test("otherwise grass: scrub where dry, meadow on the valley floor, pasture on the sides", () => {
  family({ moisture: 0.1 }, M.scrubCool);
  family({ moisture: 0.36, hand: 2, slope: 0.04 }, M.meadowCool);
  family({ moisture: 0.36, hand: 14, slope: 0.3 }, M.pastureCool);
});

test("rule order: the first match wins", () => {
  // One cell that satisfies snow, rock, scree, alpine, heath and forest at once, peeled a rule at a time.
  const all = { e: 120, slope: 0.5, rock: 0, cliffAbove: 0.95, region: HIGHLAND, wind: 0.8, hand: 12, moisture: 0.7 };
  only({ ...all, water: 3 }, M.river);
  only(all, M.snow);
  only({ ...all, e: 58, slope: 1.6 }, M.cliffHard);
  for (const id of patch({ ...all, e: 58, debris: 0.95 })) assert.ok(id === M.scree || id === M.screeStone, MATERIAL_NAMES[id]);
  {
    const seen = patch({ ...all, e: 58, rock: 2, cliffAbove: 0, slope: 0.3 });
    assert.ok(seen.has(M.alpineCool) || seen.has(M.alpineMid) || seen.has(M.alpineWarm));
    for (const id of seen) assert.ok((id >= M.alpineCool && id <= M.heathWarm) || openMoor(id), MATERIAL_NAMES[id]);
  }
  for (const id of patch({ ...all, e: 58, rock: 2, cliffAbove: 0, slope: 0.3, region: SKERRY })) {
    assert.ok((id >= M.heathCool && id <= M.heathWarm) || openMoor(id), MATERIAL_NAMES[id]);
  }
  {
    // Out of the wind the same hillside is wood wherever a copse stands, and mostly conifer at that height.
    const seen = patch({ ...all, e: 58, rock: 2, cliffAbove: 0, slope: 0.3, region: SKERRY, wind: 0.2 });
    assert.ok(seen.has(M.floorConifer), names(seen).join());
  }
  family({ ...all, e: 58, rock: 2, cliffAbove: 0, slope: 0.3, region: SKERRY, wind: 0.2, moisture: 0.1 }, M.scrubCool);
  // Sand beats the forest that would grow on the same low ground; late snow beats alpine meadow.
  only({ shore: 1, e: 0.6, slope: 0.12, exposure: 0.2, hand: 12, moisture: 0.7 }, M.sand);
  {
    let e = 60;
    while (cover(cell({ e, hand: 40, region: HIGHLAND }), MASK) !== M.snowLate) e++;
    const below = cover(cell({ e: e - 1, hand: 40, region: HIGHLAND }), MASK);
    assert.ok((below >= M.alpineCool && below <= M.heathWarm) || openMoor(below), MATERIAL_NAMES[below]);
  }
  // Where people farm the field decides: farmland beats forest on gentle ground.
  for (const id of patch({ slope: 0.11, hand: 6, moisture: 0.7, region: HOME })) assert.ok(enclosed(id) && id !== M.wall, MATERIAL_NAMES[id]);
  // The floodplain is left to flood: it is never a field.
  only({ slope: 0.005, hand: 0.05, e: 5, region: HOME }, M.reeds);
  // Woods keep the ground too steep to plough.
  {
    const seen = patch({ slope: 0.3, hand: 6, moisture: 0.7, region: SLATE });
    assert.ok(seen.has(M.floorBroadleaf));
    for (const id of seen) assert.ok(isCrop[id] === 0 && id !== M.hedge && id !== M.wall, MATERIAL_NAMES[id]);
  }
  // In the home lowland that ground is wood and open down by turns, and never a field.
  let wood = 0, down = 0;
  for (let i = 0; i < 4096; i++) {
    const id = cover(cell({ slope: 0.3, hand: 6, moisture: 0.7, region: HOME, x: 200 + 5 * (i & 63), y: 900 + 5 * (i >> 6) }), MASK);
    if (id === M.floorBroadleaf) wood++;
    else {
      assert.ok(id >= M.pastureCool && id <= M.pastureWarm, MATERIAL_NAMES[id]);
      down++;
    }
  }
  assert.ok(wood > 1.5 * down && down > 200, `${wood} wood, ${down} down`);
});

/** Indices at which a row changes. */
function flips(row: boolean[]): number[] {
  const out: number[] = [];
  for (let i = 1; i < row.length; i++) if (row[i] !== row[i - 1]) out.push(i);
  return out;
}

test("jitter makes every border a speckled band, never a line", () => {
  // Each sweep crosses one threshold over 400 cells, at about the field's natural gradient.
  const tri = (id: number, base: number): boolean => id >= base && id <= base + 2;
  const sweeps: { name: string; at: (t: number) => Partial<CoverInput>; is: (id: number) => boolean; min: number }[] = [
    { name: "cliff", at: (t) => ({ slope: 1.2 + 0.3 * t, rock: 0 }), is: (id) => id === M.cliffHard, min: 3 },
    { name: "alpine", at: (t) => ({ e: 49 + 12 * t, hand: 40, region: HIGHLAND, y: 4587 }), is: (id) => tri(id, M.alpineCool), min: 10 },
    { name: "heath", at: (t) => ({ wind: 0.4 + 0.3 * t }), is: (id) => (id >= M.heathCool && id <= M.heathWarm) || openMoor(id), min: 3 },
    { name: "forest", at: (t) => ({ moisture: 0.36 + 0.08 * t, region: HOME, hand: 20, y: 4356 }), is: (id) => id === M.floorBroadleaf, min: 3 },
    { name: "reeds", at: (t) => ({ hand: 0.05 + 0.4 * t, slope: 0.005 }), is: (id) => id === M.reeds, min: 4 },
    { name: "scrub", at: (t) => ({ moisture: 0.24 + 0.12 * t }), is: (id) => tri(id, M.scrubCool), min: 8 },
    { name: "sand", at: (t) => ({ shore: 1, e: 0.7 + 1 * t, exposure: 0.1, slope: 0.1, hand: 1 }), is: (id) => id === M.sand, min: 2 },
  ];
  for (const s of sweeps) {
    const row: boolean[] = [];
    for (let i = 0; i < 400; i++) row.push(s.is(cover(cell({ x: 700 + i, y: 4321, ...s.at(i / 399) }), MASK)));
    const f = flips(row);
    assert.notEqual(row[0], row[399], `${s.name}: the sweep must cross the border`);
    assert.ok(f.length >= 3, `${s.name}: ${f.length} flip(s) is a contour line, not a band`);
    const width = f[f.length - 1] - f[0];
    assert.ok(width >= s.min && width < 300, `${s.name}: band ${width} cells wide`);
  }
});

test("without jitter the same sweep flips once: the band comes from the mask", () => {
  const flat = new Uint8Array(65536).fill(128);
  const row: boolean[] = [];
  for (let i = 0; i < 400; i++) {
    const id = cover(cell({ wind: 0.4 + (0.3 * i) / 399, x: 700 + i, y: 4321 }), flat);
    row.push((id >= M.heathCool && id <= M.heathWarm) || openMoor(id));
  }
  assert.equal(flips(row).length, 1);
});

test("each rule reads the mask at its own offset", () => {
  const rules = Object.values(RULE);
  for (let a = 0; a < rules.length; a++) {
    for (let b = a + 1; b < rules.length; b++) {
      let same = 0;
      for (let i = 0; i < 256; i++) if (ruleJitter(MASK, i * 7, i * 3, rules[a]) === ruleJitter(MASK, i * 7, i * 3, rules[b])) same++;
      assert.ok(same < 32, `rules ${a} and ${b} share a speckle`);
    }
  }
  for (let i = 0; i < 1000; i++) {
    const j = ruleJitter(MASK, i * 31, i * 17, i % rules.length);
    assert.ok(j >= -0.5 && j < 0.5);
  }
});

test("hue variants come in large patches that dither into one another", () => {
  const counts = [0, 0, 0];
  let changes = 0;
  let jumps = 0;
  let prev = -1;
  for (let x = 0; x < WORLD_N; x++) {
    const v = hueVariant(x, 1234, HUE_CLASS.meadow, MASK, WORLD_N);
    counts[v]++;
    if (prev >= 0 && v !== prev) {
      changes++;
      if (Math.abs(v - prev) === 2) jumps++;
    }
    prev = v;
  }
  for (const c of counts) assert.ok(c > WORLD_N * 0.1, `variant shares ${counts}`);
  assert.ok(changes < WORLD_N * 0.08, `${changes} changes along ${WORLD_N} cells`);
  assert.equal(jumps, 0, "cool never sits next to warm");
  // The underlying field moves slowly: about 200 cells a feature.
  let step = 0;
  for (let x = 0; x < WORLD_N; x++) step = Math.max(step, Math.abs(hueField(x + 1, 1234, 3, WORLD_N) - hueField(x, 1234, 3, WORLD_N)));
  assert.ok(step < 0.06, `hue field steps ${step} in one cell`);
});

test("two hue variants blend over a band some 8–16 cells wide", () => {
  // Group changes that lie within 40 cells of each other into one crossing and measure each.
  const widths: number[] = [];
  let start = -1;
  let last = -1;
  let prev = -1;
  for (let x = 0; x < WORLD_N; x++) {
    const v = hueVariant(x, 777, HUE_CLASS.pasture, MASK, WORLD_N);
    if (prev >= 0 && v !== prev) {
      if (start >= 0 && x - last > 40) {
        widths.push(last - start + 1);
        start = x;
      } else if (start < 0) start = x;
      last = x;
    }
    prev = v;
  }
  assert.ok(widths.length >= 8, `${widths.length} crossings`);
  const mean = widths.reduce((a, b) => a + b, 0) / widths.length;
  assert.ok(mean >= 6 && mean <= 20, `mean blend width ${mean}`);
});

test("cover is a pure function of its inputs", () => {
  const rng = rngFor(11, "cover-test");
  for (let i = 0; i < 2000; i++) {
    const region = [rng.float(), rng.float(), rng.float(), rng.float(), rng.float(), rng.float()];
    const total = region.reduce((a, b) => a + b, 0);
    const c: CoverInput = Object.freeze({
      x: rng.int(WORLD_N), y: rng.int(WORLD_N), e: rng.range(-10, 130), slope: rng.range(0, 2.2), northness: rng.range(-1, 1),
      hand: rng.range(0, 60), moisture: rng.float(), wind: rng.float(), exposure: rng.float(), debris: rng.float(),
      rock: rng.int(3), region: Object.freeze(region.map((v) => v / total)), water: rng.float() < 0.15 ? 1 + rng.int(3) : 0,
      shore: rng.float() < 0.2 ? rng.int(5) : 0,
    });
    const a = cover(c, MASK);
    assert.equal(cover(c, MASK), a);
    assert.equal(cover({ ...c }, MASK), a);
    assert.ok(Number.isInteger(a) && a > 0 && a < MATERIAL_COUNT, `id ${a}`);
    assert.equal(isWater[a] === 1, c.water !== 0);
  }
});

test("cover tiles on the world, at the full size and the test size", () => {
  const rng = rngFor(12, "cover-test");
  for (const n of [WORLD_N, 1024]) {
    for (let i = 0; i < 1500; i++) {
      const x = rng.int(n);
      const y = rng.int(n);
      // Farmland, grass and heath exercise the parcels, the hue field and the heather drifts: all that depends on position alone.
      const kind = i % 3;
      const base = kind === 0 ? { slope: 0.03, hand: 6, region: HOME } : kind === 1 ? { moisture: 0.36 } : { wind: 0.8, region: SLATE };
      // Furrows are counted in screen rows, which wrap with the 6400 world only; elsewhere compare the crop under the texture.
      const at = (dx: number, dy: number): number => {
        const id = cover(cell({ ...base, x: x + dx, y: y + dy }), MASK, n);
        const crop = cropOf(id) === M.barley ? M.wheat : cropOf(id);
        return n === WORLD_N ? id : crop;
      };
      const here = at(0, 0);
      assert.equal(at(n, 0), here);
      assert.equal(at(0, n), here);
      assert.equal(at(-n, -n), here);
      assert.equal(fieldAt(cell({ x: x + n, y: y - n }), n).id, fieldAt(cell({ x, y }), n).id);
      assert.ok(Math.abs(hueField(x - n, y + n, kind, n) - hueField(x, y, kind, n)) < 1e-9);
    }
  }
});

test("the mask's 256-cell period does not show in the hue field or the parcels", () => {
  let hueSame = 0;
  let parcelSame = 0;
  for (let i = 0; i < 400; i++) {
    const x = (i * 37) % WORLD_N;
    const y = (i * 91) % WORLD_N;
    if (Math.abs(hueField(x, y, 0, WORLD_N) - hueField(x + 256, y, 0, WORLD_N)) < 1e-9) hueSame++;
    if (fieldAt(cell({ x, y })).id === fieldAt(cell({ x: x + 256, y })).id) parcelSame++;
  }
  assert.equal(hueSame, 0);
  assert.ok(parcelSame < 20);
});
