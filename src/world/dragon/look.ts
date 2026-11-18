// The dragon's colours. Vermilion and gold are reserved for it (and landmarks), so it stands out over any land.

/** Packs r, g, b (0–255) as the frame's RGBA word. */
export function rgb(r: number, g: number, b: number): number {
  return (0xff000000 | (b << 16) | (g << 8) | r) >>> 0;
}

/** One colouring of a study. */
export interface Look {
  /** The body: its lit top, its sides, and its shaded underside. */
  bodyLight: number;
  body: number;
  bodyDark: number;
  /** Scale edges and bands. */
  scale: number;
  belly: number;
  bellyDark: number;
  /** Mane, horns, fins, claws and wing ribs. */
  mane: number;
  maneLight: number;
  maneDark: number;
  /** Whisker tips, horn tips, eyes. */
  tip: number;
  /** Wing membrane. */
  wing: number;
  wingDark: number;
  ink: number;
}

export const INK = rgb(40, 34, 29);

/** Vermilion lacquer with a gold belly and mane, cream tips. */
export const LACQUER: Look = {
  bodyLight: rgb(233, 96, 60),
  body: rgb(207, 63, 43),
  bodyDark: rgb(160, 40, 36),
  scale: rgb(118, 28, 30),
  belly: rgb(232, 180, 64),
  bellyDark: rgb(184, 128, 40),
  mane: rgb(238, 190, 70),
  maneLight: rgb(250, 222, 128),
  maneDark: rgb(190, 132, 40),
  tip: rgb(250, 240, 214),
  wing: rgb(226, 120, 52),
  wingDark: rgb(176, 70, 40),
  ink: INK,
};

/** Ivory with a vermilion mane, a gold belly and gold scale edges. */
export const IVORY: Look = {
  bodyLight: rgb(252, 246, 228),
  body: rgb(238, 226, 198),
  bodyDark: rgb(204, 186, 152),
  scale: rgb(196, 142, 52),
  belly: rgb(232, 180, 64),
  bellyDark: rgb(184, 128, 40),
  mane: rgb(207, 63, 43),
  maneLight: rgb(233, 96, 60),
  maneDark: rgb(160, 40, 36),
  tip: rgb(238, 190, 70),
  wing: rgb(226, 120, 52),
  wingDark: rgb(176, 70, 40),
  ink: INK,
};
