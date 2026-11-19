import assert from "node:assert/strict";
import { test } from "node:test";
import { LIGHT_INK_SHIFT, LIGHT_SHADOW_SHIFT, type Palette, type PaletteOptions } from "../look/contract.ts";
import { isVegetation, isWater, MATERIAL as M, MATERIAL_COUNT, MATERIAL_NAMES } from "../look/materials.ts";
import { PHASES } from "../sky/clock.ts";
import {
  buildPalette, darkness, DAY_KEYS, FLAT_TONE, gradeRgb, lstar, MIDDAY, oklabOf, paperIn, RESERVED, RESERVED_SECTOR, RIVER_GUARD_TONE,
  RIVER_MARGIN, snowCover, STREAM_TONE, STREAM_TONES, TERRAIN_CHROMA_CAP,
} from "./palette.ts";

const NOON: PaletteOptions = { time: 0.5, season: 0.25, overcast: 0 };

const TIMES = [0, 0.1, 0.19, 0.215, 0.25, 0.29, 0.33, 0.5, 0.7, 0.75, 0.78, 0.8, 0.86, 0.95];
const SEASONS = [0, 0.125, 0.25, 0.375, 0.5, 0.625, 0.75, 0.875];
const SKIES = [0, 0.5, 1];

/** Every palette the site can show, on a grid. */
function everyPalette(f: (pal: Palette, o: PaletteOptions, label: string) => void): void {
  for (const time of TIMES) {
    for (const season of SEASONS) {
      for (const overcast of SKIES) {
        const o = { time, season, overcast };
        f(buildPalette(o), o, `time ${time} season ${season} overcast ${overcast}`);
      }
    }
  }
}

function at(pal: Palette, mat: number, tone: number, shadow = 0, ink = 0): number {
  return pal[(mat << 8) | tone | (shadow << LIGHT_SHADOW_SHIFT) | (ink << LIGHT_INK_SHIFT)];
}

function lch(rgba: number): [number, number, number] {
  const [L, a, b] = oklabOf(rgba);
  let h = (Math.atan2(b, a) * 180) / Math.PI;
  if (h < 0) h += 360;
  return [L, Math.sqrt(a * a + b * b), h];
}

function reservedLab(c: readonly [number, number, number]): [number, number, number] {
  return [c[0], c[1] * Math.cos((c[2] * Math.PI) / 180), c[1] * Math.sin((c[2] * Math.PI) / 180)];
}

const LAND = [...Array(MATERIAL_COUNT).keys()].filter((m) => m !== M.none && isWater[m] === 0);

test("the table covers every material and light byte, opaque", () => {
  const pal = buildPalette(NOON);
  assert.equal(pal.length, 65536);
  for (let i = 0; i < pal.length; i++) assert.equal(pal[i] >>> 24, 255);
  assert.deepEqual(buildPalette(NOON), pal);
  assert.deepEqual(buildPalette({ ...NOON, time: 1.5 }), pal, "time wraps");
  assert.deepEqual(buildPalette({ ...NOON, season: 1.25 }), pal, "the year wraps");
  assert.deepEqual(buildPalette({ time: 0, season: 0, overcast: 0 }), buildPalette({ time: 1, season: 1, overcast: 0 }));
});

test("rivers are at least 15 L* lighter than any vegetation they cross, in every palette", () => {
  let tightest = Infinity;
  everyPalette((pal, o, label) => {
    for (let shadow = 0; shadow < 4; shadow++) {
      // The flow tones and the foam; a 1 px stream (tones 8–13) is a dark line and has its own test.
      let river = Infinity;
      for (let tone = 0; tone < 16; tone++) {
        if (tone < STREAM_TONE || tone >= STREAM_TONE + STREAM_TONES) river = Math.min(river, lstar(at(pal, M.river, tone, shadow)));
      }
      for (let mat = 0; mat < MATERIAL_COUNT; mat++) {
        if (isVegetation[mat] === 0 || snowCover(mat, o.season) > 0.25) continue;
        for (let tone = 0; tone <= RIVER_GUARD_TONE; tone++) {
          const veg = lstar(at(pal, mat, tone, shadow));
          tightest = Math.min(tightest, river - veg);
          assert.ok(
            river >= veg + RIVER_MARGIN,
            `${label}: river ${river.toFixed(1)} against ${MATERIAL_NAMES[mat]} ${veg.toFixed(1)} (tone ${tone}, shadow ${shadow})`,
          );
        }
      }
    }
  });
  assert.equal(RIVER_MARGIN, 15);
  assert.ok(RIVER_GUARD_TONE >= FLAT_TONE - 3);
  assert.ok(tightest < 25, "the guard should bind somewhere, or the river is washed out for nothing");
});

test("a stream is a dark line of water: under the river, never near white, lighter where the ground it crosses is lit", () => {
  everyPalette((pal, _o, label) => {
    let flow = Infinity;
    for (let tone = 0; tone < STREAM_TONE; tone++) flow = Math.min(flow, lstar(at(pal, M.river, tone)));
    for (let tone = STREAM_TONE; tone < STREAM_TONE + STREAM_TONES; tone++) {
      const L = lstar(at(pal, M.river, tone));
      assert.ok(L < flow - 4, `${label}: stream tone ${tone} (${L.toFixed(1)}) is not under the river (${flow.toFixed(1)})`);
      if (tone > STREAM_TONE) assert.ok(L >= lstar(at(pal, M.river, tone - 1)), `${label}: stream tone ${tone} is darker than the one before`);
    }
  });
  const pal = buildPalette(NOON);
  const dark = lch(at(pal, M.river, STREAM_TONE)), light = lch(at(pal, M.river, STREAM_TONE + STREAM_TONES - 1));
  assert.ok(dark[0] > 0.4 && light[0] < 0.76 && light[0] - dark[0] > 0.15, `stream runs ${dark[0]} to ${light[0]}`);
  // Under the flat tone of every open ground a stream crosses when both are in the same light: tone 8 + k is drawn on ground of about tone 2.4k + 3.
  for (const mat of [M.meadowMid, M.pastureMid, M.moorMid, M.alpineMid, M.scree]) {
    assert.ok(lch(at(pal, M.river, STREAM_TONE + 2))[0] < lch(at(pal, mat, FLAT_TONE))[0] - 0.05, `stream on ${MATERIAL_NAMES[mat]}`);
  }
});

test("the river stays water-coloured: blue, and not blown out to white by day", () => {
  for (const season of SEASONS) {
    const pal = buildPalette({ time: 0.5, season, overcast: 0 });
    // Tone 15 is the foam of a fall, which is white.
    for (let tone = 0; tone < 15; tone++) {
      const [L, C, h] = lch(at(pal, M.river, tone));
      assert.ok(h > 190 && h < 260, `season ${season}: river hue ${h}`);
      assert.ok(C > 0.012, `season ${season}: river chroma ${C}`);
      assert.ok(L < 0.985);
    }
  }
});

test("only snow-covered ground is exempt from the river rule", () => {
  for (let mat = 0; mat < MATERIAL_COUNT; mat++) {
    for (const season of SEASONS) {
      const snowy = mat === M.snow || mat === M.snowLate || (mat >= M.alpineCool && mat <= M.alpineWarm);
      if (!snowy) assert.equal(snowCover(mat, season), 0, MATERIAL_NAMES[mat]);
    }
  }
  assert.equal(snowCover(M.snow, 0.25), 1);
  assert.equal(snowCover(M.snowLate, 0.25), 0);
  assert.equal(snowCover(M.snowLate, 0.75), 1);
  assert.equal(snowCover(M.alpineMid, 0.25), 0);
  assert.equal(snowCover(M.alpineMid, 0.75), 1);
});

test("ink darkens: soft about 50 %, full about 85 %, toward a warm sepia-black", () => {
  everyPalette((pal, o, label) => {
    for (const mat of [...LAND, M.sea, M.lake, M.river]) {
      for (let tone = 0; tone < 16; tone += 3) {
        const plain = oklabOf(at(pal, mat, tone));
        const soft = oklabOf(at(pal, mat, tone, 0, 1));
        const full = oklabOf(at(pal, mat, tone, 0, 2));
        const solid = oklabOf(at(pal, mat, tone, 0, 3));
        // By day everything is lighter than ink; at night the darkest shade may already be as dark.
        if (plain[0] > solid[0] + 0.05) {
          assert.ok(soft[0] < plain[0] && full[0] < soft[0] && solid[0] <= full[0], `${label}: ${MATERIAL_NAMES[mat]} tone ${tone}`);
        }
      }
    }
  });
  const pal = buildPalette(NOON);
  const dist = (p: number[], q: number[]): number => Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
  for (const mat of LAND) {
    const plain = oklabOf(at(pal, mat, FLAT_TONE));
    const ink = oklabOf(at(pal, mat, FLAT_TONE, 0, 3));
    const whole = dist(plain, ink);
    assert.ok(Math.abs(dist(plain, oklabOf(at(pal, mat, FLAT_TONE, 0, 1))) / whole - 0.5) < 0.04, MATERIAL_NAMES[mat]);
    assert.ok(Math.abs(dist(plain, oklabOf(at(pal, mat, FLAT_TONE, 0, 2))) / whole - 0.85) < 0.04, MATERIAL_NAMES[mat]);
  }
  // The ink itself: dark, warm, barely coloured.
  const [L, C, h] = lch(at(pal, M.meadowMid, FLAT_TONE, 0, 3));
  assert.ok(L < 0.3 && C < 0.05 && h > 30 && h < 90, `ink is ${L}, ${C}, ${h}`);
});

test("shadow darkens, toward blue-violet, never to black", () => {
  everyPalette((pal, _o, label) => {
    for (const mat of LAND) {
      for (let tone = 0; tone < 16; tone += 3) {
        for (let shadow = 1; shadow < 4; shadow++) {
          assert.ok(
            lstar(at(pal, mat, tone, shadow)) <= lstar(at(pal, mat, tone, shadow - 1)),
            `${label}: ${MATERIAL_NAMES[mat]} tone ${tone} shadow ${shadow}`,
          );
        }
      }
    }
  });
  const pal = buildPalette(NOON);
  for (const mat of LAND) {
    const lit = oklabOf(at(pal, mat, FLAT_TONE));
    for (let shadow = 1; shadow < 4; shadow++) {
      const dark = oklabOf(at(pal, mat, FLAT_TONE, shadow));
      const before = oklabOf(at(pal, mat, FLAT_TONE, shadow - 1));
      // Dark woods and slate have little lightness left to give: their darks are compressed, so no shadow is black.
      assert.ok(dark[0] < before[0] - (lit[0] > 0.55 ? 0.02 : 0.008), `${MATERIAL_NAMES[mat]}: shadow ${shadow} is not darker`);
      assert.ok(dark[2] < lit[2] + 0.004, `${MATERIAL_NAMES[mat]}: shadow ${shadow} is not bluer`);
    }
    // A coloured shadow: the deepest still holds over a third of the light, and more than the ink.
    const deep = oklabOf(at(pal, mat, FLAT_TONE, 3));
    assert.ok(deep[0] > lit[0] * 0.6 && deep[0] > 0.24, MATERIAL_NAMES[mat]);
  }
  // Never black: the darkest tone of the darkest wood, in the deepest shadow, is a dark teal lighter than the ink.
  for (const mat of LAND) {
    const [L] = oklabOf(at(pal, mat, 0, 3));
    assert.ok(L > 0.245, `${MATERIAL_NAMES[mat]}: tone 0 in deep shadow is ${L.toFixed(3)}`);
  }
  const [, wc, wh] = lch(at(pal, M.coniferCool, 2, 3));
  assert.ok(wc > 0.03 && wh > 150 && wh < 260, `a wood's deep shade is ${wc.toFixed(3)} at ${wh.toFixed(0)}°`);
  // Blue-violet, seen on a neutral: pale rock in deep shadow.
  const [, C, h] = lch(at(pal, M.rockLime, FLAT_TONE, 3));
  assert.ok(C > 0.015 && h > 250 && h < 320, `shadow on limestone is ${C} at ${h}°`);
});

test("land ramps run from a cool shade to a warm light", () => {
  const pal = buildPalette(NOON);
  for (const mat of LAND) {
    for (let tone = 1; tone < 16; tone++) {
      assert.ok(lstar(at(pal, mat, tone)) >= lstar(at(pal, mat, tone - 1)), `${MATERIAL_NAMES[mat]} tone ${tone}`);
    }
    const shade = oklabOf(at(pal, mat, 0));
    const light = oklabOf(at(pal, mat, 15));
    assert.ok(light[0] - shade[0] > 0.12, `${MATERIAL_NAMES[mat]} has no range`);
    assert.ok(shade[2] < light[2], `${MATERIAL_NAMES[mat]}: shade is not bluer than light`);
  }
});

test("three value masses at noon: light open ground, mid upland, dark woods", () => {
  const pal = buildPalette(NOON);
  const L = (mat: number): number => lstar(at(pal, mat, FLAT_TONE));
  const light = [M.meadowCool, M.meadowMid, M.meadowWarm, M.wheat, M.barley, M.hay].map(L);
  const mid = [M.heathCool, M.heathMid, M.heathWarm, M.moorCool, M.moorMid, M.moorWarm].map(L);
  const dark = [M.broadleafCool, M.floorBroadleaf, M.floorConifer, M.coniferCool, M.coniferMid, M.coniferWarm].map(L);
  assert.ok(Math.min(...light) > Math.max(...mid) + 4, `light ${Math.min(...light)} mid ${Math.max(...mid)}`);
  assert.ok(Math.min(...mid) > Math.max(...dark) + 2, `mid ${Math.min(...mid)} dark ${Math.max(...dark)}`);
});

test("vermilion and gold are absent from terrain, in every palette", () => {
  const reserved = [reservedLab(RESERVED.vermilion), reservedLab(RESERVED.gold)];
  let nearest = Infinity;
  let nearestWhat = "";
  everyPalette((pal, _o, label) => {
    for (let mat = 0; mat < MATERIAL_COUNT; mat++) {
      for (let light = 0; light < 256; light++) {
        const c = oklabOf(pal[(mat << 8) | light]);
        const chroma = Math.hypot(c[1], c[2]);
        let hue = (Math.atan2(c[2], c[1]) * 180) / Math.PI;
        if (hue < 0) hue += 360;
        if (hue > RESERVED_SECTOR[0] && hue < RESERVED_SECTOR[1]) {
          assert.ok(chroma <= TERRAIN_CHROMA_CAP + 0.006, `${label}: ${MATERIAL_NAMES[mat]} light ${light} has chroma ${chroma.toFixed(3)} at ${hue.toFixed(0)}°`);
        }
        for (const r of reserved) {
          const d = Math.hypot(c[0] - r[0], c[1] - r[1], c[2] - r[2]);
          if (d < nearest) {
            nearest = d;
            nearestWhat = `${label}: ${MATERIAL_NAMES[mat]} light ${light}`;
          }
        }
      }
    }
  });
  assert.ok(nearest > 0.045, `${nearestWhat} is ${nearest.toFixed(3)} from a reserved colour`);
  // The reserved colours themselves sit well outside the cap.
  assert.ok(RESERVED.vermilion[1] > TERRAIN_CHROMA_CAP * 1.5 && RESERVED.gold[1] > TERRAIN_CHROMA_CAP * 1.5);
  for (const r of [RESERVED.vermilion, RESERVED.gold]) assert.ok(r[2] > RESERVED_SECTOR[0] && r[2] < RESERVED_SECTOR[1]);
});

test("no terrain colour is a saturated game green", () => {
  everyPalette((pal, _o, label) => {
    for (const mat of LAND) {
      for (let tone = 0; tone < 16; tone++) {
        const [, C] = lch(at(pal, mat, tone));
        assert.ok(C < 0.15, `${label}: ${MATERIAL_NAMES[mat]} tone ${tone} has chroma ${C.toFixed(3)}`);
      }
    }
  });
});

test("time of day: dusk is warm, night is blue and dark, overcast is grey", () => {
  const mean = (o: PaletteOptions): [number, number, number] => {
    const pal = buildPalette(o);
    const sum = [0, 0, 0];
    for (const mat of LAND) {
      const c = oklabOf(at(pal, mat, FLAT_TONE));
      for (let k = 0; k < 3; k++) sum[k] += c[k] / LAND.length;
    }
    return [sum[0], sum[1], sum[2]];
  };
  const chroma = (o: PaletteOptions): number => {
    const pal = buildPalette(o);
    let sum = 0;
    for (const mat of LAND) sum += lch(at(pal, mat, FLAT_TONE))[1] / LAND.length;
    return sum;
  };
  const noon = mean(NOON);
  const dusk = mean({ ...NOON, time: PHASES.dusk });
  const night = mean({ ...NOON, time: PHASES.night });
  const morning = mean({ ...NOON, time: PHASES.morning });
  assert.ok(dusk[1] > noon[1] + 0.008, "dusk is redder");
  assert.ok(dusk[0] < noon[0] && dusk[0] > night[0] + 0.15);
  assert.ok(night[0] < noon[0] * 0.6, `night lightness ${night[0]} against ${noon[0]}`);
  assert.ok(night[2] < noon[2] - 0.03 && night[2] < 0, "night is blue");
  assert.ok(night[0] > 0.2, "night is dark, not black");
  assert.ok(Math.abs(morning[0] - noon[0]) < 0.03);
  // Dusk shadows go violet while the light goes warm.
  const duskPal = buildPalette({ ...NOON, time: PHASES.dusk });
  assert.ok(oklabOf(at(duskPal, M.sand, 15))[2] > oklabOf(at(duskPal, M.sand, 0, 3))[2] + 0.03);
  for (const time of [PHASES.morning, 0.5, PHASES.dusk]) {
    assert.ok(chroma({ time, season: 0.25, overcast: 1 }) < chroma({ time, season: 0.25, overcast: 0 }) * 0.75, `overcast at ${time}`);
  }
  // Night has little colour left to lose.
  assert.ok(chroma({ time: PHASES.night, season: 0.25, overcast: 1 }) < chroma({ time: PHASES.night, season: 0.25, overcast: 0 }));
  // Overcast flattens: less distance between shade and light, softer shadows.
  const clear = buildPalette(NOON);
  const grey = buildPalette({ ...NOON, overcast: 1 });
  const range = (pal: Palette): number => lstar(at(pal, M.meadowMid, 15)) - lstar(at(pal, M.meadowMid, 0));
  const shadow = (pal: Palette): number => lstar(at(pal, M.meadowMid, FLAT_TONE)) - lstar(at(pal, M.meadowMid, FLAT_TONE, 2));
  assert.ok(range(grey) < range(clear) * 0.9);
  assert.ok(shadow(grey) < shadow(clear) * 0.7);
});

test("the palette alone moves the snow line, turns the leaves and ripens the crops", () => {
  const year = [0, 0.25, 0.5, 0.75].map((season) => buildPalette({ time: 0.5, season, overcast: 0 }));
  const [spring, summer, autumn, winter] = year;
  const flat = (pal: Palette, mat: number): [number, number, number] => lch(at(pal, mat, FLAT_TONE));

  // Permanent snow is white all year; late snow melts in summer; alpine meadow is under snow in winter.
  for (const pal of year) assert.ok(flat(pal, M.snow)[0] > 0.93);
  assert.ok(flat(summer, M.snowLate)[0] < 0.8 && flat(summer, M.snowLate)[1] > 0.02);
  for (const pal of [spring, autumn, winter]) assert.ok(flat(pal, M.snowLate)[0] > 0.93);
  for (let v = 0; v < 3; v++) {
    assert.ok(flat(winter, M.alpineCool + v)[0] > 0.93, "alpine meadow under winter snow");
    assert.ok(flat(summer, M.alpineCool + v)[1] > 0.06, "alpine meadow green in summer");
  }

  // Broadleaf: green in summer, toward red and yellow in autumn, bare in winter. Conifers hold.
  for (let v = 0; v < 3; v++) {
    const leaf = M.broadleafCool + v;
    assert.ok(flat(summer, leaf)[2] > 120 && flat(summer, leaf)[2] < 165, `summer leaf hue ${flat(summer, leaf)[2]}`);
    assert.ok(flat(autumn, leaf)[2] < flat(summer, leaf)[2] - 25, "autumn leaves turn");
    assert.ok(flat(winter, leaf)[1] < 0.045, "winter woods are bare");
    assert.ok(flat(spring, leaf)[0] > flat(summer, leaf)[0], "spring leaves are fresh");
    const needle = M.coniferCool + v;
    assert.ok(Math.abs(flat(winter, needle)[2] - flat(summer, needle)[2]) < 15 && flat(winter, needle)[1] > 0.03);
  }

  // Wheat: green shoots, straw, stubble, plough.
  assert.ok(flat(spring, M.wheat)[2] > 120);
  assert.ok(flat(summer, M.wheat)[2] < 105 && flat(summer, M.wheat)[0] > flat(spring, M.wheat)[0]);
  assert.ok(flat(winter, M.wheat)[0] < flat(summer, M.wheat)[0] - 0.15);

  // Heather blooms purple in summer only.
  const bloom = flat(summer, M.heathCool);
  assert.ok(bloom[2] > 290 && bloom[2] < 345, `heather hue ${bloom[2]}`);
  assert.ok(flat(winter, M.heathCool)[2] < 120);
});

test("region accents: slate and heather, straw, limestone white and turquoise, snow blue", () => {
  const pal = buildPalette(NOON);
  const flat = (mat: number): [number, number, number] => lch(at(pal, mat, FLAT_TONE));
  // Slate is a dark blue-grey; limestone is near white; hard rock sits between.
  assert.ok(flat(M.rockSlate)[2] > 230 && flat(M.rockSlate)[2] < 290 && flat(M.rockSlate)[0] < flat(M.rockHard)[0] - 0.08);
  assert.ok(flat(M.rockLime)[0] > 0.86 && flat(M.cliffLime)[0] > 0.82);
  // Wheat is a pale straw, not gold.
  assert.ok(flat(M.wheat)[1] < 0.09 && flat(M.wheat)[0] > 0.74);
  // The karst sea is more turquoise at the shore than the open sea.
  const clear = lch(at(pal, M.seaClear, 0));
  const sea = lch(at(pal, M.sea, 0));
  assert.ok(clear[2] > 170 && clear[2] < 200 && clear[1] > sea[1]);
  // Snow shade is blue.
  const snowShade = lch(at(pal, M.snow, 0));
  assert.ok(snowShade[2] > 230 && snowShade[2] < 280 && snowShade[1] > 0.025, `snow shade ${snowShade}`);
});

test("snow is a cool blue-white wash, apart from the paper and from sand", () => {
  const pal = buildPalette(NOON);
  const paper = oklabOf(pal[M.none << 8]);
  for (const mat of [M.snow, M.snowLate]) {
    if (snowCover(mat, NOON.season) < 1) continue;
    for (let tone = 0; tone < 16; tone++) {
      const c = oklabOf(at(pal, mat, tone));
      // Never yellow, at any tone; and no tone sits within a just-visible step of the paper.
      assert.ok(c[2] < 0.002, `snow tone ${tone} has b ${c[2].toFixed(3)}`);
      const d = Math.hypot(c[0] - paper[0], c[1] - paper[1], c[2] - paper[2]);
      assert.ok(d > 0.03, `snow tone ${tone} is ${d.toFixed(3)} from paper`);
    }
    // Flat snow is pale and plainly blue; lit snow is cleaner and lighter; shade is blue-violet and much deeper.
    const flat = lch(at(pal, mat, FLAT_TONE)), lit = lch(at(pal, mat, 15)), shade = lch(at(pal, mat, 2));
    assert.ok(flat[0] > 0.9 && flat[1] > 0.012 && flat[2] > 220 && flat[2] < 275, `flat snow ${flat}`);
    assert.ok(lit[0] > flat[0] + 0.02 && lit[1] < flat[1], `lit snow ${lit}`);
    assert.ok(shade[0] < flat[0] - 0.15 && shade[1] > 0.05 && shade[2] > 250 && shade[2] < 290, `snow shade ${shade}`);
    for (const sand of [M.sand, M.sandPale]) {
      const q = oklabOf(at(pal, sand, FLAT_TONE)), c = oklabOf(at(pal, mat, FLAT_TONE));
      assert.ok(q[2] - c[2] > 0.02, "sand is yellower than snow");
    }
  }
});

test("water tone bits: the sea runs from turquoise shallows to deep blue, the river cycles", () => {
  everyPalette((pal, _o, label) => {
    for (const mat of [M.sea, M.seaClear, M.lake]) {
      for (let tone = 1; tone < 16; tone++) {
        assert.ok(lstar(at(pal, mat, tone)) <= lstar(at(pal, mat, tone - 1)) + 0.5, `${label}: ${MATERIAL_NAMES[mat]} tone ${tone}`);
      }
    }
  });
  const pal = buildPalette(NOON);
  for (const mat of [M.sea, M.seaClear]) {
    const shore = lch(at(pal, mat, 0));
    const deep = lch(at(pal, mat, 15));
    assert.ok(shore[2] > 170 && shore[2] < 205, `${MATERIAL_NAMES[mat]} shallows hue ${shore[2]}`);
    assert.ok(deep[2] > 235 && deep[2] < 265, `${MATERIAL_NAMES[mat]} deep hue ${deep[2]}`);
    assert.ok(shore[0] - deep[0] > 0.3);
  }
  // The river's phase ramp (tones 0–7) is a gentle streak whose ends meet; 8–14 are streams, 15 is foam.
  let lo = Infinity;
  let hi = -Infinity;
  for (let tone = 0; tone < 8; tone++) {
    const L = lstar(at(pal, M.river, tone));
    lo = Math.min(lo, L);
    hi = Math.max(hi, L);
    const next = lstar(at(pal, M.river, (tone + 1) & 7));
    assert.ok(Math.abs(next - L) < 1.2, `river phase jumps at ${tone}`);
  }
  assert.ok(hi - lo > 0.8 && hi - lo < 5, `river streak ${hi - lo} L*`);
});

test("paper shows where nothing is baked, and past the last material", () => {
  const pal = buildPalette(NOON);
  for (let light = 0; light < 256; light++) assert.equal(pal[light], pal[0], "material 0 ignores its light byte");
  const paper = lch(pal[0]);
  assert.ok(paper[0] > 0.93 && paper[1] < 0.035 && paper[2] > 60 && paper[2] < 110, `paper ${paper}`);
  assert.equal(pal[(200 << 8) | 5], pal[(255 << 8) | 77]);
});

/** The mean OKLab of every land material's flat tone in palette `o`. */
function meanLand(o: PaletteOptions): [number, number, number] {
  const pal = buildPalette(o);
  const sum: [number, number, number] = [0, 0, 0];
  for (const mat of LAND) {
    const c = oklabOf(at(pal, mat, FLAT_TONE));
    for (let k = 0; k < 3; k++) sum[k] += c[k] / LAND.length;
  }
  return sum;
}

test("the day runs night, blue hour, dawn, day, golden hour, dusk, blue hour, night", () => {
  const [night, blue, dawn, day, golden, dusk] = [PHASES.night, DAY_KEYS.blueDawn, PHASES.dawn, 0.5, PHASES.golden, PHASES.dusk].map(
    (time) => meanLand({ ...NOON, time }),
  );
  // Lightness climbs out of the night and falls back into it.
  assert.ok(night[0] < blue[0] && blue[0] < dawn[0] && dawn[0] < day[0], "morning brightens");
  assert.ok(day[0] > golden[0] && golden[0] > dusk[0] && dusk[0] > night[0], "evening darkens");
  // Dawn is rose, golden hour gold, dusk red-orange: all warmer than noon; the blue hour is blue.
  assert.ok(dawn[1] > day[1] + 0.006, "dawn is rosier than noon");
  assert.ok(golden[2] > day[2] + 0.01, "golden hour is yellower than noon");
  assert.ok(dusk[1] > day[1] + 0.008, "dusk is redder than noon");
  assert.ok(blue[2] < day[2] - 0.02 && blue[2] < 0, "the blue hour is blue");
  // The shipped midday is plain noon, wherever noon is held.
  assert.deepEqual(buildPalette({ ...NOON, time: DAY_KEYS.noonFrom + 0.01 }), buildPalette(MIDDAY));
  assert.deepEqual(buildPalette({ ...NOON, time: DAY_KEYS.noonTo - 0.01 }), buildPalette(MIDDAY));
});

test("darkness is none by day and full at night, rising through the dusk and falling through the dawn", () => {
  for (let t = DAY_KEYS.noonFrom; t <= DAY_KEYS.noonTo; t += 0.01) assert.equal(darkness(t), 0);
  for (const t of [0, 0.05, DAY_KEYS.nightEnds, DAY_KEYS.nightFalls, 0.9, 0.99]) assert.equal(darkness(t), 1);
  let last = 0;
  for (let t = DAY_KEYS.noonTo; t <= DAY_KEYS.nightFalls; t += 0.005) {
    const d = darkness(t);
    assert.ok(d >= last - 1e-12, `dusk at ${t}`);
    last = d;
  }
  assert.ok(darkness(PHASES.dusk) > 0.2 && darkness(PHASES.dusk) < 0.8);
});

test("mist is a pale veil: darks lift, colour drains, and the light and shade draw together", () => {
  const clear = buildPalette(NOON);
  const misty = buildPalette({ ...NOON, mist: 1 });
  const dark = (pal: Palette): number => lstar(at(pal, M.coniferCool, 0, 3));
  const range = (pal: Palette): number => lstar(at(pal, M.meadowMid, 15)) - lstar(at(pal, M.meadowMid, 0));
  assert.ok(dark(misty) > dark(clear) + 8, `darks ${dark(clear)} → ${dark(misty)}`);
  assert.ok(range(misty) < range(clear) * 0.75);
  const chroma = (o: PaletteOptions): number => {
    const pal = buildPalette(o);
    let sum = 0;
    for (const mat of LAND) sum += lch(at(pal, mat, FLAT_TONE))[1] / LAND.length;
    return sum;
  };
  assert.ok(chroma({ ...NOON, mist: 1 }) < chroma(NOON) * 0.75);
  // At night the mist is a dim blue-grey, not a white sheet.
  assert.ok(lstar(paperIn({ ...NOON, time: PHASES.night, mist: 1 })) < 60);
  // No mist is no change.
  assert.deepEqual(buildPalette({ ...NOON, mist: 0 }), clear);
});

test("colours that are not land take the same light: unchanged at noon, dark and blue at night, the dragon's red kept", () => {
  const vermilion = 0xff2b3fcf;
  assert.equal(gradeRgb(vermilion, NOON), vermilion);
  assert.equal(gradeRgb(0xffd2e8f0, NOON), 0xffd2e8f0);
  const night = oklabOf(gradeRgb(0xfffafcfd, { ...NOON, time: PHASES.night }));
  assert.ok(night[0] < 0.6 && night[2] < -0.01, `a white cloud at night ${night}`);
  // The terrain's cap on the reserved hues does not apply: the dragon stays red at dusk.
  const [L, a, b] = oklabOf(gradeRgb(vermilion, { ...NOON, time: PHASES.dusk }));
  assert.ok(Math.sqrt(a * a + b * b) > 0.12 && L > 0.3);
});
