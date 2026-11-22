// Rock faces, cliff lips, the apron at a sea cliff's foot and streams: the round-8 bake.

import assert from "node:assert/strict";
import { test } from "node:test";
import { fieldWorld, loadMask, M_LAND, M_RIVER, M_SEA, plainLook } from "../testing/bakefix.ts";
import { AUX_ROCK, buildCells, F_BEDDED, F_CLIFF, F_QUIET, F_SEACLIFF, type Look } from "./cells.ts";
import { bakeWindow, tileCache } from "./chunk.ts";
import { INK_FULL, inkCliffs, landBreaks, newPainted, rockFaces, SILHOUETTE_HIDDEN, SWELL_DROP, WALL_SPAN } from "./ink.ts";
import { riverIndex, type BakeWorld } from "./world.ts";

const mask = loadMask();
const M_ROCK = 6, M_APRON = 7, M_BOULDER = 8;

/** A look whose steep ground is rock, with an apron. */
function rockLook(): Look {
  const look = plainLook();
  const isRock = new Uint8Array(256);
  isRock[M_ROCK] = 1;
  return {
    ...look,
    cover: (c) => (c.water === 0 ? (c.slope > 1.2 ? M_ROCK : M_LAND) : c.water === 3 ? M_RIVER : M_SEA),
    isRock, apron: M_APRON, apronRock: M_BOULDER,
  };
}

/** A plateau 24 high that falls to the sea in a cliff about four cells deep, its edge wandering; the coast is classed a cliff. */
function cliffWorld(n: number): BakeWorld {
  const edge = (x: number) => 200 + 6 * Math.sin(x / 23);
  const w = fieldWorld(n, (x, y) => Math.max(-4, Math.min(24, (edge(x) - y) * 6)));
  for (let i = 0; i < w.gN * w.gN; i++) if (w.waterKind[i] === 0) w.shore[i] = 3;
  return w;
}

test("a slight swell takes no line; a ridge, a crest and a silhouette against higher ground do", () => {
  // Three rows hidden, the ground beyond three lower: ink once, now only where the land is firm or the hollow deep.
  assert.equal(landBreaks(3, 3, 3, false), false);
  assert.equal(landBreaks(3, 3, 3, true), true);
  assert.equal(landBreaks(4, SWELL_DROP, SWELL_DROP, false), true);
  // A crest before higher ground: nothing beyond it is lower, but a hollow lies hidden behind it.
  assert.equal(landBreaks(SILHOUETTE_HIDDEN, -6, 5, true), true);
  assert.equal(landBreaks(SILHOUETTE_HIDDEN - 1, -6, 5, true), false);
  assert.equal(landBreaks(SILHOUETTE_HIDDEN, -6, 2, true), false);
});

/** A painted wall: columns of one rock cell each, 24 pixels tall from row 4, standing on the water. */
function wall(bedded: boolean, sea: boolean) {
  const W = 96, H = 32;
  const p = newPainted(1000, 0, W, H);
  for (let c = 0; c < W; c++) for (let r = 0; r < H; r++) {
    const i = r * W + c;
    p.light[i] = 128;
    if (r < 4 || r >= 28) { p.height[i] = r < 4 ? 24 : 0; p.span[i] = 1; continue; }
    p.height[i] = 24;
    p.wall[i] = r - 4;
    p.span[i] = 12;
    p.aux[i] = AUX_ROCK | 2;
    p.flags[i] = F_CLIFF | (bedded ? F_BEDDED : 0) | (sea ? F_SEACLIFF : 0);
  }
  return p;
}

test("a rock wall is drawn in level beds, more of them in sedimentary rock, with a few fissures and no pickets", () => {
  const beds = (bedded: boolean): number => {
    const p = wall(bedded, false);
    rockFaces(p);
    // Bedding lines: rows much darker than the row above, counted down one column.
    let lines = 0, cols = 0;
    for (let c = 8; c < 88; c += 4, cols++) for (let r = 6; r < 28; r++) if (p.light[r * 96 + c] < p.light[(r - 1) * 96 + c] - 20) lines++;
    return lines / cols;
  };
  const hard = beds(false), soft = beds(true);
  assert.ok(hard >= 1.5 && hard <= 4, `hard rock shows ${hard} bedding lines a column`);
  assert.ok(soft > hard + 1.5, `sedimentary rock shows more (${soft} against ${hard})`);

  const p = wall(false, false);
  rockFaces(p);
  // No column is one tone from top to bottom, and the tones run along the face: most pixels match the one beside them.
  let same = 0, count = 0, inked = 0;
  for (let c = 8; c < 88; c++) {
    let lo = 255, hi = 0;
    for (let r = 5; r < 28; r++) {
      const i = r * 96 + c, l = p.light[i];
      lo = Math.min(lo, l); hi = Math.max(hi, l);
      if (Math.abs(l - p.light[i + 1]) <= 6) same++;
      count++;
      if (p.ink[i] !== 0) inked++;
    }
    assert.ok(hi - lo >= 20, `column ${c} is one flat tone`);
  }
  assert.ok(same / count > 0.8, `beds run along the face (${(same / count).toFixed(2)})`);
  assert.ok(inked / count < 0.08, `ink is sparing on the face (${(inked / count).toFixed(3)})`);
  // Ground that is not rock is left alone.
  for (let c = 0; c < 96; c++) assert.equal(p.light[2 * 96 + c], 128);
});

test("a sea cliff has a dark, wet foot; an inland wall has none", () => {
  const foot = (sea: boolean): number => {
    const p = wall(false, sea);
    rockFaces(p);
    let bottom = 0, mid = 0;
    for (let c = 8; c < 88; c++) { bottom += p.light[27 * 96 + c]; mid += p.light[14 * 96 + c]; }
    return (mid - bottom) / 80;
  };
  assert.ok(foot(true) > 30, `the foot of a sea cliff is ${foot(true)} darker than its middle`);
  assert.ok(foot(true) > foot(false) + 25);
});

test("a cliff's lip is one unbroken line though the wall's top jumps from column to column", () => {
  const W = 64, H = 40;
  const p = newPainted(0, 0, W, H);
  const top = (c: number) => 10 + ((c * 7) % 3) + (c > 30 ? 3 : 0);
  for (let c = 0; c < W; c++) for (let r = 0; r < H; r++) {
    const i = r * W + c;
    p.y[i] = 100 + r;
    p.span[i] = 1;
    if (r >= top(c) && r < 32) { p.flags[i] = F_CLIFF; p.aux[i] = AUX_ROCK | 2; p.span[i] = 12; p.wall[i] = r - top(c); }
  }
  inkCliffs(p, new Uint8Array(256));
  let before = -1, beforeFirst = 0;
  for (let c = 4; c < W - 4; c++) {
    let first = -1, last = -1;
    for (let r = 0; r < 32; r++) if (p.ink[r * W + c] !== 0) { if (first < 0) first = r; last = r; }
    assert.ok(first >= 0, `no lip at column ${c}`);
    assert.equal(p.ink[first * W + c], INK_FULL);
    assert.ok(Math.abs(first - top(c)) <= 3, `the lip at column ${c} is at row ${first}, the wall's top at ${top(c)}`);
    // Joined to the column before: their inked rows touch or overlap.
    if (before >= 0) assert.ok(first <= before + 1 && last >= beforeFirst - 1, `the lip breaks between columns ${c - 1} and ${c}`);
    before = last;
    beforeFirst = first;
  }
  assert.equal(WALL_SPAN, 5);
});

test("a sea cliff stands on an apron of shingle and boulders, broken by gaps; a shore that is no cliff has none", () => {
  const look = rockLook();
  const count = (w: BakeWorld) => {
    const cells = buildCells(w, look, mask, 0, 150, 512, 100);
    let apron = 0, boulders = 0, gaps = 0;
    for (let x = 0; x < 512; x++) {
      let any = false;
      for (let y = 1; y < 100; y++) {
        const m = cells.mat[y * 512 + x];
        if (m !== M_APRON && m !== M_BOULDER) continue;
        any = true;
        apron++;
        if (m === M_BOULDER) { boulders++; assert.ok(cells.surf[y * 512 + x] >= 1); }
        assert.ok((cells.flags[y * 512 + x] & F_QUIET) !== 0, "the apron takes no ink");
        // Never more than three cells from the cliff's foot.
        let land = false;
        for (let d = 1; d <= 4; d++) if (cells.surf[(y - d) * 512 + x] > 1 || cells.surf[(y - d) * 512 + x - 1] > 1 || cells.surf[(y - d) * 512 + x + 1] > 1) land = true;
        assert.ok(land, `apron at ${x},${y} is out at sea`);
      }
      if (!any) gaps++;
    }
    return { apron, boulders, gaps };
  };
  const cliff = count(cliffWorld(512));
  assert.ok(cliff.apron > 400 && cliff.boulders > 40 && cliff.boulders < cliff.apron / 3, `apron ${cliff.apron}, boulders ${cliff.boulders}`);
  assert.ok(cliff.gaps > 20 && cliff.gaps < 300, `the apron is broken (${cliff.gaps} columns bare)`);
  const beach = cliffWorld(512);
  beach.shore.fill(1);
  assert.equal(count(beach).apron, 0);
});

test("cliff cells and pixels are a pure function of position: any window", () => {
  const w = cliffWorld(512), look = rockLook();
  const small = buildCells(w, look, mask, 100, 170, 64, 48), big = buildCells(w, look, mask, 77, 151, 128, 96);
  for (let y = 0; y < 48; y++) for (let x = 0; x < 64; x++) {
    for (const k of ["surf", "mat", "light", "flags", "aux"] as const) assert.equal(small[k][y * 64 + x], big[k][(y + 19) * 128 + x + 23], `${k} at ${x},${y}`);
  }
  const tiles = tileCache(w, look, mask, 12);
  // Bake rows 110–190 show the plateau's edge, the wall and the sea. Windows of several heights, so their lower
  // edges cut the wall at its lip, across its face and at its foot.
  const b = bakeWindow(w, look, mask, tiles, 61, 99, 160, 110);
  let rock = 0, inked = 0;
  for (const rows of [56, 12, 17, 23, 29, 36]) {
    const a = bakeWindow(w, look, mask, tiles, 96, 120, 64, rows);
    for (let r = 0; r < rows; r++) for (let c = 0; c < 64; c++) {
      // Material and light; depth is counted from each window's own first row.
      assert.equal(a[r * 64 + c] & 0xffff, b[(r + 21) * 160 + c + 35] & 0xffff, `pixel ${c},${r} of a window ${rows} rows tall`);
      if (rows !== 56) continue;
      if ((a[r * 64 + c] & 255) === M_ROCK) rock++;
      if (((a[r * 64 + c] >>> 14) & 3) !== 0) inked++;
    }
  }
  assert.ok(rock > 500 && inked > 40, `the window shows the wall (${rock} rock pixels, ${inked} inked)`);
});

test("a stream takes the shade of the ground it crosses: a water tone, never foam, on open ground", () => {
  // A stream runs south across the plateau, down column 258.
  const w = cliffWorld(512);
  const v: number[] = [];
  for (let gy = 20; gy <= 52; gy++) v.push(258, 4 * gy + 2, 1);
  w.rivers = riverIndex([{ vertices: v, stride: 3 }], w.n);
  const look = rockLook();
  const cells = buildCells(w, look, mask, 256, 100, 4, 110);
  let stream = 0;
  for (let y = 0; y < 90; y++) {
    const i = y * 4 + 2;
    if (cells.mat[i] !== M_RIVER) continue;
    stream++;
    assert.ok(cells.aux[i] >= 8 && cells.aux[i] <= 14, `stream tone ${cells.aux[i]}`);
  }
  assert.ok(stream > 60);
  const px = bakeWindow(w, look, mask, tileCache(w, look, mask, 12), 240, 60, 40, 130);
  let water = 0;
  for (let i = 0; i < px.length; i++) {
    if ((px[i] & 255) !== M_RIVER) continue;
    const tone = (px[i] >>> 8) & 15;
    assert.ok(tone >= 8 && tone <= 14, `stream pixel of tone ${tone}`);
    water++;
  }
  assert.ok(water > 40, `the stream is drawn (${water} pixels)`);
});
