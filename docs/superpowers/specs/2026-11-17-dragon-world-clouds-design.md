# Dragon world: clouds. Design

Status: approved by the owner on 2026-11-17, from the approach and the three styles laid out in conversation.
Roadmap item: "Next: the world comes alive", item 1.

## Intent

Clouds make flying feel airy and alive. The owner calls them "so important": they must be good, and drawn in the same
Ink & Glyph storybook style as the land. Shadows are not needed.

## What the owner decided

- **Both layers.** Most clouds drift *below* the flier: over the land, under the kite, with land showing through the
  gaps. Now and then a tall **bank** stands at the flier's height, and the flier passes through it, showing faintly
  through the cloud for a moment.
- **Painted sprites**, not a noise field or stacked 3D clouds.
- **Three art styles, all built, compared side by side on the real world**; the owner picks:
  1. **Watercolour:** soft washed puffs, ink only on sunlit rims.
  2. **Storybook:** bold heaps, fully inked outline, hatched shaded bellies.
  3. **Layered:** thin high streaks over low heaps.

## Approaches considered

- **Noise field** (a moving pattern cut into shapes each frame): endless variety and cheap, but it is the "noise blob"
  look the terrain work threw out, and it has no distinct banks to fly through.
- **Painted sprites** (chosen): shapes generated and painted once at load, scattered by the seed, drifting with the
  wind. The easiest look to direct, flying through a bank comes for free, and copying finished sprites is the cheapest
  work per frame. Repetition is the risk, so there are many shapes, flipped and scaled.
- **Stacked 3D clouds** (columns lit like the land): most solid, costliest, and they read as floating terrain.

## Design

- **Shapes.** At load, generate about 40 shapes from the world seed: **heaps** (flat bases, domed tops, 40–140 px
  wide), **wisps** (long and thin, 60–200 px), **banks** (tall, dense, 120–220 px), and for the layered style **high
  streaks** (very thin and long). Each shape is a coverage mask plus a dome height per pixel (for lighting the top).
- **Painting.** Each style is a painter: shape in, sprite out (colour and alpha per pixel), painted once at load. Lit
  from the same north-west sun as the land: cream tops, cool blue-grey bellies, ink in the house ink colour. Paper
  grain runs through them. No vermilion or gold (reserved for the flier, the dragon and landmarks).
- **Placement.** Clouds are scattered over the torus by the seed, thinned by a broad "weather" field, so some regions
  are clear and some overcast. About 15–35 % of a view is covered by low cloud on average. Banks are rare: at most one
  on screen at a time, on average one every 20–40 s of cruising.
- **Motion.** Everything drifts with one slow wind (about 3 cells a second, direction from the seed); high streaks
  drift faster. Clouds wrap with the world. The sky is the same for every visitor at the same moment, since it is
  derived from the seed and the clock.
- **Drawing order.** Land, then low clouds, then the flier, then banks and high streaks. Banks are translucent enough
  that the flier stays visible as a faint shape inside one.
- **Altitude.** Low clouds and banks sit at fixed heights, used only for their screen offset (`screenY = 0.8·y − alt`).
  The flight model is unchanged.
- **Cost.** Under 1 ms of main-thread work a frame (p95, unthrottled) on top of today's 1.8 ms.
- **Choosing a style.** Until the owner picks, `/world?clouds=watercolour|storybook|layered` chooses one (default
  watercolour), and a contact-sheet script renders the same views in all three.

## Non-goals

Cloud shadows; rain, weather states and time-of-day tinting (later, through the palette); clouds reacting to the
flier; any change to the world file.

## Anti-goals: it fails, even if every test passes, when

- clouds read as noise blobs, cotton balls or clip art rather than painted clouds;
- the flier is hidden for more than a moment, or a bank parks on a landmark;
- the land underneath reads as smothered (the land is the star);
- shapes visibly repeat on one screen;
- clouds slide with the land without drifting of their own, so they look painted onto the ground.

## Left to the builder

The shape generator's noise recipe, sprite sizes inside the ranges, the exact colours inside the house palette, and
the blending maths.
