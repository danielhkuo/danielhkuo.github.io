import assert from "node:assert/strict";
import { test } from "node:test";
import { isBuilt, isCanopy, isWater, MATERIAL as M, MATERIAL_COUNT } from "../look/materials.ts";
import type { Structure } from "./built.ts";
import { bridge, harbourWorks, inBasin } from "./settle.ts";
import * as S from "./structures.ts";
import type { LandmarkType } from "../sites/assign.ts";
import { BOX } from "./sites.ts";

/** Columns and rows that hold something standing, and the greatest height of tops and marks. */
function extent(s: Structure): { w: number; d: number; h: number } {
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity, h = 0;
  for (let y = 0; y < s.h; y++) for (let x = 0; x < s.w; x++) {
    const t = s.top[y * s.w + x];
    if (t <= 0) continue;
    x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
    h = Math.max(h, t);
  }
  for (let k = 0; k < s.marks.length; k += 5) {
    x0 = Math.min(x0, s.marks[k]); x1 = Math.max(x1, s.marks[k]);
    h = Math.max(h, s.marks[k + 2]);
  }
  return { w: x1 - x0 + 1, d: y1 - y0 + 1, h };
}

function wellFormed(s: Structure, name: string): void {
  const c = s.w * s.h;
  assert.equal(s.top.length, c, name);
  assert.equal(s.mat.length, c, name);
  assert.equal(s.tone.length, c, name);
  assert.equal(s.paint.length, c, name);
  assert.equal(s.marks.length % 5, 0, name);
  for (let i = 0; i < c; i++) {
    assert.ok(s.top[i] >= 0, name);
    if (s.top[i] > 0) {
      assert.ok(s.mat[i] > 0 && s.mat[i] < MATERIAL_COUNT, `${name}: a standing cell has a material`);
      assert.ok(!isWater[s.mat[i]] && !isCanopy[s.mat[i]], `${name}: built of something built`);
    }
    assert.ok(s.paint[i] < MATERIAL_COUNT, name);
  }
  for (let k = 0; k < s.marks.length; k += 5) {
    const [x, y, z, mat, tone] = s.marks.slice(k, k + 5);
    assert.ok(Number.isInteger(x) && Number.isInteger(y) && x >= 0 && y >= 0 && x < s.w && y < s.h, `${name}: mark ${x},${y} lies in the raster`);
    // Built materials at a fixed light; the one exception is the river showing at the foot of a bridge's arch.
    assert.ok(z >= 1 && ((isBuilt[mat] === 1 && tone > 0 && tone < 256) || (mat === M.river && z === 1)), `${name}: mark ${x},${y},${z}`);
  }
}

test("every landmark stays inside its sprite box (design 5.9)", () => {
  const boxes: [string, Structure, number, number, number][] = [
    ["abbey", S.abbey(), 30, 24, 36],
    ["bell tower", S.bellTower(), 7, 7, 40],
    ["lighthouse", S.lighthouse(), 7, 7, 40],
    ["windmill", S.windmill(), 9, 9, 30],
    ["ruined cathedral", S.ruinedCathedral(1), 34, 16, 26],
    ["ruined cathedral", S.ruinedCathedral(99), 34, 16, 26],
    ["ruined cathedral, transept", S.ruinedCathedral(5, 0), 34, 16, 26],
    ["ruined cathedral, tower", S.ruinedCathedral(5, 1), 34, 16, 26],
    ["parish church", S.parishChurch(), 15, 8, 16],
    ["wayside cross", S.waysideCross(), 6, 6, 10],
    ["sheepfold", S.sheepfold(), 6, 6, 10],
  ];
  for (const [name, s, w, d, h] of boxes) {
    wellFormed(s, name);
    const e = extent(s);
    assert.ok(e.w <= w && e.d <= d, `${name} footprint ${e.w} × ${e.d}`);
    assert.ok(e.h <= h, `${name} height ${e.h}`);
    if (h > 10) assert.ok(e.h >= h * 0.5, `${name} uses its height: ${e.h}`);
  }
});

test("the six churches of the climates: each within its sprite box, a gilt cross on each, pointed windows, built of built things", () => {
  const churches: [LandmarkType, Structure][] = [
    ["hospice", S.hospice()], ["stave", S.staveChurch()], ["hermitage", S.hermitage()],
    ["monastery", S.monastery()], ["roundchurch", S.roundChurch()], ["chapel", S.riverChapel()],
  ];
  const has = (s: Structure, mat: number): number => s.marks.filter((_, k) => k % 5 === 3 && s.marks[k] === mat).length;
  for (const [type, s] of churches) {
    wellFormed(s, type);
    const e = extent(s), box = BOX[type];
    assert.ok(s.w <= box.w && s.h <= box.d && e.w <= box.w && e.d <= box.d, `${type} footprint ${s.w} × ${s.h}`);
    assert.ok(e.h <= box.h && e.h >= box.h * 0.5, `${type} height ${e.h}`);
    assert.ok(has(s, M.gilt) >= 5, `${type}: a cross`);
    assert.ok(has(s, M.opening) >= 3, `${type}: windows`);
    for (let i = 0; i < s.top.length; i++) if (s.top[i] > 0) assert.equal(isBuilt[s.mat[i]], 1, type);
    // The cross is the highest thing on it.
    let cross = 0;
    for (let k = 0; k < s.marks.length; k += 5) if (s.marks[k + 3] === M.gilt) cross = Math.max(cross, s.marks[k + 2]);
    assert.equal(cross, e.h, `${type}: the cross stands highest`);
  }
  // The hermitage's bell wall is its tallest part; the stave church has white crosses on its gables.
  const hm = S.hermitage();
  let wall = 0, roof = 0;
  for (let i = 0; i < hm.top.length; i++) {
    if (hm.mat[i] === M.whitewash) wall = Math.max(wall, hm.top[i]);
    else roof = Math.max(roof, hm.top[i]);
  }
  assert.ok(wall > roof + 3, `bell wall ${wall}, roof ${roof}`);
  assert.ok(has(S.staveChurch(), M.whitewash) >= 12, "white crosses on three gables");
  // The landing stage runs the way it is told, planks over its base.
  const st = S.riverStage(0, 8, 2, 1);
  wellFormed(st, "stage");
  assert.ok(st.h >= 9 && st.w <= 6);
});

test("the churchyard: a yew no wider than 13 and no taller than 18, a chapel within 10 × 7 × 14, a wall with a gate", () => {
  const s = S.churchyard(5);
  wellFormed(s, "churchyard");
  let yx0 = 99, yx1 = 0, yy0 = 99, yy1 = 0, yewTop = 0, chapelTop = 0, wall = 0, gate = 0;
  for (let y = 0; y < s.h; y++) for (let x = 0; x < s.w; x++) {
    const i = y * s.w + x;
    if (s.mat[i] === M.yew) { yx0 = Math.min(yx0, x); yx1 = Math.max(yx1, x); yy0 = Math.min(yy0, y); yy1 = Math.max(yy1, y); yewTop = Math.max(yewTop, s.top[i]); }
    else if (s.top[i] > 2) chapelTop = Math.max(chapelTop, s.top[i]);
    else if (s.top[i] > 0) wall++;
    if (y === s.h - 1 || (y >= s.h - 3 && s.top[i] === 0 && s.paint[i] !== 0 && s.top[i + s.w] === 0 && y + 1 < s.h && s.paint[i + s.w] === 0)) gate += s.top[i] === 0 && s.paint[i] !== 0 ? 1 : 0;
  }
  assert.ok(yx1 - yx0 + 1 <= 13 && yy1 - yy0 + 1 <= 13, `yew ${yx1 - yx0 + 1} × ${yy1 - yy0 + 1}`);
  assert.ok(yewTop <= 18 && yewTop >= 12, `yew ${yewTop}`);
  assert.ok(chapelTop <= 14);
  assert.ok(wall > 40, "a wall rings the yard");
  assert.ok(gate > 0, "the wall has a gate in its south side");
  // The cross on the bellcote.
  assert.ok(s.marks.some((_, k) => k % 5 === 3 && s.marks[k] === M.gilt));
});

test("houses: no wider than 8 (a merchant's town house 11) or deeper than 8, no taller than 14; a wall row to the south with a door and windows on it", () => {
  for (let seed = 0; seed < 400; seed++) {
    for (const [name, s] of [["town house", S.townHouse(seed * 2654435761 >>> 0)], ["country house", S.countryHouse(seed * 40503, (seed & 1) === 0)], ["cottage", S.cottage(seed)]] as const) {
      wellFormed(s, name);
      const e = extent(s);
      assert.ok(e.w <= (name === "town house" ? 11 : 8) && e.d <= 8 && e.h <= 14, `${name} ${e.w} × ${e.d} × ${e.h}`);
      const south = s.h - 1;
      for (let x = 0; x < s.w; x++) {
        const m = s.mat[south * s.w + x];
        assert.ok(m === M.whitewash || m === M.plaster || m === M.stone || m === M.stoneDark, `${name}: the south row is wall`);
        // The roof behind the wall is never lower than it: the wall is not hidden by its own roof falling away.
        assert.ok(s.top[(south - 1) * s.w + x] >= s.top[south * s.w + x] - 1e-6);
      }
      const roof = s.mat[0];
      assert.ok(roof === M.roofSlate || roof === M.roofTile, `${name}: a pitched roof of slate or tile`);
      // Every opening is on the wall row, below the wall's top.
      let openings = 0;
      for (let k = 0; k < s.marks.length; k += 5) {
        assert.equal(s.marks[k + 1], south, `${name}: marks are on the south wall`);
        assert.ok(s.marks[k + 2] < s.top[south * s.w + s.marks[k]] + 2);
        openings++;
      }
      assert.ok(openings >= 2, `${name}: a door and a window`);
    }
  }
});

test("the cross, the clock and the lamp: church-built marks where they belong", () => {
  const has = (s: Structure, mat: number): number => s.marks.filter((_, k) => k % 5 === 3 && s.marks[k] === mat).length;
  // A cross is an upright with two arms, in gilt, on the abbey's tower and the bell tower.
  assert.equal(has(S.abbey(), M.gilt), 6);
  assert.equal(has(S.bellTower(), M.gilt), 6);
  assert.equal(has(S.bellTower(), M.dial), 9);
  assert.ok(has(S.lighthouse(), M.brick) >= 15, "a band right round the face");
  assert.ok(has(S.windmill(), M.sailcloth) >= 8);
  assert.ok(has(S.ruinedCathedral(3), M.opening) > 30, "empty windows");
  // Nothing a builder makes uses a terrain or water material for a standing cell.
  for (const s of [S.abbey(), S.bellTower(), S.lighthouse(), S.windmill(), S.ruinedCathedral(3)]) {
    for (let i = 0; i < s.top.length; i++) if (s.top[i] > 0) assert.equal(isBuilt[s.mat[i]], 1);
  }
});

test("a bridge: a deck from bank to bank, parapets, a hump over the water and arches on its south face", () => {
  const b = bridge(100, 200, 126, 200, 4, 6, 6, 16, 7.5);
  wellFormed(b, "bridge");
  assert.equal(b.base, 4);
  const row = (y: number) => [...b.top.subarray((y - b.y) * b.w, (y - b.y + 1) * b.w)];
  const mid = row(200);
  // The deck spans the banks and is highest in the middle, clear of the water by the rise asked for.
  assert.ok(mid[100 - b.x] > 0 && mid[125 - b.x] > 0);
  const crown = Math.max(...mid);
  assert.ok(crown + b.base >= 4 + 7.5 - 0.2, `crown ${crown + b.base}`);
  assert.ok(crown <= 14, "the deck stays within 14 of the water");
  assert.ok(mid[100 - b.x] < crown - 2);
  // A road two cells wide between stone parapets.
  const col = 113 - b.x;
  const mats = [198, 199, 200, 201].map((y) => b.mat[(y - b.y) * b.w + col]);
  assert.deepEqual(mats, [M.stone, M.road, M.road, M.stone]);
  assert.equal(b.top[(197 - b.y) * b.w + col], 0);
  assert.equal(b.top[(202 - b.y) * b.w + col], 0);
  // Arches: shade marks on the south face, none through the piers at the ends.
  const arch = b.marks.filter((_, k) => k % 5 === 3 && b.marks[k] === M.opening).length;
  assert.ok(arch >= 12, `arch marks ${arch}`);
  const cols = new Set<number>();
  let water = 0;
  for (let k = 0; k < b.marks.length; k += 5) {
    assert.equal(b.marks[k + 1], 201 - b.y, "on the south parapet's face");
    if (b.marks[k + 3] === M.stoneDark) continue;
    assert.ok(b.marks[k] > 102 - b.x && b.marks[k] < 124 - b.x, "arches stand between the abutments");
    cols.add(b.marks[k]);
    if (b.marks[k + 3] === M.river) { water++; assert.equal(b.marks[k + 2], 1); }
  }
  // One to three openings with a pier between: runs of arch columns separated by solid ones.
  let runs = 0;
  for (const x of cols) if (!cols.has(x - 1)) runs++;
  assert.ok(runs >= 1 && runs <= 3, `${runs} arches`);
  assert.equal(water, cols.size, "the river shows at the foot of every arch column");
  // A low footbridge has no room for arches.
  const low = bridge(100, 200, 110, 200, 4, 5, 5, 4, 1);
  assert.equal(low.marks.filter((_, k) => k % 5 === 3 && (low.marks[k] === M.opening || low.marks[k] === M.river)).length, 0);
});

test("no two ruins or churchyards are the same: the kind changes the plan, the seed the details and the handedness", () => {
  const differ = (a: Structure, b: Structure): number => {
    let d = 0;
    for (let i = 0; i < a.top.length; i++) if ((a.top[i] > 0) !== (b.top[i] > 0) || Math.abs(a.top[i] - b.top[i]) > 2) d++;
    return d / a.top.length;
  };
  for (let seed = 1; seed < 40; seed++) {
    const r0 = S.ruinedCathedral(seed, 0), r1 = S.ruinedCathedral(seed, 1);
    wellFormed(r0, "ruin 0");
    wellFormed(r1, "ruin 1");
    assert.ok(differ(r0, r1) > 0.12, `ruins of seed ${seed} differ in ${differ(r0, r1)} of their cells`);
    // Kind 1 keeps its tower: something stands over 18 on the wall row of a six-cell shaft.
    let tall = 0;
    for (let i = 0; i < r1.top.length; i++) if (r1.top[i] >= 18) tall++;
    assert.ok(tall >= 8, `the tower stands (${tall} cells)`);
    const y0 = S.churchyard(seed, 0), y1 = S.churchyard(seed, 1);
    wellFormed(y0, "churchyard 0");
    wellFormed(y1, "churchyard 1");
    assert.ok(differ(y0, y1) > 0.08, `churchyards of seed ${seed} differ in ${differ(y0, y1)}`);
    for (const y of [y0, y1]) {
      // A cross on the bellcote, and a way from the gate in the south wall.
      assert.ok(y.marks.some((_, k) => k % 5 === 3 && y.marks[k] === M.gilt));
      const gate = S.gateOf(y);
      assert.ok(gate && gate[1] >= y.h - 3, "the path reaches the south wall");
    }
  }
  // Both hands occur: the yew stands west of the chapel in some yards and east in others.
  const sides = new Set<boolean>();
  for (let seed = 1; seed < 40; seed++) {
    const y = S.churchyard(seed, 0);
    let sum = 0, count = 0;
    for (let i = 0; i < y.top.length; i++) if (y.mat[i] === M.yew) { sum += i % y.w; count++; }
    sides.add(sum / count < y.w / 2);
  }
  assert.equal(sides.size, 2);
  const m = S.mirrored(S.townHouse(77));
  assert.deepEqual(S.mirrored(m), S.townHouse(77));
});

test("the harbour: a quay wall round a basin with no square corner, a slipway, a curved mole with a light on its head, a pier on the river's side", () => {
  for (const river of [-1, 1]) {
    const h = harbourWorks(river);
    wellFormed(h, "harbour");
    const at = (x: number, y: number): number => h.top[y * h.w + x];
    const X = 49, Y = 3;
    // The quay wall follows the basin's round: stone along the town's front, further south towards either end.
    const front = (lx: number): number => { for (let y = 0; y < h.h; y++) if (at(X + lx, y) >= 2.4 && inBasin(lx + 0.5, y + 1.5 - Y, river, 0)) return y; return -1; };
    let wall = 0;
    for (let lx = -28; lx <= 28; lx++) if (front(lx) >= 0) wall++;
    assert.ok(wall >= 50, `quay wall ${wall}`);
    assert.ok(front(-26) > front(0) + 2 && front(26) > front(0) + 2, "the quay bends round the basin");
    // The basin has no square corner: its north edge is an arc, never a ruled line the length of the quay.
    for (let y = 0; y < h.h; y++) {
      let run = 0;
      for (let x = 1; x < h.w; x++) {
        const edge = inBasin(x + 0.5 - X, y + 0.5 - Y, river, 0) && !inBasin(x + 0.5 - X, y - 0.5 - Y, river, 0);
        run = edge ? run + 1 : 0;
        assert.ok(run <= 26, `a straight edge of ${run} cells in row ${y}`);
      }
    }
    // The slipway runs down from the quay into the water.
    const slip = X + river * 13;
    assert.ok(at(slip, Y + 4) > at(slip, Y + 8) && at(slip, Y + 8) > 0, "the slipway slopes into the basin");
    // The mole springs from the end away from the river and curves round the basin's south side.
    assert.ok(at(X - river * 39, Y + 14) > 2, "the mole's root");
    assert.ok(at(X - river * 20, Y + 30) > 2, "the mole's arm, south of the basin");
    assert.equal(at(X - river * 6, Y + 12), 0, "open water in the basin");
    assert.equal(at(X + river * 29, Y + 28), 0, "the mouth is open");
    assert.ok(at(X + river * 39, Y + 16) > 2, "the pier");
    // Where the shore already stands, there is no mole.
    const bare = harbourWorks(river, (_i, j) => j > Y + 8);
    assert.equal(bare.top[(Y + 30) * bare.w + X - river * 20], 0);
    // The seaward edge carries a parapet, a step above the walk.
    let parapet = 0;
    for (let i = 0; i < h.top.length; i++) if (h.top[i] > 3.5 && h.top[i] < 4) parapet++;
    assert.ok(parapet > 30, `parapet ${parapet}`);
    assert.equal(h.marks.filter((_, k) => k % 5 === 3 && h.marks[k] === M.lantern).length, 1);
    // Nothing is of timber: no legs under a slab.
    for (let i = 0; i < h.top.length; i++) if (h.top[i] > 0) assert.notEqual(h.mat[i], M.timber);
  }
});

test("staging: a precinct leaves the way in open and the building's box clear; a copse keeps its middle open", () => {
  const p = S.precinct(66, 46, 34, 16, 9, 0, 1);
  assert.equal(p.onGround, true);
  let walls = 0, trees = 0;
  for (let y = 0; y < p.h; y++) for (let x = 0; x < p.w; x++) {
    const t = p.top[y * p.w + x];
    if (t <= 0) continue;
    if (isCanopy[p.mat[y * p.w + x]]) trees++;
    else walls++;
    assert.ok(!(Math.abs(x - 32.5) < 15 && Math.abs(y - 22.5) < 6 && t > 2), "nothing tall inside the building's box");
    if (y > 23 && Math.abs(x - 32.5) < 3) assert.ok(!(t > 1 && !isCanopy[p.mat[y * p.w + x]] && y > 31), "no wall across the way in");
  }
  assert.ok(walls > 30 && trees > 20, `${walls} wall cells, ${trees} crown cells`);
  const c = S.copse(58, 46, 18, 12, 4);
  for (let y = 0; y < c.h; y++) for (let x = 0; x < c.w; x++) {
    if (c.top[y * c.w + x] > 0) assert.ok((x - 28.5) * (x - 28.5) + (y - 22.5) * (y - 22.5) > 13 * 13, "the middle is open");
  }
});

test("builders are deterministic", () => {
  assert.deepEqual(S.ruinedCathedral(7), S.ruinedCathedral(7));
  assert.notDeepEqual(S.ruinedCathedral(7).top, S.ruinedCathedral(8).top);
  assert.deepEqual(S.churchyard(7), S.churchyard(7));
  assert.deepEqual(S.townHouse(12345), S.townHouse(12345));
});
