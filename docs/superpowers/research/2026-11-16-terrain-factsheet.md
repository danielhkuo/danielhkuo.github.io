# Dragon world: terrain fact sheet (2026-11-16)

This is the input for the terrain design pass. It records what the owner has decided, what the throwaway spike proved, what is wrong with the spike's terrain, and the bar the new terrain has to clear. Anything marked **(default)** is Claude's proposal that the owner has not objected to. Treat it as settled unless you have a strong reason to change it, and say so if you do.

## 1. The product

danielhkuo.github.io is becoming a world you explore on dragonback (see `.claude/CLAUDE.md`).

- **Title menu.** An inked storybook page with a stained-glass rose window. It offers The Recruiter (a plain text site), The Wayfarer (fly), The Artificer (the existing terminal, housed in the first tower) and The Herald (`agents.md` and `llms.txt`).
- **Flying.** You fly over one shared realm. Each pinned GitHub project is a landmark you discover, and landing opens its entry. Discoveries are saved in localStorage, and **Continue** returns you to the last landmark you landed on.
- **The dragon.** An original long, wingless, serpentine river-dragon, in the spirit of an East Asian dragon but not any existing character. It ripples along its own path, coils on landmarks when it lands, and skims rivers leaving a wake. **Rivers are roads**: following a river should lead you somewhere.

## 2. Decisions that constrain the terrain

- **Camera.** North-up overhead view with no perspective and a tilt. The spike's projection is `screenY = worldY*KY - height*KH` with KY = 0.8 and KH = 1, and one world cell is one screen pixel horizontally. The dragon turns freely; the map never rotates.
- **Rendering.** A software pixel renderer: TypeScript writes a low-resolution RGBA buffer, which is scaled up with hard pixels. No WebGL, no three.js, no meshes. Viewport around 400×225 pixels.
- **Baked layers.** The land is baked once into per-pixel layers: material, light level, depth and face (top or wall). Each frame only copies the bake through a palette, adds live layers (water glints, cloud shadows, the dragon and its shadow) and depth-tests the dragon against the bake.
- **Palette does the restyling.** Time of day follows the visitor's clock, the season follows the real date, and weather is rolled per visit. All of it is palette and overlay work, so the baked land never re-bakes for them. Baked cast shadows assume one fixed sun direction; a second bake for low sunset shadows is optional.
- **One shared world.** The same land for everyone, shaped and baked offline from a seed the owner chooses. It either runs at build time or is committed as assets: your call, argue it. Visitors download finished data and simulate nothing heavy.
- **Looping (default).** An archipelago that wraps on a torus, so you fly forever with no seams.
- **Landmark sites (default).** The generator reserves believable sites, each with a type, and pinned projects are matched to sites at build time. Pinning a new repo moves a landmark between sites and never reshapes the land. Landmark types:
  - the **first landmark**: a hilltop abbey with the rose window, whose scriptorium holds the terminal;
  - a **lighthouse** on a headland or sea stack;
  - a **windmill** on a windswept ridge;
  - a **stone bridge or aqueduct** over a gorge or river;
  - a **ruined cathedral** in a valley, grass inside;
  - a **churchyard yew** on a knoll;
  - a **seaside town** in a sheltered bay with a harbour and a clock tower.
- **Landmarks are sprite stacks.** They are voxel models drawn into the bake or at runtime with a depth test, not terrain. Terrain must provide flat, believable pads and approaches for them.
- **Paint (default, unconfirmed).** Lush, saturated Ghibli summer colour with ink lines kept on silhouettes, cliffs and coasts. That means Ghibli colour with Witch Hat line work. The alternative was a pale ink wash.
- **Art direction.** The European side of Ghibli: seaside towns with red roofs, Welsh mining valleys, alpine meadows and lakes, Adriatic coves and sea stacks, windswept ridges, towering cumulus clouds, wind through tall grass.
  - Ornament is Gothic and church-built only. No pagan or occult motifs, no shrines, no torii, no spirits.
  - Original work only: no Ghibli, Tolkien or NieR names, characters or designs.

## 3. The spike

The spike is `/Users/dkuo/repos/danielhkuo.github.io/.superpowers/brainstorm/98727-1794863782/content/spike-overhead.html`: one self-contained file, with the worker code inside `workerMain`. Read it.

- **World size and shape.** 1024² cells. Six octaves of value noise with each octave rotated about 37°, plus a radial island falloff.
- **Heights.** Sea level at 0.5. Water at height 8. Land is snapped to 11 terraces of 5 height units, and forest adds 3. The tallest stack plus a landmark fits under HMAX = 110 pixels.
- **Materials.** 0–3 are water depths and foam, 4 is sand, 5–7 are grass, 8 is forest, 9–10 are rock, 11 is snow. 12–18 are landmark parts.
- **Light levels.** 0 ink, 1 hatch line, 2 shade, 3 base, 4 lit.
- **Bake.** Painter's order from north to south. Each cell is a column, with depth `n = worldY + 0.8*height`.
- **Ink.** Ink goes where depth jumps by more than 2.6 (silhouettes), on a top face that sits on a wall at least 2 px tall (creases), and on coastlines.
- **Sun.** From the north-west. Shadows march toward the sun, with the ray climbing 2 height units per cell. The dragon's shadow is offset by 0.354 per height unit on each axis, so it agrees with the baked shadows.
- **Measured.** The bake took 1.3–1.5 s in one worker for 1024². Each frame took about 0.5 ms for compositing plus a ~1,500-voxel dragon at 400×225 (Chrome, M-series Mac).
- **Lessons.**
  - Plain value noise draws grid-aligned rectangles in the shading.
  - Every repeating field must tile.
  - Whole-world bakes won't scale; tiles or lazy bakes are needed.

## 4. Why the spike's terrain looks chopped (the owner's word)

- **Stair-steps.** Heights are snapped to 11 coarse terraces, and every terrace edge gets an ink crease.
- **No geography.** The shape is raw noise: no drainage, no valleys or ridges, no rivers, no lakes, just blobs.
- **Hard colour bands.** Materials are picked by altitude band, so they change in hard bands, not by slope, moisture or exposure.
- **Flat shading.** Hillshade has three levels and comes from the noise field, not the real surface.
- **Bare ground.** There is no scatter: no individual trees, rocks, hedgerows or fields.
- **Same everywhere.** No regions: every part of the island looks alike.

## 5. The quality bar

The owner wants terrain that is **super realistic** in its geography, while staying readable at pixel scale. It should feel like a Ghibli landscape painted from a real place.

- **Water shapes the land.**
  - Drainage basins and branching river networks.
  - V-shaped valleys in the hills and wider valleys lower down.
  - Meanders, lakes in natural depressions, river mouths and deltas.
  - Every river reaches the sea or a lake.
- **Coasts vary.** Sandy beaches in sheltered bays, cliffs on exposed headlands, sea stacks, coves and shallow shelves.
- **Mountains have structure.** Ridgelines, scree and talus below cliffs, snow on high and north-facing slopes.
- **Ground cover follows the land.** Grass, meadow, forest, heath, rock and snow follow altitude, slope, moisture and exposure. Forests clump along valleys and lower slopes. Meadows open on the gentle land.
- **Regions differ.** A seaside town region, a valley region, a highland region and an exposed coast should each read as different places.
- **No artefacts.**
  - No stair-steps unless chosen as a style.
  - No grid rectangles.
  - No seams at tile borders or at the wrap.
- **Readable at pixel scale.**
  - A river is at least 1–3 px wide.
  - A cliff reads as a cliff.
  - Height is shown by shading and by ink at real silhouettes, not by ink on every small step.
- **Landmarks sit believably,** with natural approaches.
  - lighthouse on a headland or stack
  - abbey on a hilltop with a road up
  - windmill on a ridge
  - bridge where a road crosses a river or gorge
  - ruined cathedral in a valley
  - yew on a knoll
  - town in a sheltered bay
- **Pacing.** Roughly 30–60 seconds of flight between landmarks. The spike flew at 60 cells/s (×1.9 when boosting). Propose the world size this implies, and the numbers behind it.

## 6. Constraints

- **Hosting.** Static export on GitHub Pages: no server and no custom headers, so no `SharedArrayBuffer`. Workers with transferable buffers are fine.
- **Download budget (proposed, argue it).** About 1.5 MB of world data before first flight, and about 8 MB total streamed by proximity. Interactive within about 2 s on a mid-range phone.
- **Frame budget.** Under 4 ms per frame on a mid-range phone at the 400×225 viewport.
- **Offline generation.** It may take minutes. Prefer pure TypeScript with no native dependencies, so the browser bench and the offline baker share code. Node is v26, which runs `.ts` directly.
- **Deterministic.** A seeded RNG, the same output on every run, never `Math.random()` in world code. Floating-point determinism across machines matters if generation runs in CI.
- **Tests.** Node's built-in runner: `npm test` runs `node --test "src/**/*.test.ts"`. World code lives in a new `src/world/` package.
- **Who builds what.** Implementation runs through the owner's `cursor-delegate` plugin. Claude writes each task's tests and commits them, Cursor's CLI implements, and a clean-copy check decides pass or fail. Each task needs:
  - a seam a test can pin: determinism, tileability, mass conservation, every river draining, no pits after lake-filling, tile-edge agreement, encode and decode round-trips, budgets;
  - files you can name up front;
  - a model:
    - `composer-2.5` for mechanical work;
    - `grok-4.7-high` for numerical, geometric or floating-point work;
    - Claude (Fable) for anything a test can't judge, such as look and shading.
- **Look-tuning loop.** The look is tuned through render critics. A headless renderer bakes fixed viewpoints to PNG files, and Claude critics score them against this bar. The design must specify that harness and its viewpoints.

## 7. References to consider (verify before relying on them)

- **Erosion and drainage:**
  - Braun & Willett 2013, *Geomorphology*: an O(n) implicit solver for the stream-power law (the "FastScape" method).
  - Cordonnier et al. 2016, Eurographics: tectonic uplift plus fluvial erosion.
  - Cordonnier et al. 2023, SIGGRAPH: glacial erosion.
  - Schott et al. 2023, ACM TOG: interactive erosion for large-scale terrain authoring.
- **Hydrology first:** Génevaux et al. 2013, SIGGRAPH: terrain built from a river network.
- **Depressions and lakes:** Barnes, Lehman & Mulla 2014, *Priority-Flood*.
- **Smaller-scale erosion:** thermal erosion (Musgrave, Kolb & Mace 1989) and droplet hydraulic erosion (Beyer 2015 thesis).
- **Roads:** Galin et al. 2010, procedural roads by weighted shortest paths on terrain.
- **Even scatter:** Bridson 2007, Poisson disk sampling.
- **Stylised rendering:**
  - Saito & Takahashi 1990, ink lines from depth and normal breaks;
  - Praun et al. 2001, tonal art maps for hatching;
  - Ulichney 1993, blue-noise dither;
  - Max 1988, horizon mapping;
  - Timonen & Westerholm 2010, height-field shadowing.
- **Overview:** Galin et al. 2019, a review of digital terrain modelling (Eurographics STAR).
- **Practice:** Amit Patel's mapgen4 (Red Blob Games), fast and beautiful in-browser map generation with rivers. Gradient or simplex noise, and domain warping, in place of value noise.
- **The original inspiration:** a Forge demo, a Canvas2D sprite-stack fighter jet over voxel-space islands. It is reference only, and its source must never be copied.

## 8. What the design must deliver

A design another engineer can plan from, covering:

1. **The generation pipeline, stage by stage:** base shape, uplift and tectonics if any, erosion, hydrology, coasts, regions and biomes, ground cover, scatter, landmark sites, roads. For each stage: the algorithm, its parameters and defaults, the data it produces, and why it beats the alternatives.
2. **Wrapping.** How every stage stays seamless on the torus.
3. **Scale.** World size and resolution, the height range, the height quantisation (and whether terraces survive as a style), and the pacing maths.
4. **Data formats.** What ships to the browser: baked tiles or heightfield plus materials, the encoding, tile size, streaming order, and expected sizes. Where generation runs (CI or committed assets) and why.
5. **Rendering upgrades.** Shading, ink, hatching, dither, shadows, water and scatter: what is baked and what is live, and how each fits the frame budget.
6. **Landmark siting.** Rules for each landmark type, and how projects are matched to sites.
7. **The render-critic harness:** viewpoints, outputs, and the rubric.
8. **The task breakdown for cursor-delegate:** each task with its files, the test seam that pins it, and the suggested model. Plus the tasks that stay with Claude.
9. **Risks, open questions for the owner, and what you deliberately left out.**
