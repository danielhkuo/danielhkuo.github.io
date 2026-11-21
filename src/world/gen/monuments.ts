// The quest's five monuments (spec: 2026-11-19-story-destinations-design.md), built as the landmarks are: rasters of
// heights, materials and light (gen/built.ts Structure), so the bake draws them with the world's own ink, hatching,
// light and shadow. One for each of the owner's interests: slow careful work, reading, faith and made minds, the home
// lab, basketball. No figures larger than life. Each has a place on its south face where the piece the quest collects
// is set; the piece itself is drawn live (live/story.ts) at `PIECE_AT`, so it can be taken.
//
// Local coordinates: x east, y south; row h − 1 is the southmost (see gen/structures.ts).

import { pcos, PI, psin } from "../core/psin.ts";
import { MATERIAL as M } from "../look/materials.ts";
import type { Structure } from "./built.ts";
import { drum, house, mark, paint, put, sculpt, T_EAST, T_FLAT, T_NORTH, T_RIDGE, T_WALL, T_WEST, tower } from "./structures.ts";

export type MonumentKey = "pine" | "desk" | "bell" | "mill" | "basket";

/** Where each monument's piece sits, from its raster's centre: cells east, cells south, and height over its base. */
export const PIECE_AT: Readonly<Record<MonumentKey, { dx: number; dy: number; z: number }>> = {
  pine: { dx: 0, dy: 5, z: 3 },
  desk: { dx: 0, dy: 4, z: 9 },
  bell: { dx: 2, dy: 4, z: 15 },
  mill: { dx: -3, dy: 4, z: 11 },
  basket: { dx: 0, dy: -3, z: 9 },
};

/** Every monument, built fresh. */
export function monument(key: MonumentKey): Structure {
  if (key === "pine") return knotGarden();
  if (key === "desk") return stoneBook();
  if (key === "bell") return clockJack();
  if (key === "mill") return engineHouse();
  return courtPost();
}


/**
 * Slow, careful work: a walled garden whose north wall carries an old pear trained flat against it, its branches in
 * level tiers turned up at the ends like a candelabrum, the work of a hundred springs of pruning (19 × 15, 12 tall).
 * Clipped box edges the beds before it. The piece is set in the pedestal before the gate.
 */
function knotGarden(): Structure {
  const W = 19, H = 15;
  const s = sculpt(W, H);
  for (let y = 5; y < H - 2; y++) s.paint[y * W + 9] = M.path;
  // The north wall: high, coped, its south face the espalier's ground.
  const face = 3;
  for (let x = 2; x < W - 2; x++) { put(s, x, face, 11, M.stone, T_WALL); put(s, x, face - 1, 11.5, M.stoneDark, T_RIDGE); }
  // The tree on the wall's face: an old, leaning trunk and three tiers of branches of uneven reach, each turned up at
  // its ends, clumps of leaves along them, and pears.
  const cx = 9;
  for (let z = 1; z <= 10; z++) mark(s, cx + (z > 7 ? 1 : 0), face, z, M.timber, 96);
  for (const [z, west, east] of [[3, 7, 6], [6, 5, 7], [9, 3, 4]] as const) {
    for (const [side, reach] of [[-1, west], [1, east]] as const) {
      for (let k = 1; k <= reach; k++) {
        mark(s, cx + side * k, face, z, M.timber, 108);
        if ((k + z) % 3 !== 0) mark(s, cx + side * k, face, z + 1, M.coniferMid, 150 - 6 * k);
      }
      mark(s, cx + side * reach, face, z + 1, M.timber, 108);
      mark(s, cx + side * reach, face, z + 2, M.coniferMid, 165);
      mark(s, cx + side * (reach - 1), face, z + 2, M.coniferMid, 140);
    }
  }
  for (const [x, z] of [[5, 4], [14, 7], [3, 4], [11, 4], [8, 7]] as const) mark(s, x, face, z, M.gilt, 135);
  // The beds before the wall, edged in clipped box, a walk down the middle to the gate.
  const hedge = (x: number, y: number): void => { if (s.top[y * W + x] === 0) put(s, x, y, 1.8, M.hedge, 96); };
  for (const [x0, x1] of [[2, 7], [11, 16]] as const) {
    for (let x = x0; x <= x1; x++) { hedge(x, 6); hedge(x, 11); }
    for (let y = 6; y <= 11; y++) { hedge(x0, y); hedge(x1, y); }
    // A clipped ball at each bed's heart.
    put(s, (x0 + x1) >> 1, 8, 2.4, M.hedge, 150);
    put(s, ((x0 + x1) >> 1) + 1, 8, 2.4, M.hedge, 130);
    put(s, (x0 + x1) >> 1, 9, 2.4, M.hedge, 120);
    put(s, ((x0 + x1) >> 1) + 1, 9, 2.4, M.hedge, 110);
  }
  // The gardener's cottage against the wall's east end, its windows lit.
  house(s, 14, 4, 5, 5, 5, 3, { gable: 1, wallMat: M.stone, roofMat: M.roofTile, openings: 1, chimney: true });
  // The pedestal before the gate, where the piece is set.
  put(s, cx, H - 3, 2.4, M.stone, T_WALL);
  mark(s, cx, H - 3, 2, M.opening);
  return s;
}

/**
 * Reading: a small library of stone (15 × 11, 17 tall), its long hall's tall windows lit, its gable to the camera
 * holding a rose window over a porch, and under the porch's pointed arch a lectern with an open book. The piece is the
 * glass at the rose window's heart.
 */
function stoneBook(): Structure {
  const s = sculpt(15, 11);
  // The hall behind, its ridge east to west, tall lancets along its south wall.
  house(s, 1, 0, 13, 6, 8, 5, { gable: 0, wallMat: M.stone, roofMat: M.roofSlate, openings: 0, chimney: false });
  for (const x of [2, 4, 10, 12]) for (let z = 3; z <= 6; z++) mark(s, x, 5, z, z === 6 ? M.opening : M.lantern, 140);
  // The porch: a gabled bay to the camera, a pointed arch in it, and the rose window above.
  house(s, 5, 4, 5, 6, 10, 4, { gable: 1, wallMat: M.stone, roofMat: M.roofSlate, openings: 0, chimney: false });
  const face = 9;
  for (let z = 1; z <= 5; z++) for (let x = 6; x <= 8; x++) if (!(z === 5 && x !== 7)) mark(s, x, face, z, M.opening, 70);
  // The lectern and its open book, within the arch.
  mark(s, 7, face, 2, M.stoneDark, 120);
  mark(s, 6, face, 3, M.plaster, 175);
  mark(s, 7, face, 3, M.stoneDark, 110);
  mark(s, 8, face, 3, M.plaster, 160);
  // The rose window: a ring of stone round coloured light.
  for (const [dx, dz] of [[-1, 0], [1, 0], [0, -1], [0, 1]] as const) mark(s, 7 + dx, face, 9 + dz, M.lantern, 150);
  mark(s, 7, face, 9, M.gilt, 160);
  for (const [dx, dz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as const) mark(s, 7 + dx, face, 9 + dz, M.stoneDark, 100);
  return s;
}

/**
 * Faith and made minds: a clock tower whose hours are struck by two oak jacks either side of the dial (15 × 11, 36
 * tall), with an open bell stage, a spire and a cross, and a small chapel at its foot. The piece is the glass at the
 * dial's heart.
 */
function clockJack(): Structure {
  const s = sculpt(15, 11);
  // The chapel to the west, its gable to the camera.
  house(s, 1, 3, 5, 7, 7, 4, { gable: 1, wallMat: M.stone, roofMat: M.roofLead, openings: 0, chimney: false });
  for (let z = 2; z <= 5; z++) mark(s, 3, 9, z, M.opening);
  // The tower.
  tower(s, 6, 1, 7, 9, 27, 9, M.stone, M.roofLead, true);
  const face = 9;
  // A string course under the bell stage, the stage's two open arches with the bell between, and a course above.
  for (let x = 6; x <= 12; x++) { mark(s, x, face, 19, M.stoneDark, 104); mark(s, x, face, 26, M.stoneDark, 104); }
  for (const x of [7, 11]) for (let z = 21; z <= 25; z++) mark(s, x, face, z, M.opening);
  for (const x of [8, 9, 10]) for (let z = 21; z <= 24; z++) mark(s, x, face, z, M.opening);
  mark(s, 9, face, 23, M.gilt, 160);
  mark(s, 8, face, 22, M.gilt, 140);
  mark(s, 9, face, 22, M.gilt, 150);
  mark(s, 10, face, 22, M.gilt, 130);
  // The dial: a ring of gilt round a pale face, five across.
  for (let z = 13; z <= 17; z++) for (let x = 7; x <= 11; x++) {
    const ring = x === 7 || x === 11 || z === 13 || z === 17;
    const corner = (x === 7 || x === 11) && (z === 13 || z === 17);
    if (corner) continue;
    mark(s, x, face, z, ring ? M.gilt : M.dial, ring ? 150 : 165);
  }
  // The two jacks, oak, each on a bracket either side of the dial, hammers raised.
  for (const x of [6, 12]) {
    mark(s, x, face + 1, 13, M.stoneDark, 100);
    mark(s, x, face + 1, 14, M.timber, 120);
    mark(s, x, face + 1, 15, M.timber, 120);
    mark(s, x, face + 1, 16, M.timber, 140);
  }
  mark(s, 5, face + 1, 16, M.timber, 110);
  mark(s, 13, face + 1, 16, M.timber, 110);
  // The door.
  for (let z = 1; z <= 3; z++) mark(s, 9, face, z, M.timber, 92);
  return s;
}

/**
 * The home lab: an engine house of stone (15 × 12, 30 tall) with its gable to the camera, a tall round chimney, a
 * water wheel turning in a race on its east side, and a lattice mast for the wires. Its windows are lit. The piece is
 * the lamp in the gable window.
 */
function engineHouse(): Structure {
  const s = sculpt(15, 12);
  // The race: a channel of water along the front, east of the door, the wheel turning in it.
  for (let x = 9; x <= 14; x++) { put(s, x, 11, 0.5, M.stoneDark, T_WALL); put(s, x, 8, 1.2, M.stoneDark, T_FLAT); }
  for (let y = 9; y <= 10; y++) for (let x = 9; x <= 14; x++) put(s, x, y, 0.15, M.river, T_FLAT);
  // The engine house.
  house(s, 1, 3, 8, 8, 9, 5, { gable: 1, wallMat: M.stone, roofMat: M.roofSlate, openings: 0, chimney: false });
  const face = 10;
  // Tall round-headed windows, lit, and the gable's round window.
  for (const x of [2, 7]) for (let z = 3; z <= 7; z++) mark(s, x, face, z, z === 7 ? M.opening : M.lantern, 150);
  for (let z = 1; z <= 3; z++) { mark(s, 4, face, z, M.timber, 92); mark(s, 5, face, z, M.timber, 92); }
  mark(s, 4, face, 11, M.opening);
  mark(s, 5, face, 11, M.opening);
  // The chimney at the north-west corner, banded in brick.
  drum(s, 2, 2, 1.8, 19, M.brick);
  for (const z of [8, 13, 18]) for (let x = 1; x <= 3; x++) mark(s, x, 3, z, M.stoneDark, 110);
  // The water wheel, broadside to the camera at the house's south-east corner: a rim of timber, spokes and a hub.
  const hub = 5, wx = 12, wy = 10;
  for (let a = 0; a < 24; a++) {
    const t = (a / 24) * 2 * PI;
    mark(s, Math.round(wx + 2.4 * pcos(t)), wy, Math.round(hub + 3.4 * psin(t)), M.timber, 118);
  }
  for (let z = hub - 3; z <= hub + 3; z++) mark(s, wx, wy, z, M.timber, 92);
  for (let x = wx - 2; x <= wx + 2; x++) mark(s, x, wy, hub, M.timber, 92);
  mark(s, wx, wy, hub, M.stoneDark, 80);
  return s;
}

/**
 * Basketball: a walled court of new pale paving with its lines painted, and at its north end a stone post carrying
 * a backboard and a ring (18 × 14, 16 tall). Stone benches along its sides. The piece is the ball resting in the ring.
 */
function courtPost(): Structure {
  const s = sculpt(18, 14);
  // The court: paving, and the low wall round it with a gap in the south side.
  paint(s, 0, 0, 18, 14, M.earthRed);
  // The lines: the half-court circle and the key, in white paint on the paving.
  for (const [y0, y1, yl] of [[3, 5, 5], [8, 10, 8]] as const) {
    for (let y = y0; y <= y1; y++) { s.paint[y * 18 + 6] = M.plaster; s.paint[y * 18 + 11] = M.plaster; }
    for (let x = 6; x <= 11; x++) s.paint[yl * 18 + x] = M.plaster;
  }
  for (let y = 1; y <= 12; y++) s.paint[y * 18 + 1] = M.plaster;
  for (let a = 0; a < 20; a++) {
    const t = (a / 20) * PI;
    const x = Math.round(8.5 + 2.6 * pcos(t)), y = Math.round(6.5 + 1.4 * psin(t) - 0.0);
    s.paint[y * 18 + x] = M.plaster;
  }
  for (let x = 1; x <= 16; x++) s.paint[12 * 18 + x] = M.plaster;
  // Benches along the east and west walls.
  for (let y = 4; y <= 9; y++) { put(s, 1, y, 1.8, M.stone, T_FLAT); put(s, 16, y, 1.8, M.stone, T_FLAT); }
  // The stand along the north side: a long low roof on posts.
  // Tiered stone seats along the north side, stepping up away from the court.
  for (let x = 0; x < 18; x++) { put(s, x, 2, 1.5, M.stone, T_WALL); put(s, x, 1, 3, M.stone, T_WALL); put(s, x, 0, 4.5, M.stoneDark, T_WALL); }
  // The post at the court's north end, the ring on its face, a net below.
  for (let x = 8; x <= 9; x++) put(s, x, 3, 12, M.stoneDark, x === 8 ? T_WEST : T_EAST);
  for (let z = 9; z <= 12; z++) for (let x = 7; x <= 10; x++) if (z === 12 || x === 7 || x === 10) mark(s, x, 3, z, M.plaster, 160);
  for (let x = 7; x <= 10; x++) mark(s, x, 4, 9, M.brick, 160);
  for (const x of [7, 10]) mark(s, x, 4, 8, M.plaster, 150);
  for (const x of [8, 9]) mark(s, x, 4, 7, M.plaster, 150);
  void T_NORTH; void T_RIDGE;
  return s;
}
