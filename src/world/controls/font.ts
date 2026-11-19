// The guides' pixel font: our own, drawn for the flight page's prompts, key-caps and options panel. Caps and
// ascenders stand 6 px, the x-height is 4 px and descenders drop 2 px, so a glyph box is 8 rows and a line 9. It
// covers printable ASCII (a project's name can hold anything) and the arrows, middle dot and pilcrow the guides use.

/** Rows from the top of a glyph box to the baseline. */
export const CAP = 6;
/** Height of the lowercase body (rows 2–5). */
export const X_HEIGHT = 4;
/** Rows below the baseline. */
export const DESCENT = 2;
/** Rows in a glyph box. */
export const ROWS = CAP + DESCENT;
/** Rows from one line's top to the next one's. */
export const LINE = ROWS + 1;
/** Empty columns between two glyphs. */
export const TRACK = 1;

/**
 * Each glyph as rows of `#` (ink) and `.` (none), separated by `/`, from the top of the box down; `N:` in front starts
 * at row N. Rows not given are empty. Every row of a glyph is as wide as the glyph.
 */
const SOURCE: Record<string, string> = {
  " ": "..",
  A: ".##./#..#/#..#/####/#..#/#..#",
  B: "###./#..#/###./#..#/#..#/###.",
  C: ".###/#.../#.../#.../#.../.###",
  D: "###./#..#/#..#/#..#/#..#/###.",
  E: "####/#.../###./#.../#.../####",
  F: "####/#.../###./#.../#.../#...",
  G: ".###/#.../#.../#.##/#..#/.###",
  H: "#..#/#..#/####/#..#/#..#/#..#",
  I: "###/.#./.#./.#./.#./###",
  J: "...#/...#/...#/...#/#..#/.##.",
  K: "#..#/#.#./##../#.#./#..#/#..#",
  L: "#.../#.../#.../#.../#.../####",
  M: "#...#/##.##/#.#.#/#...#/#...#/#...#",
  N: "#..#/##.#/##.#/#.##/#.##/#..#",
  O: ".###./#...#/#...#/#...#/#...#/.###.",
  P: "###./#..#/#..#/###./#.../#...",
  Q: ".##./#..#/#..#/#..#/#.#./.#.#",
  R: "###./#..#/#..#/###./#.#./#..#",
  S: ".###/#.../.##./...#/...#/###.",
  T: "#####/..#../..#../..#../..#../..#..",
  U: "#..#/#..#/#..#/#..#/#..#/.##.",
  V: "#...#/#...#/#...#/.#.#./.#.#./..#..",
  W: "#...#/#...#/#...#/#.#.#/##.##/#...#",
  X: "#...#/.#.#./..#../..#../.#.#./#...#",
  Y: "#...#/#...#/.#.#./..#../..#../..#..",
  Z: "####/...#/..#./.#../#.../####",
  a: "2:.###/#..#/#..#/.###",
  b: "#.../#.../###./#..#/#..#/###.",
  c: "2:.##/#../#../.##",
  d: "...#/...#/.###/#..#/#..#/.###",
  e: "2:.##./####/#.../.###",
  f: ".##/#../###/#../#../#..",
  g: "2:.###/#..#/#..#/.###/...#/###.",
  h: "#.../#.../###./#..#/#..#/#..#",
  i: "#/./#/#/#/#",
  j: ".#/../.#/.#/.#/.#/.#/#.",
  k: "#../#../#.#/##./#.#/#.#",
  l: "#./#./#./#./#./.#",
  m: "2:####./#.#.#/#.#.#/#.#.#",
  n: "2:###./#..#/#..#/#..#",
  o: "2:.##./#..#/#..#/.##.",
  p: "2:###./#..#/#..#/###./#.../#...",
  q: "2:.###/#..#/#..#/.###/...#/...#",
  r: "2:#.#/##./#../#..",
  s: "2:.###/##../..##/###.",
  t: "1:.#./###/.#./.#./..#",
  u: "2:#..#/#..#/#..#/.###",
  v: "2:#.#/#.#/#.#/.#.",
  w: "2:#...#/#.#.#/#.#.#/.#.#.",
  x: "2:#..#/.##./.##./#..#",
  y: "2:#..#/#..#/#..#/.###/...#/.##.",
  z: "2:####/..#./.#../####",
  "0": ".##./#..#/#.##/##.#/#..#/.##.",
  "1": ".#./##./.#./.#./.#./###",
  "2": ".##./#..#/...#/..#./.#../####",
  "3": "###./...#/.##./...#/...#/###.",
  "4": "..#./.##./#.#./####/..#./..#.",
  "5": "####/#.../###./...#/...#/###.",
  "6": ".##./#.../###./#..#/#..#/.##.",
  "7": "####/...#/..#./.#../.#../.#..",
  "8": ".##./#..#/.##./#..#/#..#/.##.",
  "9": ".##./#..#/#..#/.###/...#/.##.",
  ".": "5:#",
  ",": "5:.#/#.",
  ":": "3:#/./#",
  ";": "3:.#/../.#/#.",
  "'": "#/#",
  '"': "#.#/#.#",
  "`": "#./.#",
  "!": "#/#/#/#/./#",
  "?": ".##./#..#/..#./.#../..../.#..",
  "-": "3:###",
  _: "6:####",
  "+": "2:.#./###/.#.",
  "=": "2:###/.../###",
  "*": "1:#.#/.#./#.#",
  "/": "..#/..#/.#./.#./#../#..",
  "\\": "#../#../.#./.#./..#/..#",
  "|": "#/#/#/#/#/#/#/#",
  "(": ".#/#./#./#./#./.#",
  ")": "#./.#/.#/.#/.#/#.",
  "[": "##/#./#./#./#./##",
  "]": "##/.#/.#/.#/.#/##",
  "{": ".##/.#./#../.#./.#./.##",
  "}": "##./.#./..#/.#./.#./##.",
  "<": "1:..#/.#./#../.#./..#",
  ">": "1:#../.#./..#/.#./#..",
  "^": ".#./#.#",
  "~": "2:.#.#/#.#.",
  "#": ".#.#./#####/.#.#./.#.#./#####/.#.#.",
  "%": "#..#/...#/..#./.#../#.../#..#",
  "&": ".##../#..#./.##../#.#.#/#..#./.##.#",
  "@": ".###./#...#/#.###/#.#.#/#.###/.#...",
  $: ".###/##../.##./..##/###./.#..",
  "←": "1:..#../.#.../#####/.#.../..#..",
  "→": "1:..#../...#./#####/...#./..#..",
  "↑": "1:..#../.###./#.#.#/..#../..#..",
  "↓": "1:..#../..#../#.#.#/.###./..#..",
  "·": "3:#",
  "¶": ".####/###.#/###.#/.##.#/..#.#/..#.#",
  "…": "5:#.#.#",
};

export interface Glyph {
  /** Columns. */
  w: number;
  /** w × ROWS, row-major: 1 where the glyph is inked. */
  ink: Uint8Array;
}

function parse(src: string): Glyph {
  let start = 0;
  let body = src;
  const colon = src.indexOf(":");
  if (colon > 0 && /^\d+$/.test(src.slice(0, colon))) {
    start = Number(src.slice(0, colon));
    body = src.slice(colon + 1);
  }
  const rows = body.split("/");
  const w = rows[0].length;
  const ink = new Uint8Array(w * ROWS);
  rows.forEach((row, i) => {
    for (let x = 0; x < w; x++) if (row[x] === "#") ink[(start + i) * w + x] = 1;
  });
  return { w, ink };
}

const GLYPHS = new Map<string, Glyph>();
for (const [ch, src] of Object.entries(SOURCE)) GLYPHS.set(ch, parse(src));
const FALLBACK = GLYPHS.get("?") as Glyph;

/** The characters the font draws. */
export function characters(): string[] {
  return [...GLYPHS.keys()];
}

/** The glyph for `ch`; a character the font lacks is drawn as `?`. */
export function glyph(ch: string): Glyph {
  return GLYPHS.get(ch) ?? FALLBACK;
}

/** Width of `text` set in the font, columns: glyphs and the tracking between them. */
export function textWidth(text: string): number {
  let w = 0;
  let n = 0;
  for (const ch of text) {
    w += glyph(ch).w;
    n++;
  }
  return n === 0 ? 0 : w + TRACK * (n - 1);
}

/** Calls `dot(x, y)` for every inked pixel of `text` set from (0, 0), the top of its glyph boxes. */
export function eachDot(text: string, dot: (x: number, y: number) => void): void {
  let x0 = 0;
  for (const ch of text) {
    const g = glyph(ch);
    for (let y = 0; y < ROWS; y++) for (let x = 0; x < g.w; x++) if (g.ink[y * g.w + x]) dot(x0 + x, y);
    x0 += g.w + TRACK;
  }
}
