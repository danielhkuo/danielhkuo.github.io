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

test("sand: the beach stamp, or low sheltered flat ground", () => {
  only({ shore: 1, e: 0.6, slope: 0.1 }, M.sand);
  only({ shore: 4, e: 0.6, slope: 0.1, region: KARST }, M.sandPale);
  only({ e: 0.8, exposure: 0.1, slope: 0.03, hand: 0.8 }, M.sand);
  // Exposed, steep or high ground is not sand.
  none({ e: 0.8, exposure: 0.8, slope: 0.03, hand: 0.8 }, M.sand, M.sandPale);
  none({ e: 0.8, exposure: 0.1, slope: 0.4, hand: 0.8 }, M.sand, M.sandPale);
  none({ e: 6, exposure: 0.1, slope: 0.03, hand: 6 }, M.sand, M.sandPale);
});

test("rocky shores get a shingle line and a rock bench", () => {
  only({ shore: 2, e: 0.5, slope: 0.2 }, M.shingle);
  only({ shore: 2, e: 1.8, slope: 0.2, rock: 2 }, M.rockSed);
  only({ shore: 2, e: 1.8, slope: 0.2, rock: 0 }, M.rockHard);
});

test("snow: cold and not too steep; north faces are colder; cliffs shed it", () => {
  only({ e: 120, hand: 60 }, M.snow);
  only({ e: 78, northness: 1, hand: 60 }, M.snow);
  none({ e: 78, northness: -1, hand: 60 }, M.snow, M.snow);
  none({ e: 120, slope: 1.4, hand: 60 }, M.snow, M.snowLate);
});

test("bare rock: faces on any rock, steep ground on hard rock, in the region's stone", () => {
  only({ slope: 2.2, rock: 0 }, M.cliffHard);
  only({ slope: 2.2, rock: 2 }, M.cliffSed);
  only({ slope: 2.2, rock: 0, region: KARST }, M.cliffLime);
  only({ slope: 2.2, rock: 2, region: SLATE }, M.cliffSlate);
  only({ slope: 1.25, rock: 0 }, M.rockHard);
  only({ slope: 1.25, rock: 0, region: KARST }, M.rockLime);
  only({ slope: 1.25, rock: 0, region: SLATE }, M.rockSlate);
  // Steep ground on soft rock keeps its soil.
  none({ slope: 1.25, rock: 2 }, M.rockHard, M.cliffSlate);
  // A cliffed shore shows its face at a gentler slope.
  only({ slope: 1.25, rock: 2, shore: 3, e: 8 }, M.cliffSed);
});

test("scree: debris on a middling slope", () => {
  only({ debris: 0.95, slope: 0.8, rock: 2 }, M.scree);
  only({ debris: 0.95, slope: 0.8, rock: 2, region: SLATE }, M.screeSlate);
  none({ debris: 0.5, slope: 0.8, rock: 2 }, M.scree, M.screeSlate);
  none({ debris: 0.95, slope: 0.2, rock: 2 }, M.scree, M.screeSlate);
  none({ debris: 0.95, slope: 1.5, rock: 2 }, M.scree, M.screeSlate);
});

test("late snow lies under the permanent snow", () => {
  only({ e: 77, hand: 50 }, M.snowLate);
  only({ e: 77, hand: 50, region: HIGHLAND }, M.snowLate);
});

test("alpine meadow: highland or lake country, cold, gentle", () => {
  family({ e: 63, hand: 40, region: HIGHLAND }, M.alpineCool);
  family({ e: 63, hand: 40, region: LAKES }, M.alpineCool);
  family({ e: 63, hand: 40, region: [0, 0.4, 0, 0.4, 0, 0.2] }, M.alpineCool);
  none({ e: 63, hand: 40, region: HOME }, M.alpineCool, M.alpineWarm);
  none({ e: 63, hand: 40, slope: 0.75, region: HIGHLAND }, M.alpineCool, M.alpineWarm);
  none({ e: 40, hand: 40, region: HIGHLAND }, M.alpineCool, M.alpineWarm);
});

test("heath: wind-blown ground and the tops of valley country; heather where dry or slaty, moor where wet", () => {
  family({ wind: 0.8, moisture: 0.05, region: SLATE }, M.heathCool);
  family({ wind: 0.8, moisture: 0.95 }, M.moorCool);
  family({ wind: 0.2, hand: 45, region: SLATE, moisture: 0.3 }, M.heathCool);
  // High HAND alone is not heath outside valley country.
  none({ wind: 0.2, hand: 45 }, M.heathCool, M.moorWarm);
});

test("forest: lower valley sides, moist, sheltered; conifer where it is cold", () => {
  const wood = { hand: 12, slope: 0.3, moisture: 0.7, wind: 0.2 };
  only({ ...wood, e: 20 }, M.floorBroadleaf);
  only({ ...wood, e: 57 }, M.floorConifer);
  for (const no of [{ hand: 0.5 }, { hand: 45 }, { slope: 0.02 }, { slope: 0.88 }, { moisture: 0.3 }, { wind: 0.6 }, { e: 65 }]) {
    none({ ...wood, e: 20, ...no }, M.floorBroadleaf, M.floorConifer);
  }
});

test("the conifer line is a wide belt of mixed wood", () => {
  const wood = { hand: 12, slope: 0.3, moisture: 0.7, wind: 0.2 };
  const share = (e: number): number => {
    let conifer = 0;
    for (let i = 0; i < 1024; i++) {
      if (cover(cell({ ...wood, e, x: 200 + (i & 31), y: 300 + (i >> 5) }), MASK) === M.floorConifer) conifer++;
    }
    return conifer / 1024;
  };
  assert.equal(share(33), 0);
  assert.ok(share(40) > 0.1 && share(40) < 0.4);
  assert.ok(share(45) > 0.4 && share(45) < 0.6);
  assert.ok(share(50) > 0.6 && share(50) < 0.9);
  assert.equal(share(57), 1);
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
    assert.ok(wall / 90000 > 0.015 && wall / 90000 < 0.1, `walls ${wall / 90000}`);
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

test("marsh and reeds: flat ground at the water's level", () => {
  only({ hand: 0.1, slope: 0.005 }, M.reeds);
  only({ hand: 0.65, slope: 0.005 }, M.marsh);
  none({ hand: 0.65, slope: 0.06 }, M.marsh, M.reeds);
  none({ hand: 3, slope: 0.005 }, M.marsh, M.reeds);
});

test("otherwise grass: scrub where dry, meadow on the valley floor, pasture on the sides", () => {
  family({ moisture: 0.1 }, M.scrubCool);
  family({ moisture: 0.36, hand: 2, slope: 0.04 }, M.meadowCool);
  family({ moisture: 0.36, hand: 14, slope: 0.3 }, M.pastureCool);
});

test("rule order: the first match wins", () => {
  // One cell that satisfies snow, rock, scree, alpine, heath and forest at once, peeled a rule at a time.
  const all = { e: 120, slope: 1.05, rock: 0, debris: 0.95, region: HIGHLAND, wind: 0.8, hand: 12, moisture: 0.7 };
  only({ ...all, water: 3 }, M.river);
  only(all, M.snow);
  only({ ...all, e: 58 }, M.rockHard);
  only({ ...all, e: 58, rock: 2 }, M.scree);
  family({ ...all, e: 58, rock: 2, debris: 0, slope: 0.3 }, M.alpineCool);
  for (const id of patch({ ...all, e: 58, rock: 2, debris: 0, slope: 0.3, region: SKERRY })) {
    assert.ok(id >= M.heathCool && id <= M.moorWarm, MATERIAL_NAMES[id]);
  }
  only({ ...all, e: 58, rock: 2, debris: 0, slope: 0.3, region: SKERRY, wind: 0.2 }, M.floorConifer);
  family({ ...all, e: 58, rock: 2, debris: 0, slope: 0.3, region: SKERRY, wind: 0.2, moisture: 0.1 }, M.scrubCool);
  // Sand beats the forest that would grow on the same low ground; late snow beats alpine meadow.
  only({ shore: 1, e: 0.6, slope: 0.3, hand: 12, moisture: 0.7 }, M.sand);
  only({ e: 77, hand: 40, region: HIGHLAND }, M.snowLate);
  // Where people farm the field decides: farmland beats forest on gentle ground, and marsh on the valley floor.
  for (const id of patch({ slope: 0.11, hand: 6, moisture: 0.7, region: HOME })) assert.ok(enclosed(id) && id !== M.wall, MATERIAL_NAMES[id]);
  for (const id of patch({ slope: 0.005, hand: 0.1, e: 5, region: HOME })) assert.ok(enclosed(id), MATERIAL_NAMES[id]);
  // Woods keep the ground too steep to plough.
  only({ slope: 0.3, hand: 6, moisture: 0.7, region: HOME }, M.floorBroadleaf);
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
    { name: "snow", at: (t) => ({ e: 81.2 + 1.6 * t, hand: 50 }), is: (id) => id === M.snow, min: 2 },
    { name: "rock", at: (t) => ({ slope: 0.75 + 0.3 * t, rock: 0 }), is: (id) => id === M.rockHard, min: 3 },
    { name: "scree", at: (t) => ({ debris: 0.6 + 0.3 * t, slope: 0.8, rock: 2 }), is: (id) => id === M.scree, min: 6 },
    { name: "alpine", at: (t) => ({ e: 49 + 12 * t, hand: 40, region: HIGHLAND }), is: (id) => tri(id, M.alpineCool), min: 10 },
    { name: "heath", at: (t) => ({ wind: 0.4 + 0.3 * t }), is: (id) => id >= M.heathCool && id <= M.moorWarm, min: 12 },
    { name: "forest", at: (t) => ({ moisture: 0.36 + 0.08 * t }), is: (id) => id === M.floorBroadleaf, min: 3 },
    { name: "marsh", at: (t) => ({ hand: 0.4 + 1.2 * t, slope: 0.005 }), is: (id) => id === M.marsh || id === M.reeds, min: 4 },
    { name: "scrub", at: (t) => ({ moisture: 0.24 + 0.12 * t }), is: (id) => tri(id, M.scrubCool), min: 8 },
    { name: "sand", at: (t) => ({ e: 1 + 1 * t, exposure: 0.1, slope: 0.03, hand: 1 }), is: (id) => id === M.sand, min: 2 },
  ];
  for (const s of sweeps) {
    const row: boolean[] = [];
    for (let i = 0; i < 400; i++) row.push(s.is(cover(cell({ ...s.at(i / 399), x: 700 + i, y: 4321 }), MASK)));
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
    row.push(id >= M.heathCool && id <= M.moorWarm);
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
