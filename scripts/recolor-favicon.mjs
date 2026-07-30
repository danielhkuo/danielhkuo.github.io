/**
 * Recolour the 郭 favicon set onto the Atom One Dark palette.
 *
 * The source art is three regions: a near-white square, a rounded warm-cream
 * tile with paper grain, and the navy glyph. Rather than redraw the mark (which
 * would need the original CJK face), each pixel is classified and remapped, so
 * the glyph outline, its antialiasing, the tile radius and the grain all carry
 * over untouched.
 *
 * Every output is recoloured from the same-size source rather than downscaled
 * from the 512 — the 16px art has its own hinting that a resample would mush.
 *
 * Sources are the untouched cream originals in assets/favicon-src/, NOT the
 * files in public/ — this has to stay re-runnable, and feeding it its own
 * output would leave no warm pixels for the tile anchor to find.
 *
 * Classification per pixel:
 *   t     — glyph coverage, from luminance between the tile and glyph anchors.
 *   warm  — r-b. The cream tile sits ~21 apart, the outer white ~0. Only needed
 *           where t≈0: white and cream are too close in luminance to separate
 *           on brightness alone. Anchors are measured per file, since heavier
 *           antialiasing at 16px compresses the range.
 *
 * Usage: node scripts/recolor-favicon.mjs [outer tile glyph]
 */
import sharp from "sharp";
import { writeFile } from "node:fs/promises";

// Atom One Dark: --bg for both the tile and the region outside it, and the One
// blue for the glyph. Outer == tile flattens the source art's rounded-rect into
// a full-bleed square, matching the site's squared-off corners.
const DEFAULTS = ["#282c34", "#282c34", "#61afef"];

const SRC_DIR = "assets/favicon-src";
const NAMES = [
  "favicon-16x16.png",
  "favicon-32x32.png",
  "apple-touch-icon.png",
  "android-chrome-192x192.png",
  "android-chrome-512x512.png",
];

const WARM_CUTOFF = 8;

const hex = (h) => {
  const n = parseInt(h.replace("#", ""), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
const lum = (r, g, b) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
const mix = (a, b, t) => a.map((v, i) => Math.round(v + (b[i] - v) * t));
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/** Tile luminance = modal value among warm pixels; glyph = 1st percentile. */
function anchors(data, channels) {
  const warm = [];
  const all = [];
  for (let i = 0; i < data.length; i += channels) {
    const l = lum(data[i], data[i + 1], data[i + 2]);
    all.push(l);
    if (data[i] - data[i + 2] > WARM_CUTOFF) warm.push(l);
  }
  all.sort((a, b) => a - b);
  const tile = warm.length
    ? warm.sort((a, b) => a - b)[Math.floor(warm.length * 0.6)]
    : all[Math.floor(all.length * 0.9)];
  const glyph = all[Math.floor(all.length * 0.01)];
  return { tile, glyph: Math.min(glyph, tile - 20) };
}

async function recolorFile(src, dest, outerHex, tileHex, glyphHex) {
  const outer = hex(outerHex);
  const tileC = hex(tileHex);
  const glyphC = hex(glyphHex);

  const { data, info } = await sharp(src)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const { tile: L_TILE, glyph: L_GLYPH } = anchors(data, info.channels);

  const px = Buffer.alloc(data.length);
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i], g = data[i + 1], b = data[i + 2];
    const l = lum(r, g, b);
    const t = clamp((L_TILE - l) / (L_TILE - L_GLYPH), 0, 1);

    // Grain lives in the cream; carry it as a proportional lightness wobble so
    // the new tile keeps its texture instead of going flat.
    const grain = (l - L_TILE) / 255;

    const base =
      t < 0.04 && r - b < WARM_CUTOFF
        ? outer // outside the rounded tile
        : tileC.map((v) => clamp(Math.round(v + grain * 255 * 0.6), 0, 255));

    const [nr, ng, nb] = mix(base, glyphC, t);
    px[i] = nr;
    px[i + 1] = ng;
    px[i + 2] = nb;
    px[i + 3] = data[i + 3];
  }

  await sharp(px, { raw: { width: info.width, height: info.height, channels: 4 } })
    .png({ compressionLevel: 9 })
    .toFile(dest);
  return dest;
}

/** Multi-size .ico with PNG-compressed entries (universally supported today). */
async function buildIco(pngBuffers, dest) {
  const count = pngBuffers.length;
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(count, 4);

  const entries = Buffer.alloc(16 * count);
  let offset = 6 + 16 * count;
  pngBuffers.forEach(({ size, buf }, i) => {
    const e = 16 * i;
    entries.writeUInt8(size >= 256 ? 0 : size, e + 0); // width
    entries.writeUInt8(size >= 256 ? 0 : size, e + 1); // height
    entries.writeUInt8(0, e + 2); // palette
    entries.writeUInt8(0, e + 3); // reserved
    entries.writeUInt16LE(1, e + 4); // colour planes
    entries.writeUInt16LE(32, e + 6); // bits per pixel
    entries.writeUInt32LE(buf.length, e + 8);
    entries.writeUInt32LE(offset, e + 12);
    offset += buf.length;
  });

  await writeFile(dest, Buffer.concat([header, entries, ...pngBuffers.map((p) => p.buf)]));
}

const [outer, tile, glyph] = process.argv.slice(2).length === 3
  ? process.argv.slice(2)
  : DEFAULTS;

for (const name of NAMES) {
  await recolorFile(`${SRC_DIR}/${name}`, `public/${name}`, outer, tile, glyph);
  console.log("recoloured public/" + name);
}

// .ico carries 16/32/48. 48 is resampled from the 180 (nearest in scale).
const ico = [
  { size: 16, buf: await sharp("public/favicon-16x16.png").png().toBuffer() },
  { size: 32, buf: await sharp("public/favicon-32x32.png").png().toBuffer() },
  {
    size: 48,
    buf: await sharp("public/apple-touch-icon.png")
      .resize(48, 48, { kernel: "lanczos3" })
      .png()
      .toBuffer(),
  },
];
await buildIco(ico, "public/favicon.ico");
console.log("wrote public/favicon.ico (16/32/48)");
