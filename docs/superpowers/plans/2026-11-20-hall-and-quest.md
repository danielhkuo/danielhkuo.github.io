# The hall and the quest of five: implementation plan

> **For agentic workers:** Cursor builds the tasks marked **Cursor**, from the brief in this plan, with
> `cursor-agent -p --force --model grok-4.7-xhigh "<brief>"` in this worktree. Claude (Opus) writes the failing tests
> first, reviews every diff, and builds the tasks marked **Claude** (art, judged on renders). Steps use `- [ ]`.

**Goal:** Projects move to one hall; landing at five odd things across the world is an opt-in quest that teaches a
visitor five facts about Daniel.

**Architecture:** Pure modules under `src/world/story/` (stops, quest state, arrow placement) hold all the logic and
are unit-tested. A small store (`src/app/world/questStore.ts`) shares the quest between the frame loop and React. The
frame loop draws the stops (a live layer) and the arrow and count (an overlay after the guide). The Codex gains the
hall's list, a stop's card and the quest section.

**Tech stack:** TypeScript, Next.js static export, `node --test`, Playwright e2e.

**Spec:** `docs/superpowers/specs/2026-11-19-story-destinations-design.md` (draft 5, approved 2026-11-20).

## Global constraints

- World code is deterministic: no `Math.random`, no `Array.prototype.sort`, no `Math.sin/cos/atan2/hypot` under
  `src/world/sites/` or `src/world/story/` (use `core/psin.ts`: `psin`, `pcos`, `patan2`).
- Nothing assumes six projects, or any count.
- Storage is guarded: a store that throws, or none, still works for the visit.
- The five stops' sprites, animations and pennants, the arrow's look and the quatrefoils' look are judged on renders
  by Claude. Cursor never ships them alone.
- `src/app/world/session.ts` is being changed by the title session: add at most ~40 lines there, in two places (after
  `stepped.landed`, and after the guide is drawn).
- Plain wording in every visible string. The five lines are fixed by the spec's section 4 table.
- Commits end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Nothing is pushed.

## Review focus

1. Storage holding junk (`world:quest` = `"x"`, `{found: [1, "nope"]}`): parse to "not yet asked", keep only known
   stop keys. Test in Task 2.
2. A stop straddling the world's wrap (target 30 cells east of x = n − 10): nearest-stop and arrow use torus
   distance. Test in Tasks 2 and 3.
3. The arrow when the target is exactly under the dragon or behind it (dx = dy = 0, or straight down): a finite
   position on the edge, never NaN. Test in Task 3.
4. A build with no world, or a world with no curio places: no stops, no arrow, the hall still on the town. Test in
   Task 4.
5. All five found, then "leave the quest" and "follow the quest" again: the count stays five and no arrow shows. Test
   in Task 2.

---

### Task 1: the projects source (replaced)

The coordinator's `world/projects` branch adds `src/lib/projects.ts` (`Project`, `loadProjects()`: one Markdown file
per project in `projects/`). This plan does not write a loader. Until that branch is merged, `landmarks.ts` declares
`HallProject` with the same shape, and `page.tsx` adapts the pinned repos to it; at the merge, `HallProject` becomes
`import type { Project }` and `page.tsx` calls `loadProjects()`.

### Task 2 (Cursor): stops and the quest state

**Files:** Create `src/world/story/stops.ts`, `src/world/story/quest.ts`, `src/world/story/quest.test.ts`; modify
`src/components/terminal/content.ts`.

**Interfaces:**
- `content.ts`: `INTERESTS: readonly { key: string; line: string }[]` with keys `bonsai`, `reading`, `faith`,
  `homelab`, `basketball` and exactly the spec's five lines.
- `stops.ts`: `type StopKey = "pine" | "desk" | "bell" | "mill" | "basket"`;
  `STOPS: readonly { key: StopKey; interest: string; name: string; icon: StopKey }[]` in that order, `name` being what
  the land prompt says: `"the small pine"`, `"the desk"`, `"the bell"`, `"the mill-shed"`, `"the basket"`.
- `quest.ts`:
  - `QUEST_KEY = "world:quest"`; `type QuestMode = "unasked" | "on" | "off"`;
    `interface QuestState { mode: QuestMode; found: StopKey[] }`.
  - `parseQuest(raw: string | null): QuestState` and `questText(s: QuestState): string`.
  - `choose(s, mode: "on" | "off"): QuestState`; `find(s, key: StopKey): QuestState` (adds once, in order found,
    whatever the mode); `complete(s): boolean` (all five found).
  - `offerDue(s: QuestState, lessonDone: boolean): boolean`: true only when `lessonDone` and mode is `"unasked"`.
  - `nextStop(s, from: {x, y}, places: readonly StopPlace[], n: number): StopPlace | null` where
    `interface StopPlace { key: StopKey; x: number; y: number }`: the nearest unfound place by torus distance, ties by
    STOPS order; null when mode is not `"on"` or none is left.

- [ ] Tests (each one assertion block, exact values):
  - `parseQuest(null)`, `parseQuest("x")`, `parseQuest('{"mode":"maybe"}')` → `{ mode: "unasked", found: [] }`.
  - `parseQuest('{"mode":"on","found":["desk",1,"nope","desk","pine"]}')` → `{ mode: "on", found: ["desk", "pine"] }`.
  - round trip: `parseQuest(questText(s))` deep-equals `s`.
  - `find` twice with `"bell"` → `found` is `["bell"]`; `find` while `mode: "off"` still adds.
  - `offerDue({mode:"unasked",found:[]}, false)` false; `(…, true)` true; `({mode:"off",…}, true)` false.
  - `nextStop` with n = 1000, from `{x: 990, y: 500}`, places pine at `{x: 20, y: 500}` and desk at `{x: 900, y: 500}`
    → pine (30 cells across the wrap, against 90).
  - `nextStop` returns null with mode `"off"`, and null once all five are found.
  - every `STOPS[i].interest` is a key of `INTERESTS`; `STOPS.length === 5`; keys unique.
  - after five finds, `choose(s, "off")` then `choose(s, "on")`: `found.length === 5`, `nextStop(...) === null`.
- [ ] Run, see them fail; implement; run, see them pass; commit.

### Task 3 (Cursor): where the arrow goes

**Files:** Create `src/world/story/arrow.ts`, `src/world/story/arrow.test.ts`.

**Interfaces:** `arrowAt(target: {x, y}, fw: number, fh: number, margin: number):
{ mode: "edge" | "over"; x: number; y: number; angle: number }`. `target` is the stop's ground point in frame pixels
(from `guideAnchor`), which may lie far off the frame. `angle` is radians, 0 east, π/2 south (screen down).

Rules: if the target lies inside the frame inset by `margin` on every side → `"over"`, at `(target.x, target.y − 14)`,
angle π/2 (pointing down at it). Otherwise `"edge"`: the point where the ray from the frame's centre toward the target
meets the rectangle inset by `margin`, rounded to whole pixels, with the angle of that ray.

- [ ] Tests with fw = 400, fh = 225, margin = 12:
  - target (200, 100) → over, (200, 86), angle ≈ π/2.
  - target (2000, 112) → edge, x = 388, |y − 112| ≤ 1, angle ≈ 0.
  - target (200, −5000) → edge, y = 12, x = 200, angle ≈ −π/2.
  - target (−900, 900) → edge, on the left or bottom inset edge, both coordinates within [12, 388] × [12, 213].
  - target at the centre exactly (200, 112) → over (never NaN).
  - for 64 targets round a circle of radius 3000, every result is finite and on the inset rectangle's border.
- [ ] Use `patan2` from `src/world/core/psin.ts`. Implement; pass; commit.

### Task 4 (Cursor): places, landmarks and the hall

**Files:** Modify `src/world/sites/landmarks.ts` (+ test), `src/app/world/page.tsx`, `src/app/world/session.ts`
(only `offerName` and the probe's `landmarks` map), `e2e/site/landing.spec.ts`. Delete `src/world/sites/assign.ts`'s
`assignSites` and its test cases, `src/world/landmarks.config.ts`, `src/world/sites/assignments.json`. Keep
`LandmarkType` and `featureFor` (the generator imports them). Create `src/world/story/places.json`.

**Interfaces:**
- `Holding = { kind: "about" } | { kind: "hall"; projects: ProjectEntry[] } | { kind: "stop"; stop: StopKey }`.
- `landmarksFor(manifest, projects: readonly ProjectEntry[], places: unknown): { set: LandmarkSet }`. Landmarks are:
  the abbey (`about`); a site of type `hall` if the manifest has one, else `town-0`'s site (`hall`); one per stop, from
  manifest sites of type `curio` with ids `curio-pine` … if present, else from `places.json` when its `worldId`
  matches (`{ worldId, stops: { pine: {x, y}, … } }`), else none. The other landmark kinds are not landmarks any more.
  A stop's `type` is a new `LandmarkType` member `"curio"`; `anchor.ts` gives it `SEARCH` 12 and `FALLBACK` 10.
- `discoveryOf`: `landmark:abbey`, `landmark:hall` ("The hall: every project"), `story:<key>` (the stop's name).
- `registerFrom` is removed with the Codex's register.
- `offerName`: the abbey "about me", the hall "the projects", a stop its `STOPS` name.
- Probe `landmarks`: `{ id, holds, name }` where name is the stop key or null.

- [ ] Tests in `landmarks.test.ts`: a manifest with abbey, town and windmill sites and a matching places file → four
  landmarks of five (abbey, town as hall, and the stops given), the windmill absent; the hall holds all 9 of 9
  projects; a places file for another world → no stops; a manifest with `hall` and `curio-desk` sites uses them over
  the town and the file.
- [ ] e2e: the "project's landmark" test lands at the hall, sees its list, opens one row, goes back.
- [ ] `places.json` starts as `{ "worldId": "", "stops": {} }` (Task 9 fills it). Implement; `npm test`,
  `npx tsc --noEmit`, `npm run lint` pass; commit.

### Task 5 (Cursor): the quest store, the offer, joining and leaving

**Files:** Create `src/app/world/questStore.ts`, `src/app/world/QuestCard.tsx`; modify `src/app/world/Flight.tsx`,
`src/app/world/OptionsPanel.tsx`, `src/app/world/session.ts` (≤ 15 lines), `src/app/world/useFlight.ts`.

**Interfaces:**
- `questStore`: `get(): QuestState`, `set(next: QuestState): void` (saves under `QUEST_KEY`, guarded),
  `subscribe(fn): () => void`; a hook `useQuest(): QuestState` over `useSyncExternalStore`.
- Session: on `stepped.landed` at a stop, `questStore.set(find(questStore.get(), key))`; a new event
  `lessonDone()` fired once when the lesson is done this visit, or at load when it was done before.
- `QuestCard`: shown when `offerDue(quest, lessonDone)`, 4 s after `lessonDone` fires. Drawn like `FlightCard` (same
  `card.module.css`, `cardPlate`, `PixelGlyph`), non-modal, not pausing the flight. Title "the quest"; one line
  "five odd things are out there."; two buttons "explore" and "follow the quest" (lit). Each sets the mode and closes it.
  Keys: Q follows, Esc explores, while it shows.
- `OptionsPanel`: one `Action` under "show the lesson again": "follow the quest" when mode ≠ on, else "leave the
  quest".

- [ ] Unit test for `questStore` with a fake storage: set → saved text; a throwing storage → `get()` still returns
  what was set.
- [ ] e2e (`e2e/site/flight.spec.ts`): with the lesson stored as learned and no quest stored, the card shows within
  6 s; "follow the quest" stores `{"mode":"on",…}`; the options panel then says "leave the quest".
- [ ] Implement; checks pass; commit.

### Task 6 (Cursor): the Codex

**Files:** Modify `src/app/world/Codex.tsx`, `src/app/world/codex.module.css`, `src/app/world/Flight.tsx`.

- Hall page: rubric "¶ The hall", title "Projects", then one row per project (name, description, language) as
  buttons; a row opens the existing project page with a "Back to the hall" button first. Any count; scrolls.
- Abbey page: as now, without the register.
- Stop page: rubric "¶ Found", the keepsake icon (an SVG from `src/world/story/icons.ts`, Task 8), the stop's
  `INTERESTS` line, and on the pine's page a second line "Try `cbonsai` in the terminal at the abbey."
- Every page ends with a section "The five": five quatrefoils (the existing `Quatrefoil`, filled when found), each
  found one with its icon and line; when `mode !== "on"`, a button "follow the quest". After all five, the line "That
  is all five." and an email link (`LINKS.email`).
- [ ] e2e: landing at a stop's place (via `?at=`) fills one quatrefoil in the Codex and stores the find.
- [ ] Implement; `npm run a11y` stays clean; commit.

### Task 7 (Claude): the arrow and the count in the frame

**Files:** Create `src/world/story/overlay.ts`; modify `session.ts` (≤ 15 lines, after the guide).

- `drawQuest(frame, fw, fh, quest: QuestState, arrow: ReturnType<typeof arrowAt> | null, t: number, reduced: boolean)`:
  five small quatrefoils top-left (filled vermilion when found), shown only while mode is `"on"`; the arrow, a pixel
  sprite rotated to the nearest of 16 directions, bobbing 2 px over 1.2 s in `"over"` mode (still under `reduced`).
- [ ] Judge on frame strips (start view, edge mode in four directions, over mode at a stop) at 1× and 3×.

### Task 8 (Claude): the five things, their animations and pennants

**Files:** Create `src/world/live/story.ts` (a live layer), `src/world/story/icons.ts`; register the layer in
`src/world/live/registry.ts` with the stop places in `LayerContext` (`stops?: readonly StopPlace[]`), and a
`found?: () => readonly StopKey[]` so a found stop's pennant is down.

- Each stop: its tableau sprite at rest; on landing (found within the last 5 s), its animation from the spec's table;
  a pennant (vermilion, the dragon's colour, via the uncapped dragon palette) while not found.
- [ ] Judge on `npm run world:live -- --at x,y` strips per stop, at rest, animating, found; day and dusk.

### Task 9 (Claude): places in the present world, and the site list

- [ ] A script (`scripts/story-places.ts`) reads the shipped world and proposes, per stop, open level land in its
  climate (pine: home island ~15 s from the start; desk: steppe; bell: tundra; mill: Mediterranean; basket: savanna),
  ≥ 300 cells from sites and wonders, 60–90 s apart round the loop. Write `places.json`; view each on a render.
- [ ] Send the coordinator the site list for the next world build (spec section 9, with the chosen points).

### Task 10 (Claude): audit

- [ ] Fresh Opus critics on renders and strips: each stop at rest and animating, the arrow, the count, the card, the
  Codex pages on desktop and phone. Fix what they find. Full checks: `npm test`, `npx tsc --noEmit`, `npm run lint`,
  `npm run a11y`, e2e, `scripts/world-fly.mjs` frame time against the base. Report the merge point.
