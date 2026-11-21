# The hall and the quest of five

Status: approved by the owner, 2026-11-20 (draft 5). His answers: the quest is opt-in, offered at the end of the
first-flight lesson; floating arrows point the way; the hall is approved; the five stand as drafted, and he may still
swap any. The projects will later come from a curated list, not the pinned repos. Earlier drafts are in git (draft 2,
with dialogue, at `2334b58`). On 2026-11-21 he chose the glass framing: the hall's rose window is missing five panes of
coloured glass, and each of the five places keeps one. The count is a small five-lobed rose that fills a lobe at each
find; when all five are found the window lights, its colours fall on the ground before the hall, and the dragon curls
up in that light.

Sketches: `2026-11-19-story-destinations-options.html`, beside this file.

**Since built** (2026-11-21): the five and the hall are baked into the world by the generator
(`src/world/gen/monuments.ts`, stood by `settle` from `places.json`; ship with `npm run world:build -- --seed 3 --n 10240
--cache --story`), listed as `curio-*` and `hall-0` sites. The five are a walled garden, a stone library, a clock tower,
an engine house and a court; the hall has a rose window and a paved yard. Only the panes and the ending's light are live
(`src/world/live/story.ts`). The live hall and tableaux below remain as fallbacks for a world without them.

**Built** (2026-11-20, `claude/story-0d42e5`), with two changes from this text, both at the coordinator's word:

- The hall is a live building, drawn by the story layer at `hall-0` in `src/world/story/places.json`, beside the home
  town's harbour, in the first frame. The world files, the start frame and the generator are unchanged. A baked
  `hall` site would win over it, if one is ever needed.
- The five stand at the points in `places.json`, chosen on renders; the next world build can carry them as `curio-*`
  sites (`scripts/story-places.ts`). Nothing is baked for them.

## 1. Summary

- All projects move to one hall next to the home town.
- The story is a quest. The visitor finds five odd things on the map.
- Each thing shows one fact about Daniel.
- There is no dialogue. The visitor lands. The thing moves. One line appears.
- The quest is opt-in. A visitor can explore freely instead, and join or leave the quest at any time.

## 2. How it works on a large map

The map is large. The five things are small. These rules make them easy to find and easy to use.

1. **The quest is offered after the lesson.** The first-flight lesson ends (steer, speed, leave). Then a small card
   asks one thing, with two buttons: **explore** or **follow the quest**. The card does not stop the flight. A visitor
   who has done the lesson on an earlier visit, but never answered, sees the card once, a few seconds into the flight.
2. **Join or leave later.** The options panel has one line: "follow the quest" or "leave the quest". The quest
   section of the Codex has a "follow the quest" button while the visitor is not on it.
3. **The first is near home. The others are across the world.** The first is 15 seconds from the start. Each of the
   other four is in a different climate, about 60 to 90 seconds of flight from the one before. The world loops, so
   the route is a circle that ends at home. The full quest takes about 8 minutes.
4. **They are easy to see.** Each has a tall red pennant until it is found.
5. **A floating arrow points the way, only on the quest.** It points to the nearest thing not yet found. While the
   thing is off the screen, the arrow sits at the screen's edge, on the line from the dragon to the thing. Once the
   thing is on the screen, the arrow floats over it and bobs. It goes when the thing is found.
6. **Landing is the interaction.** Near a thing, the usual prompt appears. The visitor presses Space or taps.
7. **The thing responds.** It plays a short animation, 3 to 5 seconds long.
8. **The visitor gets a keepsake.** One of five quatrefoils fills with a small icon. The pennant comes down.
9. **One line appears.** A small card shows one fact about Daniel.
10. **The visitor takes off.** Space or tap, as now.

Finds count whether or not the visitor is on the quest: an explorer who lands at one has found it. The five
quatrefoils show in the corner of the screen only on the quest; the Codex always shows them.

## 3. The hall

- One building next to the home town. It is in the first frame of a flight.
- Landing there opens the Codex with all projects in a list. A row opens that project's page (the page that exists
  now).
- The list takes any number of projects. It reads them through one function, `loadProjects()` in
  `src/lib/projects.ts`, which today returns the pinned repos from `src/lib/github.ts`. When the curated list exists,
  only that function changes. Nothing assumes six.
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

- Every page ends with the five quatrefoils. A found one shows its icon and its line. While the visitor is not on the
  quest, the section has a "follow the quest" button.
- The other six landmarks no longer offer a landing. They are scenery.

## 7. Phones

- The same steps. Tap to land. Tap to take off.
- The card is a small sheet at the bottom of the screen.
- The quest card's two buttons are at least 44 pt tall.
- The quatrefoils and the arrow do not overlap the touch controls.
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
- `src/world/story/quest.ts`: pure functions: the saved state (`world:quest`: on, off or not yet asked, and the stops
  found), when to offer the quest, the nearest stop not found, and where the arrow goes on the screen. Tested.
- `src/lib/projects.ts`: `loadProjects()`, the one way the hall gets its projects.
- `src/world/live/`: the sprites, animations and pennants. They use time and the seed only. No `Math.random`.
- `Codex.tsx`: the project list, the small card, the five quatrefoils.
- The quest card (beside `FlightCard.tsx`), and one line in `OptionsPanel.tsx`.
- `src/world/story/overlay.ts`: the five quatrefoils and the arrow, drawn into the frame after the dragon.
- `session.ts`: kept small, since the title session is changing it. It reads and saves the quest state, reports a
  find, and calls the overlay. Each find is also a discovery, so the caption and the buzz work as now.
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

## 11. Answered by the owner (2026-11-20)

1. Across the world: the first near home, the other four in four other climates.
2. The arrow: yes, as a floating arrow at the screen's edge, only on the quest.
3. The five: as in section 4. He can still swap any.
4. The quest is opt-in, offered at the end of the lesson.
5. The hall: approved.

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
