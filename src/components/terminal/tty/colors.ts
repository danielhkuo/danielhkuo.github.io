/**
 * xterm 256-colour indices, as cbonsai's `-k` option takes them.
 * 0–15 are the terminal's own palette and resolve to `--ansi-N` CSS variables
 * (defined per theme on `.term-win`); 16–231 are the 6×6×6 cube and 232–255
 * the grey ramp, both fixed by the xterm spec.
 */

/** cbonsai defaults: dark leaves, dark wood, light leaves, light wood. */
export const DEFAULT_COLORS: readonly [number, number, number, number] = [2, 3, 10, 11];

/** COLOR_TEXT — the base pot and message border — on a 256-colour terminal. */
export const TEXT_COLOR = 8;

const CUBE = [0, 95, 135, 175, 215, 255];

function hex2(n: number): string {
  return n.toString(16).padStart(2, "0");
}

export function xtermToCss(index: number): string {
  if (index < 16) return `var(--ansi-${index})`;
  if (index < 232) {
    const i = index - 16;
    const r = CUBE[Math.floor(i / 36)];
    const g = CUBE[Math.floor(i / 6) % 6];
    const b = CUBE[i % 6];
    return `#${hex2(r)}${hex2(g)}${hex2(b)}`;
  }
  const v = 8 + 10 * (index - 232);
  return `#${hex2(v)}${hex2(v)}${hex2(v)}`;
}
