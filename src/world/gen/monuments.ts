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
  basket: { dx: 0, dy: -3, z: 7 },
};

/**
 * The projects hall's rose window, on its south gable: its heart from the raster's centre (cells east, cells south,
 * height over its base), and the five lights round it in the order the quest's count fills them, top first and then
 * clockwise as seen: each a petal of two cells (cells east, units up). The baked window is dark; the live layer glazes a light as its pane is found.
 */
export const HALL_ROSE = { dx: 0, dy: -1, z: 10 } as const;
export const ROSE_R = 4;
/**
 * Each light's cells: five lobes about a gilt boss, the first at the top and the rest clockwise as seen, as the HUD's
 * rose has them, mirrored about the upright; the stone between them is the tracery.
 */
export const ROSE_LIGHTS: readonly { dx: number; dz: number }[][] = [
  [{ dx: -1, dz: 2 }, { dx: 0, dz: 2 }, { dx: 1, dz: 2 }, { dx: 0, dz: 3 }],
  [{ dx: 2, dz: 0 }, { dx: 3, dz: 0 }, { dx: 2, dz: 1 }, { dx: 3, dz: 1 }],
  [{ dx: 1, dz: -3 }, { dx: 2, dz: -3 }, { dx: 1, dz: -2 }, { dx: 2, dz: -2 }],
  [{ dx: -2, dz: -3 }, { dx: -1, dz: -3 }, { dx: -2, dz: -2 }, { dx: -1, dz: -2 }],
  [{ dx: -3, dz: 0 }, { dx: -2, dz: 0 }, { dx: -3, dz: 1 }, { dx: -2, dz: 1 }],
];
/** The paved yard before the hall, where the window's light falls once it is whole: its centre and half-sizes, cells. */
export const HALL_YARD = { dx: 0, dy: 5, rx: 6, ry: 5 } as const;

/**
 * The projects hall (15 × 22, 14 tall): a long hall of stone under a tile roof, its gable to the camera with a wide
 * door and, over it, a rose window of five lights; before it an open paved yard, where the window's light
 * falls.
 */
export function projectsHall(): Structure {
  const W = 15, H = 22;
  const s = sculpt(W, H);
  const cx = 7, cy = 11;
  // The yard: open paving, where the window's light falls; no wall, so it is ground, not part of the hall.
  paint(s, 0, 11, W, H - 11, M.path);
  // The hall, buttressed down its sides.
  house(s, 1, 0, 13, 11, 8, 6, { gable: 1, wallMat: M.stone, roofMat: M.roofTile, openings: 0, chimney: false });
  for (const y of [2, 5, 8]) { put(s, 0, y, 5, M.stoneDark, T_WEST); put(s, W - 1, y, 5, M.stoneDark, T_EAST); }
  const face = 10;
  // The door: wide, red, under a pointed head.
  for (let z = 1; z <= 4; z++) for (let x = cx - 1; x <= cx + 1; x++) if (!(z === 4 && x !== cx)) mark(s, x, face, z, M.brick, 110);
  // Narrow slits either side of the door, unglazed stone in shadow: the rose is the window that matters.
  for (const x of [cx - 4, cx + 4]) for (let z = 2; z <= 4; z++) mark(s, x, face, z, M.stoneDark, 80);
  // The rose window: a ring of dark stone, tracery within, a gilt boss, five dark lights.
  const rz = HALL_ROSE.z, rx = cx + HALL_ROSE.dx;
  for (let dz = -ROSE_R; dz <= ROSE_R; dz++) for (let dx = -ROSE_R; dx <= ROSE_R; dx++) {
    const d = Math.sqrt(dx * dx + dz * dz);
    if (d > ROSE_R + 0.45) continue;
    // A dark ring; pale stone tracery within it, so the lights read as glass set in stone.
    if (d > ROSE_R - 0.55) mark(s, rx + dx, face, rz + dz, M.stoneDark, 50);
    else mark(s, rx + dx, face, rz + dz, M.stone, 175);
  }
  mark(s, rx, face, rz, M.gilt, 150);
  // Unglazed, the lights are dark stone, never lit at night: the panes, drawn live, are the window's only colour.
  for (const petal of ROSE_LIGHTS) for (const l of petal) mark(s, rx + l.dx, face, rz + l.dz, M.stoneDark, 50);
  void cy;
  return s;
}

/** Every monument, built fresh. */
export function monument(key: MonumentKey): Structure {
  if (key === "pine") return knotGarden();
  if (key === "desk") return stoneBook();
  if (key === "bell") return clockJack();
  if (key === "mill") return engineHouse();
  return courtPost();
}


/**
 * Slow, careful work: a kitchen garden walled in warm brick on three sides, whose north wall carries an old pear
 * trained flat against it, its branches in level tiers turned up at the ends, the work of a hundred springs of pruning
 * (19 × 15, 9 tall at the wall). Dug beds edged in clipped box before it, a walk down the middle to a gap in the low south wall,
 * and the gardener's bothy against the east wall. The piece is set in the pedestal at the walk's head.
 */
function knotGarden(): Structure {
  const W = 19, H = 15;
  const s = sculpt(W, H);
  // The beds: grass and greens, a walk down the middle.
  paint(s, 1, 4, W - 2, H - 5, M.ley);
  for (let y = 4; y < H - 1; y++) s.paint[y * W + 9] = M.path;
  // The walls: high on the north, where the fruit is trained; lower east and west; a low wall on the south with a gap.
  const face = 3;
  for (let x = 0; x < W; x++) { put(s, x, face, 9, M.brick, T_WALL); put(s, x, face - 1, 9.5, M.stoneDark, T_RIDGE); }
  for (let y = face + 1; y < H; y++) {
    put(s, 0, y, 5.5, M.brick, T_WEST);
    put(s, W - 1, y, 5.5, M.brick, T_EAST);
  }
  for (let x = 1; x < W - 1; x++) if (Math.abs(x - 9) > 1) put(s, x, H - 1, 3, M.brick, T_WALL);
  // The tree on the wall's face: an old trunk and three tiers of branches of uneven reach, each turned up at its ends,
  // clumps of leaves along them, and pears.
  const cx = 9;
  for (let z = 1; z <= 6; z++) mark(s, cx, face, z, M.timber, 96);
  for (const [z, west, east] of [[2, 6, 5], [4, 5, 6], [6, 3, 4]] as const) {
    for (const [side, reach] of [[-1, west], [1, east]] as const) {
      for (let k = 1; k <= reach; k++) {
        mark(s, cx + side * k, face, z, M.timber, 108);
        if ((k + z) % 3 !== 0) mark(s, cx + side * k, face, z + 1, M.coniferMid, 150 - 6 * k);
      }
      mark(s, cx + side * reach, face, z + 1, M.coniferMid, 165);
    }
  }
  for (const [x, z] of [[5, 3], [13, 5], [4, 5], [11, 3], [8, 5]] as const) mark(s, x, face, z, M.gilt, 135);
  // The beds edged in clipped box, a pear tree in each.
  const hedge = (x: number, y: number): void => { if (s.top[y * W + x] === 0) put(s, x, y, 1.2, M.hedge, 96); };
  for (const [x0, x1] of [[2, 7], [11, 16]] as const) {
    for (let x = x0; x <= x1; x++) { hedge(x, 5); hedge(x, 11); }
    for (let y = 5; y <= 11; y++) { hedge(x0, y); hedge(x1, y); }
    // A pear in the bed's heart, a domed crown as an orchard's trees are.
    const tx = ((x0 + x1) >> 1) + 0.5, ty = 8.5, r = 2.3;
    for (let y = 6; y <= 11; y++) for (let x = x0 + 1; x < x1; x++) {
      const d2 = (x - tx) * (x - tx) + (y - ty) * (y - ty);
      if (d2 <= r * r) put(s, x, y, 2.5 + 3 * Math.sqrt(1 - d2 / (r * r)), M.broadleafMid, 0);
    }
  }
  // The gardener's bothy in the north-east corner, its lean-to roof against the wall.
  house(s, 13, 4, 5, 4, 4, 2, { gable: 1, wallMat: M.brick, roofMat: M.roofTile, openings: 1, chimney: true });
  // The pedestal at the walk's head, where the piece is set.
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
  house(s, 1, 0, 13, 6, 8, 5, { gable: 0, wallMat: M.stone, roofMat: M.roofTile, openings: 0, chimney: false });
  for (const x of [2, 4, 10, 12]) for (let z = 3; z <= 6; z++) mark(s, x, 5, z, z === 6 ? M.opening : M.lantern, 140);
  // The porch: a gabled bay to the camera, a pointed arch in it, and the rose window above.
  house(s, 5, 4, 5, 6, 10, 4, { gable: 1, wallMat: M.stone, roofMat: M.roofTile, openings: 0, chimney: false });
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
 * The home lab: an engine house of stone (15 × 12, 15 tall) with its gable to the camera, a round chimney a little
 * over its ridge, and a water wheel turning in a race on its east side. Its windows are lit. The piece is
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
  drum(s, 2, 2, 1.8, 15, M.brick);
  for (const z of [8, 12]) for (let x = 1; x <= 3; x++) mark(s, x, 3, z, M.stoneDark, 110);
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
  // Benches along the east and west sides.
  for (let y = 4; y <= 9; y++) { put(s, 1, y, 1.2, M.stone, T_FLAT); put(s, 16, y, 1.2, M.stone, T_FLAT); }
  // A stand along the north side: a long low roof of tile over the benches, open to the court.
  house(s, 0, 0, 18, 3, 3.5, 2, { gable: 0, wallMat: M.stone, roofMat: M.roofTile, openings: 0, chimney: false });
  // The post at the court's north end, no taller than the board it carries; the board, solid white with the ring's
  // square on it; the ring and its net hanging before it.
  for (let x = 8; x <= 9; x++) put(s, x, 3, 7, M.stoneDark, x === 8 ? T_WEST : T_EAST);
  for (let z = 7; z <= 10; z++) for (let x = 6; x <= 11; x++) {
    const edge = z === 10 || z === 7 || x === 6 || x === 11;
    mark(s, x, 3, z, edge ? M.stoneDark : M.plaster, edge ? 110 : 170);
  }
  for (let x = 7; x <= 10; x++) mark(s, x, 4, 7, M.stoneDark, 120);
  for (const x of [7, 10]) mark(s, x, 4, 6, M.plaster, 150);
  for (const x of [8, 9]) mark(s, x, 4, 5, M.plaster, 150);
  void T_NORTH; void T_RIDGE;
  return s;
}
