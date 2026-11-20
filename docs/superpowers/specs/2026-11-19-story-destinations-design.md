# The hall and the quest of five

Status: draft 4, for the owner (Fable, 2026-11-19). Not built. The owner chose "across the world" for the five. Draft 2 had dialogue and choices; the owner asked for
none. Draft 2 is in git at `2334b58`.

Sketches: `2026-11-19-story-destinations-options.html`, beside this file.

## 1. Summary

- All projects move to one hall next to the home town.
- The story is a quest. The visitor finds five odd things on the map.
- Each thing shows one fact about Daniel.
- There is no dialogue and there are no choices. The visitor lands. The thing moves. One line appears.

## 2. How it works on a large map

The map is large. The five things are small. These rules make them easy to find and easy to use.

1. **The first is near home. The others are across the world.** The first is 15 seconds from the start, so every
   visitor finds one. Each of the other four is in a different climate, about 60 to 90 seconds of flight from the one
   before. The world loops, so the route is a circle that ends at home. The full quest takes about 8 minutes.
2. **They are easy to see.** Each has a tall red pennant. Red is used for nothing else on the land.
3. **The screen shows the way.** Five quatrefoils are in a corner of the screen. A small marker at the screen edge
   points to the nearest thing not yet found. The things are far apart, so the marker is necessary.
4. **Landing is the interaction.** Near a thing, the usual prompt appears. The visitor presses Space or taps. The
   dragon lands, as it does now.
5. **The thing responds.** It plays a short animation, 3 to 5 seconds long.
6. **The visitor gets a keepsake.** One quatrefoil fills with a small icon. The pennant comes down.
7. **One line appears.** A small card shows one fact about Daniel. This is the only text.
8. **The visitor takes off.** Space or tap, as now.

The visitor uses one button. There is nothing to read first, nothing to choose, and nothing to fail.

## 3. The hall

- One building next to the home town. It is in the first frame of a flight.
- Landing there opens the Codex with all projects in a list. A row opens that project's page (the page that exists
  now).
- The projects come from the pinned repos (`src/lib/github.ts`), as now.
- First step: the town opens the list. The new building comes with the next world build.
- Look: sketch A, a long hall with a lantern on the roof.

## 4. The five

| # | Thing on the map | Animation on landing | Keepsake icon | The one line |
|---|---|---|---|---|
| 1 | A very small pine in a pot, below one very large yew | Shears cut one needle. A cone falls. | Pine cone | Daniel likes slow, careful work. Try `cbonsai` in the terminal. |
| 2 | A desk in a hay field. A novelist writes at it. | She turns a page. One page flies up. | Page | Daniel reads a lot. |
| 3 | A bell in a wood frame on a bare hill. A wood figure with a hammer stands by it. | The figure hits the bell once. | Bell | Daniel thinks about faith, technology and what AI is. |
| 4 | A small mill-shed with sails, a water wheel and a bell on a pole | The sails turn. A flag goes up. A hen walks out. | Cog | Daniel runs a home lab on Unraid. |
| 5 | A peach basket on a dead oak. A boy throws a ball at it. | He misses. He throws again. The ball goes in. | Ball | Daniel plays basketball and follows the Houston Rockets. |

- Order: any. The marker points to the nearest, so most visitors follow the circle.
- Places: 1 on the home island (temperate). 2 on the steppe. 3 on the tundra. 4 in the Mediterranean country. 5 on
  the savanna. Each thing is in open country where it is easy to see.
- A visitor can stop at any time. Found things stay found on the next visit.
- After the fifth: the card shows "That is all five." and a link to email Daniel.
- The lines come from a new list, `INTERESTS`, in `src/components/terminal/content.ts`. Other pages can use the list.

## 5. Spare stops

Any of these can replace one of the five, or make a second quest later.

| Interest | Thing on the map | Animation on landing |
|---|---|---|
| Cello | A man with a cello on a rock in fog | He plays one long note. |
| Startups | A large boat on dry land, far from the sea | Three people hit one peg in. |
| Helping others start projects | A child with a kite on the ground | The dragon's wind lifts the kite. |
| Mechanical keyboards | A small organ on a bench in the open | One key goes down. One pipe sounds. |
| Apex Legends | Children playing tag in a ring on a beach | The tide makes the ring smaller. |
| Home (New Jersey, Houston, Rice) | A signpost with three arms | An owl lands on it. |

## 6. The Codex

| Landing at | The Codex shows |
|---|---|
| The hall | The project list. A row opens one project. |
| The abbey | About me, links and the terminal button, as now. |
| One of the five | A small card: the keepsake icon and the one line. |

- Every page ends with the five quatrefoils. A found one shows its icon and its line.
- The other six landmarks no longer offer a landing. They are scenery.

## 7. Phones

- The same steps. Tap to land. Tap to take off.
- The card is a small sheet at the bottom of the screen.
- The quatrefoils and the edge marker do not overlap the touch controls.
- A found thing gives the short buzz that exists now.
- With reduced motion, the animation is one still frame.

## 8. Code changes

**Remove**

- `src/world/sites/assignments.json`, `assignSites` and its tests, `src/world/landmarks.config.ts`.
- The repo-to-site matching in `src/app/world/page.tsx` and `src/world/sites/landmarks.ts`.
- The Codex's "Unclaimed" page and the register "Where the work is kept".
- Keep `LandmarkType` and `featureFor`. The generator imports them.

**Add**

- `content.ts`: `INTERESTS`, a list of `{ key, line }`.
- `src/world/story/stops.ts`: the five stops as data: sprite, animation, icon, key of its line.
- `src/world/story/progress.ts`: pure functions: which stops are found, the count, the nearest stop not found. Tested.
- `src/world/live/`: the sprites, animations and pennants. They use time and the seed only. No `Math.random`.
- `Codex.tsx`: the project list, the small card, the five quatrefoils.
- `Overlays.tsx`: the five quatrefoils and the edge marker in the flight view.
- `session.ts`: storage key `world:story` (the list of found stops). Each find is also a discovery, so the caption and
  the buzz work as now.
- Sound: one bell note for stop 3. The sound session makes it.

## 9. What the biomes session must supply

1. A site of kind `hall`: one building within 150 cells of the start, in the start frame, with a level pad. The home
   start frame changes one time.
2. Five sites of kind `curio`: level, open pads, 24 cells wide, at least 300 cells from a landmark or wonder.
   `curio-0` is on the home island, 15 seconds from the start. The other four are on the steppe, the tundra, the
   Mediterranean country and the savanna, in that order round the loop, 60 to 90 seconds of flight apart.
3. One large yew stamped at the first curio. All other parts are live sprites.
4. No change to the seven landmarks.

Before the new world exists, the quest can run on the present world at five spare landmark sites.

## 10. Originality

- Borrowed from *The Little Prince*: the shape only. A traveller goes to small places and each one shows one thing.
- Not used: its characters, names, scenes, lines and art.
- The owner chose the bonsai and the novelist to replace the rose and the king.
- Two Opus critics checked draft 2. They found no item that had to be cut. They asked for changes to nine lines and
  three pictures. Draft 3 removes those lines. The three picture changes are kept: the desk is in a worked hay field
  with a cart at the gate; the mill-shed is low with one flue; the dead oak is grey and at the edge of a field.
- The animations and the one-line facts are new in draft 3 and no critic has read them yet.

## 11. Open questions for the owner

1. **Answered: across the world.** The first is near home; the other four are in four other climates.
2. **The edge marker.** It points to the nearest thing not found. Recommended: yes. At these distances the pennants
   alone are not enough.
3. **The five.** The table in section 4 is the recommendation. Swap any row with a row from section 5.

## 12. Left to the builder

**Who builds what** (owner's routing, 2026-11-19)

- **Cursor builds** what tests or a precise brief can pin: the hall's project list, the Codex changes, the quest log
  and the count, the curio sites, and the logic of each stop (found, keepsake, line). It runs in this worktree as
  `cursor-agent -p --force --model grok-4.7-xhigh "<brief>"`.
- **Claude (Opus) keeps** the briefs, the tests written first, the review of each Cursor change, and judging the
  sprites, animations and text on renders.

**Still open for the build**

- The sprites and animations, judged on renders.
- How the camera frames a small thing when the dragon lands.
- The size of the pennant and the look of the edge marker.
- Order of work: (1) the project list on the town, and the removals; (2) the quatrefoils and stop 1, complete;
  (3) stops 2 to 5; (4) the ending.
