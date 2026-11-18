# The dragon: design

Status: **decided by the owner on 2026-11-18: A, the river-dragon, in vermilion lacquer with a gold belly and mane.**
It is drawn as sprite stacks strung along the head's path, and it is the flier on `/world` (the stand-in kite and the
other studies are removed; they remain in git history). Controls are unchanged. The options as they were laid out
follow, for the record.

**Built:**
- the body chain;
- the face, readable at 1×;
- the S-undulation, which quickens with speed;
- banking into turns, with the gold belly showing on the outside;
- the mane and whiskers streaming;
- the feathered tail fin;
- the shadow and the depth test;
- the wake on water and startled birds, through the live layers;
- the bench, `npm run world:dragon`.

**Next:** boost streaks. Later, with the landmarks: coiling down onto a site's pad to land.

## What is already settled

- **It is the player.** You fly it over the realm in the overhead camera: north-up, no perspective,
  `screenY = 0.8·y − height`, a 400×225 frame scaled up with hard pixels.
- **Its colours.** Vermilion and gold are reserved for it (and landmarks). The terrain's palette is kept clear of them,
  so the dragon always stands out.
- **What the engine already gives it** (`WorldView`):
  - a depth test, so it slips behind hills and trees;
  - a shadow on the ground, offset 0.354 cells per unit of height to the south-east, matching the land's sun;
  - an occlusion floor, the lowest height at which land to the south can't hide it;
  - live layers, so it can leave a wake on water and startle birds.
- **The stand-in.** A small vermilion kite flies in its place today. Flight: cruise 60 cells/s, boost ×1.8, turn
  1.6 rad/s, holding 18 units over the ground.
- **Original work only.** The owner first mentioned Haku from *Spirited Away* as the feeling. Claude proposed an
  original design in that spirit rather than anything like that character: no white body with a green mane, no film
  likeness.

## Decisions for the owner

### 1. Body (the biggest choice)

| Option | What it is | Trade-off |
|---|---|---|
| **A. River-dragon (Claude's pick)** | Long and wingless, flowing like a ribbon: a head with streaming whiskers and a mane, a serpentine body that follows the head's path in S-curves, small clawed feet, a feathered tail tip. | The most graceful in a top-down view: the S-curve reads instantly and its trail of body segments shows every turn. It suits rivers and the storybook world. Its body is long (60–90 px), so it covers more land. |
| B. Winged dragon | A compact western body with broad wings that beat and glide. | Reads as "dragon" to everyone, and wingbeats give strong motion. Top-down, it's mostly a wing silhouette, and it's closer to many existing games. |
| C. Small storybook wyrm | A short, round, friendly dragon with little wings, closer to a mascot. | Charming and small on screen, but less awe. |

### 2. Colour

| Option | Look |
|---|---|
| **A. Vermilion lacquer with gold (Claude's pick)** | A deep vermilion body, a gold belly and mane, cream whisker tips, inked scales. The reserved colours were kept for exactly this. |
| B. Ivory with vermilion mane | Pale and luminous over green land; elegant, but it fights the cream paper and the clouds. |
| C. Jade with gold | Calm and natural; but it sinks into forests and sea. |

### 3. How it's drawn

- **Sprite stack per body segment (Claude's pick).** Each segment is a small stack of pixel slices, drawn with the
  turn and bank of its point on the path: the technique the Forge demo used for its jet (reference only, never its
  code). It turns smoothly in any direction and depth-tests per pixel. It's built procedurally from a few profiles, so
  the shape can be tuned on the bench.
- **Hand-drawn sprites in 16 directions.** More painterly, but every pose multiplies the drawing work, and smooth body
  curves are hard.

### 4. How it moves

- **Cruise.** A slow S-undulation travels down the body; the whiskers and mane stream behind.
- **Turning.** The body banks into the turn, and the tail follows the head's exact path.
- **Boost.** The undulation tightens and wind streaks trail behind.
- **Over water.** A V-wake when flying low; skimming low throws spray.
- **Landing,** for landmarks later: it coils down onto a site's pad.

### 5. Controls (unchanged unless the owner wants more)

Arrow keys or WASD to steer, Up or Shift to boost, Down to slow, Esc to leave. Possible later additions: climb and
dive keys, or a gamepad.

## What Claude proposes to build once chosen

1. **A dragon bench.** A page or command that renders the dragon in eight headings, banked and level, with a strip of
   frames for the undulation, over sea, meadow and forest.
2. **The body model.** Profiles for the head, body and tail; the segment chain that follows the path; the sprite-stack
   renderer with a depth test and shadow.
3. **Motion.** Undulation, banking, the whiskers and mane trailing, and the boost.
4. **Interactions.** A wake on water, startling birds (already supported by the live layers), and later, landing.

Fable would design the look on the bench, Cursor would build the chain and the renderer against tests, and the owner
would choose from bench renders before it replaces the kite.
