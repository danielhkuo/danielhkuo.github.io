# The hall and the story's destinations

Status: a design for the owner, written by Fable and read by an Opus critic (2026-11-19). Nothing here is built, and
nothing is to be built until the owner approves it. **[Call]** marks a choice of Fable's that the owner can overturn.
**[Ask 1]** to **[Ask 3]** mark the three questions sent to him: the cast, the gloss, and the hall. It supersedes `2026-11-18-a-simple-story.md` (whose tone it
keeps) and the project half of `2026-11-18-landing-and-codex-design.md`.

Rough pictures: `2026-11-19-story-destinations-options.html`, beside this file (three looks for the hall, and three
of the five curios).

## 1. What the owner asked for

**[Owner, 2026-11-19]** The landmarks stop being projects. The projects go in one place "right adjacent to the main
town that we started off in". The story is "an independent thing", "kind of fun", "a get to know Daniel": places you
fly to, each showing one of his interests, "kind of interactable", in the manner of *The Little Prince*, with a bonsai
where that book has a rose and a novelist at a desk where it has a king. "We can just make them different."

**[Owner, 2026-11-19, later]** His interests, in his words and his order: his Unraid home lab; startups (he worked on
one); open source ("very pro", knowing the economic trade-offs); ethics and philosophy of technology, from his
Christian background, and theology, personhood and AI; helping other people get software and hardware projects off the
ground (VPN servers among them); mechanical keyboards and Franken switches; basketball (a Rockets fan, plays, "can't
really shoot very well"); the cello, which he used to play a lot; reading, "a big passion"; Apex Legends and its
competitive scene (peak Masters); raised in Houston, a Rice graduate, born in New Jersey.

**[Owner, 2026-11-19, on the first draft of this document]** "The idea was to make it like a quest. You quest to get
the five whatever, and each step you learn a little bit more about me. That's the little fun of it. Doesn't need to be
a building. It could be an interesting looking tree, or a weird looking [thing]... It doesn't have to be buildings.
Think of Little Prince." The first draft put a resident at each landmark and refused a count; both are changed here.

Still standing from earlier: simple, about people, no lore, no names, no history; original work only; church-built
ornament only; deterministic world code; visual work judged on renders.

**Goals.** A small quest: five stops, five keepsakes, and at each one the visitor learns one more thing about Daniel.
Each stop is a strange small thing in the land that makes a flier turn and look. Each is over in under a minute and
asks for one kind of input. A recruiter still finds every project in one landing, ten seconds from the start.

**Not goals.** A plot, lore, a score, a timer, a way to fail, or anything that keeps a visitor from a project or from
leaving.

**Would make it a failure.** A stop a reader recognises from another book. A stop that reads as a résumé line in
costume. A quest that nags.

## 2. Approaches

**A. Five curios: a quest. [Call] This one.** Five odd things stand out in the land, each of them somebody's work: a
pine one hand high under a huge yew, a desk alone in a hay meadow, a bell on a bare hill with an oak figure to strike
it. None is a building and none is one of the seven landmarks, which stay as scenery. The visitor collects one
keepsake at each, five quatrefoils fill, and the fifth ends the quest. They are small live sprites on level ground, so
they need almost nothing from the generator, and the five can be swapped without touching the world.

**B. Keepers at the landmarks** (the first draft). A resident at each of the seven landmarks. It reuses what is
built, but every stop is a building, the count is seven because the landmarks are, and the owner has said no to both.

**C. Islets.** Every resident on a tiny island of their own. One person alone on one tiny world is the single most
recognisable picture in the book we are borrowing a tone from, and it needs new land in the biomes session's files.

## 3. The hall

- **What it is.** One building beside the home town, between the town and the point where flight starts, so it is in
  the first frame. Landing there opens the projects, all of them, in the Codex.
- **Its look. [Ask 3]** Three sketches on the options page: a long timber-roofed hall with a lantern on its ridge; a
  cloth hall on the quay with an open arcade; a library with tall traceried windows. **[Call]** The long hall: it
  reads at 1× as none of the seven landmarks, and "everything under one roof" is what it has to say.
- **What it shows.** A rubric ("¶ The hall"), then one short paragraph, then the projects as rows (name, one line,
  language), each opening that project's page: the page the Codex shows today (description, ledger, links), with a
  "Back to the hall" button. Below the rows, a link to the minimal version.
- **The paragraph**, which also carries his view of open source:

  > Everything Daniel has built is kept in this hall, and none of it is locked up. Take any of the plans home. You
  > will still have to build it yourself.

- **One source.** The rows are the pinned repos from `src/lib/github.ts`, passed in by the page as they are today.
  Nothing about a project is written anywhere else. The order is GitHub's pin order, as on `/minimal`.
- **Until the building exists** (it needs a world build), the town landmark opens the hall's page. That is approach A's
  answer, and it is a fair first step: the page and the retirement below can ship before the new world does.

**What retires**

- `src/world/sites/assignments.json`, and the warning in `src/app/world/page.tsx` that prints a new one. No build
  re-pins anything again, and a new world no longer moves a project.
- `assignSites` and its tests in `sites/assign.ts`, and `src/world/landmarks.config.ts`. (`LandmarkType` and
  `featureFor` stay: the generator imports them.)
- In `sites/landmarks.ts`: `Holding`'s `project` and `none`, `stickyFrom`, `stickyText`, `landmarksFor`'s matching,
  and `discoveryOf`'s `landmark:repo:<name>` ids. A returning visitor's old ids stay in storage and are ignored.
- In the Codex: "Kept at the windmill", the "Unclaimed" page, and the register "Where the work is kept".

## 4. What the Codex becomes

It keeps its name, its leaf, its corners and its place on the screen. It has three kinds of page, and one section they all end with:

| Landing at | The page |
|---|---|
| The hall | The projects (section 3), and from a row, one project |
| The abbey | About me, the links and the terminal button, exactly as now |
| A curio | The encounter: a rubric, three to five sentences, one thing to do, what came of it, the keepsake |
| Every page | Its last section, "The five": the quest (section 7) |

The other six landmarks no longer offer a landing. **[Call]** They are scenery and the homes of the sights; a landing
that opens an empty page is worse than none.

An encounter's page, top to bottom: the rubric (the place); the text; the one thing to do, as one to three real
buttons; then, once done, the line that came of it, and under a thin rule the gloss: one plain rubricated sentence
about the real Daniel. Take off is always there, before and after.

**The gloss. [Ask 2]** The fable never says "Daniel". The gloss does, once, in one line, and it is what makes this
"get to know me" and not only a set of fables. **[Call]** Keep it. Each gloss is a plain fact from a new `INTERESTS`
list in `src/components/terminal/content.ts` (`{ key, line }`), which reads the same anywhere, so the minimal version
and the agent files can list the same lines and no fact about him is written twice. Where the Codex adds a pointer of
its own (the pine's "type `cbonsai`"), that pointer belongs to the encounter, not to `INTERESTS`.

**Met** means the act is done. Landing and leaving without doing anything changes nothing, and the pennant stays up.

## 5. The residents

Rules for all of them, kept from the earlier story: nobody has a name; nobody has a past beyond what one person
remembers; three to five sentences; each stands alone, in any order; every resident is liked, none is there to be
found foolish; nothing a visitor does is wrong.

Each entry gives the interest, the place, the text, the one thing to do, what comes of it, the keepsake and the gloss.
The text is a first draft for the owner's ear, to be edited freely.

### The five. [Ask 1]

**[Call]** These five, because between them they show a tender, a reader, a thinker, a tinkerer and a player, and each
is a different thing to look at and a different thing to do. The owner chose the first two. Any of the six in "the
bench" below can take a place.

**5.1 The small pine.** *Interest: the bonsai (owner's choice), and patient tending. The terminal's `cbonsai` grows
one.* **Looks like:** one enormous dark yew alone on a rise, and at its foot, on a flat stone, a pot.

> On a flat stone, under a yew nine hundred years old, stands a pine one hand high. The yew got that big by
> being left alone. The pine got that small by being cut back a little, every spring, for forty years. Somebody has
> put the shears down beside it and gone in for dinner.

- **Do:** "Take one needle" or "Leave it be".
- **Taken:** "You take one needle. Nobody will be able to tell for three years."
- **Left:** "You leave it. Most days, that is all the work there is."
- **Gloss:** "¶ Daniel likes work that is tended a little at a time." **[Ask 1]** If he keeps a bonsai, the line
  should say so. **Pointer:** "There is one in the terminal at the abbey: type `cbonsai` and wait."
- **Keepsake:** a pine cone the size of a fingernail.
- **Resident:** the tree, which says nothing, and whoever went in for dinner, who is never seen.

**5.2 The novelist.** *Interest: reading (owner's choice of resident).* **Looks like:** a writing desk and a chair in
the middle of a hay meadow, with a path mown to it and a hay wain waiting at the gate.

> A woman has set her desk in the middle of a hay meadow, where the light is good until four. Her books are stacked
> under a tarred cloth beside it: other people's, a few hundred. She has written one sentence of her own this
> year and is short of its last word. "I read a great deal for very little writing," she says. "I would have read
> them anyway."

- **Do:** she turns the page round. *The dragon landed, and the afternoon went ___.* Choose "quiet", "sideways" or
  "on without them".
- **After:** "She writes it in, looks at it, and says it will do until Thursday."
- **Keepsake:** the word, and the sentence it finished.
- **Gloss:** "¶ Daniel reads a great deal, and would sooner talk about a book than most things."

**5.3 The bell-striker.** *Interest: ethics and theology of technology; personhood; AI.* **Looks like:** a bell
hung in a timber frame on a bare hill, and beside it a man-high figure of oak with a hammer.

> On a bare hill a bell hangs in a timber frame, and a figure of oak with a hammer strikes the hours on it. The
> brother who walks up from the abbey to wind him says good
> morning to him, and has for thirty years. "I know what he is made of. I re-hung his hammer twice," he says. "But
> I was made too, out of less, and I am spoken to every morning." He asks if you will say good morning too.

- **Do:** "Say good morning" or "Say nothing".
- **Said:** "The figure strikes eight. He was going to anyway."
- **Not said:** "The brother nods. 'He has never minded,' he says. 'That is the part I think about.'"
- **Gloss:** "¶ Daniel thinks a good deal about what we owe the things we make. His faith is where he starts from."
  **[Ask 2]** This is the one gloss that names his faith; it is his to keep or cut.
- **Pointer:** "There is another made thing in the terminal at the abbey, which answers when spoken to."
- **Keepsake:** the hour he struck.

**5.4 The contraption.** *Interest: the home lab.* **Looks like:** a squat mill-shed no bigger than a cart, with
sails, a water wheel, one flue and a bell on a pole.

> The thing on the rise grinds corn. It also pumps the well, saws planks, turns a spit, and rings a small bell in the kitchen when
> the post comes. The man who lives beside it built all of that himself, in the evenings, and the town would have done any of it for a
> shilling. "Then I wouldn't know how it works," he says. He is fitting a seventh thing now and will not say what it is.

- **Do:** "Pull a lever": one of three, and the visitor may pull each. Each does one small thing in the scene: a
  flag runs up the pole; the kitchen bell rings; a hatch opens and a hen walks out. The quest keeps the last pulled.
- **After:** "'Does it need to do that?' 'No,' he says, very pleased."
- **Gloss:** "¶ Daniel runs a home lab on Unraid, mostly for the pleasure of knowing how it works."
- **Keepsake:** a spare cog, which he says he will not miss.

**5.5 The basket.** *Interest: basketball.* **Looks like:** a dead oak, grey and bare, at the edge of a field,
with a basket nailed halfway up it.

> A tall boy has nailed a peach basket to a dead oak and is throwing a ball at it. He misses, fetches it, and
> misses. "I'm better than I look," he says, and then, being honest, "not by much." He holds the ball out.

- **Do:** "Throw": a mark swings across the basket; press when it is over the rim. As many throws as the visitor
  likes; the quest keeps a basket once one is made.
- **Missed:** "It hits the trunk. He fetches it for you. 'That's most of the game,' he says. 'Fetching.'"
- **In:** "It goes in. He looks at the basket, then at you. 'Do it again,' he says, 'slower.'"
- **Gloss:** "¶ Daniel plays basketball, not well, and follows the Houston Rockets closely."
- **Keepsake:** a peach stone from the bottom of the basket.

### The bench

Six more, written and checked, for the owner to swap in or keep for a second quest. They were drafted for the first
approach, so three of them stand at a landmark (the lighthouse, the old bridge, a barn); any that is chosen is given a
curio of its own and a keepsake.

**5.6 The cellist.** *Interest: the cello, which he used to play.*

> The keeper used to play the cello every evening, in a town, for people in chairs. Now he plays only in fog: one long
> low note from the gallery, so the boats know where the rocks are. He says the boats are the better audience.

- **Do:** "Draw the bow": hold the button and the note sounds (one low string from the sound engine); let go and it
  stops. A tap gives two seconds of it.
- **After:** "It is not a good note. Out on the water, a fishing boat turns a little to the left."
- **Gloss:** "¶ Daniel played the cello for years. He doesn't play much now, and still loves it."

**5.7 The boat on the plain.** *Interest: startups.*

> Beside the old bridge three people are building a boat, a big one, much too big for this river. The sea is four days
> off. "We'll find out about the sea when we get there," says the one with the mallet. They built a boat before. It
> floated for most of a summer, and she speaks of it the way people speak of a good dog.

- **Do:** "Drive a peg".
- **After:** "You drive one peg. She taps it twice, says it will hold, and says it is a little bit your boat now."
- **Gloss:** "¶ Daniel worked on a startup once, and will talk about startups for as long as you let him."

**5.8 The kite.** *Interest: helping other people get a project off the ground.* No landing. It is
on the home island, seconds from the start, and is most visitors' first encounter.

> (caption, flying near) A child in the long meadow has run with a kite all morning. It gets as high as her head and
> comes down.

- **Do:** fly past her, close. The air off the dragon takes the kite up.
- **After (caption):** "The kite is up. The first ten feet were the hard part. She does not look round."
- The meadow flies a pennant until the kite is up. With no page of its own, its gloss follows its line in the quest section.
- **Gloss:** "¶ Daniel likes little better than helping somebody get a project off the ground."

**5.9 The key-fitter.** *Interest: mechanical keyboards and Franken switches.*

> A woman at a bench is building a small organ one key at a time. She took the spring from one old instrument and the
> stem from another, because each of them was nearly right. Three finished keys lie in front of her. "Press them,"
> she says. "One of them is correct."

- **Do:** press each of three keys (three different sounds), then choose one.
- **After:** "'That one,' she agrees. She would have agreed with any of them. 'Fifty-eight to go.'"
- **Gloss:** "¶ Daniel builds mechanical keyboards, and mixes the parts of different switches until one feels right."

**5.10 The tide ring.** *Interest: Apex Legends and the people who play it for a living.*

> On the sand below the jetty nine children play tag in threes, inside a ring the tide keeps making smaller. An old
> man rakes the ring's line fresh each tide. He knows every child's name, and which of them laughs when caught.
> "Watch the three by the rock," he says.

- **Do:** choose which three will be last in the ring, and watch for eight seconds. The three by the rock always are.
- **Chose them:** "The three by the rock, as he said. He usually knows, and says that is the whole pleasure of it."
- **Chose others:** "The three by the rock. He does not say he told you so. He rakes the line.""
- **Gloss:** "¶ Daniel plays Apex Legends, and follows the people who play it far better than he does."

**5.11 The fingerpost.** *Where he is from.* At the start point, read in passing; no landing and nothing to do.

> (caption) A post with three arms. One says *born by a colder sea*. One says *raised here, where the river
> is slow and brown*. One says *schooled a short walk off, among the owls*.

- **Gloss:** "¶ Born in New Jersey, raised in Houston, studied at Rice."

### Where they stand

In any order. They are laid out so the quest widens: the pine on the home island, about fifteen seconds from the
start; the bell-striker on the hill above the abbey; the desk on the home island's far side; the contraption and the
basket each across water, in another climate. A visitor who only wants a taste gets one in the first half minute.

**Small rules, so the builder need not ask**

- The prompt names the thing, not a person: "Land by the yew", "Land by the desk", "Land by the bell".
- The basket is met on the first throw, made or missed, and its pennant is struck then. A later basket replaces a miss
  in the quest's line; a later miss does not replace a basket.
- A keepsake is fixed for its curio. Only the novelist's word changes when the visitor chooses again.
- The coil lies round the tableau, not round the yew: at the pine, the stone stands clear of the trunk to the south.

## 6. Finding them

- **The opening caption,** in the strip the discovery captions use: "Five odd things stand out past the town, each of
  them somebody's work. Go and see."
- **Five quatrefoils** in a corner of the flight view, the title screen's bullets: empty, and filled vermilion one by
  one. It is the whole of the quest's interface while flying.
- **A pennant.** Each curio not yet met flies a small vermilion pennant: a live sprite, so it can be the one red thing
  in the land (`RESERVED_SECTOR` in `render/palette.ts` keeps baked land out of that sector). It is struck once the keepsake is taken.
- **The quest section of the Codex** names each one still out there by compass point and seconds of flight, nearest
  first, as the register does now.
- **The prompt to land** is the one in the world today, and names the curio ("Land by the desk").
- **Nothing points while flying.** No arrow and no minimap. **[Call]** The pennants and the Codex's directions are
  enough for five, and finding them is the fun of it.

## 7. The quest: what the Codex logs, and the ending

- **"The five"** is the last section of every Codex page: five quatrefoils, and under each one met, its keepsake, one
  line saying what the visitor did there, and its gloss. Those not yet met show an empty quatrefoil, a compass point
  and seconds of flight, and only what they look like ("a dead oak in a field").
- **The lines** (the five, then the bench):
  - "Under the yew, you took one needle from the pine." / "Under the yew, you left the pine alone."
  - "In the meadow, the afternoon went sideways." (the word chosen)
  - "On the hill, you said good morning to the bell-striker." / "On the hill, you said nothing, and nobody minded."
  - "At the contraption, you pulled a lever, and a flag went up." (or: a bell rang; a hen came out)
  - "At the dead oak, you made the basket." / "At the dead oak, you missed, and he fetched it."
  - "At the lighthouse, you played one note into the fog." "By the bridge, you drove one peg of a boat." "In the long
    meadow, a kite went up as you passed." "At the workshop, you chose the second key." "On the strand, you picked
    the three by the rock." / "On the strand, you picked wrong, and watched anyway."
- **Storage.** One new key, `world:story`: an object from encounter key to the id of the outcome (`"left"`,
  `"sideways"`, `"hen"`). Lines and the novelist's sentence are rebuilt from the id; no text is stored. Each keepsake
  is also a discovery (`story:<key>`), so the existing caption and phone buzz announce it. Storage refused: it works
  for the visit and forgets.
- **Doing it again.** A visitor can land again and choose again. The latest is kept; the keepsake is not lost.
- **The ending.** The fifth keepsake fills the fifth quatrefoil, the caption says "That is all five.", and the quest
  section closes with one line:

  > Those are five of the things Daniel cares about. If you would like to tell him yours:

  followed by the email link from `content.ts`. Nothing unlocks and nothing else changes. A visitor who finds two and
  leaves has had two.

## 8. Phones

- The Codex is already a sheet along the bottom on a phone. Encounter text is at most five sentences so the scene
  stays in view above it.
- Every "do" is a real button at least 44 pt tall. Nothing depends on hover, a keyboard or a held key: the bow has its
  tap, the throw is one tap, the kite needs only flying.
- Sounds (the note, the three keys, the kitchen bell) follow the sound toggle; with sound off each has a visible
  result, and the text never depends on having heard anything.
- The discovery buzz that exists fires when an encounter is done.
- Reduced motion: the swinging mark of the throw becomes three plain buttons ("Short", "Just so", "Long"), of which
  the middle one goes in.
- The five quatrefoils sit clear of the touch controls and are not buttons.

## 9. What is not borrowed

Said plainly: a traveller who meets one person at each stop is that book's shape, and the owner asked for it. The
bonsai and the novelist were chosen by him as replacements for two of its figures. Everything else is kept away from
it, and an Opus critic read every resident and line against the book and against other well-known works (section 12).

- **Not used:** a rose or any talking, vain or sheltered plant; a king or anyone who commands; a lamplighter or any
  lamp tended to orders; a fox, taming, or ties; a man who counts or owns; a geographer; a drinker; a man who wants
  applause; a snake; baobabs; a planet or asteroid of one's own; a prince; an aviator; a well in a desert; any
  quotation.
- **Kept clear of on purpose:** the pine says nothing, wants nothing, is not watered, sheltered or called the only one
  of its kind. The novelist asks and does not command. Nobody here is lonely on a small world: they stand in fields
  on a shared land, with dinners to go in to and an abbey to walk up from. The quest collects keepsakes, not lessons;
  no resident states a moral.
- **Other works checked:** the bell-striker is a real kind of church clock figure (a jack); it is oak, wound and not
  oiled, wants nothing, does not come alive, and nobody here carved it. The boat is beside a river, built by three
  people who have done it before, and is not an ark. The basket is how the game began, which is history and nobody's
  property. The children on the strand play tag, and everybody caught laughs.

## 10. What the biomes session needs to provide

For the coordinator to pass on. Nothing in that branch is edited from here.

1. **A new site kind, `hall`,** on the home island: its own building within 150 cells of `manifest.start`, on the side
   the start heading faces, standing in the start frame, with a level pad a coil of radius 12 can lie on. This changes
   the home start frame once, knowingly: the byte-for-byte promise for home has to be re-pinned after it.
2. **Five curio sites** in the manifest (`curio-0`…`curio-4`), each a level, open pad about 24 cells across with
   nothing built on it, at least 300 cells from any landmark or wonder: one about 15 s of flight from the start, two
   more on the home island, two on other islands in two different climates. The generator already places small
   features at spare candidates (`featureFor`, and the `occupied` option in `gen/settle.ts`).
3. **One baked tree.** The yew of 5.1 is too big for a live sprite: a single large yew stamped at `curio-0`, like the
   churchyard yew without its church. Everything else at a curio is a live sprite and asks nothing of the bake.
4. **Nothing of the seven landmarks.** They keep their sites and their climates as that session has them.

Until these exist, the quest can be built and judged on the present world: the town opens the hall, and the curios
stand at five of the present world's spare landmark sites, with the churchyard yew standing in for the pine's.

## 11. The code changes

- **`src/components/terminal/content.ts`:** `INTERESTS`, a list of `{ key, line }`: the glosses.
- **`src/world/story/`** (new, no React):
  - `encounters.ts`: the residents as data, keyed by curio: what it looks like, the text, the act (`choose`, `once`,
    `hold`, `timed`, `pass`), the line and the quest line for each outcome, the keepsake, and the key of its gloss. The fiction lives here and nowhere else.
  - `progress.ts`: pure functions over the stored record: what is met, the quest's lines, the count, whether it is
    complete. Tested.
  - `tableau.ts`: where each tableau stands on its curio's site, and its few frames, by time and
    seed. No `Math.random`.
- **`src/world/sites/landmarks.ts`:** the places a flier can land become the abbey, the hall and the curios;
  `Holding` becomes `about | hall | encounter`; `registerFrom` lists curios not yet met; the retirements of section 3.
- **`src/world/sites/anchor.ts`:** a rest radius for `hall` and for a curio (the coil lies round the tableau).
- **`src/world/live/`:** the pennants and tableaux as live sprites, registered like the present sights.
- **`src/app/world/Codex.tsx`:** the four pages of section 4; the hall's rows and project page (the present project
  body, reused); the encounter page with its act; the quest section. `codex.module.css` gains the rows, the act buttons and
  the swinging mark.
- **`src/app/world/session.ts`:** a second store beside the discoveries (`world:story`); the five quatrefoils in the
  flight view (`Overlays.tsx`); an event to the live layer when an act has a result in the scene (the pennant, the hen).
- **`src/app/world/page.tsx`:** passes the pinned repos to the hall and stops matching them to sites.
- **`src/world/sound/`:** one bowed low note, three key sounds, a small bell: the sound session's to shape.
- **Other pages:** `/minimal` and the agent files may list `INTERESTS`. That is their sessions' choice, not part of
  this work.
- **Tests:** `progress.ts` and the encounter data (every encounter has every outcome's lines and a gloss that exists; a
  landed encounter's text is three to five sentences, a caption one to three); the Codex's pages in the e2e suite, without a token; determinism of the tableaux.

## 12. The critic's reading

One fresh Opus reader checked every resident and line against *The Little Prince* and against other works a reader
might know, then read for tone and for gaps. Nothing had to be cut. What it found, all changed above:

| Where | Too near | Now |
|---|---|---|
| The pine | "got that small by never being left alone": care as a love aphorism, the rose's "time you spent" | cut back a little every spring: craft, not devotion |
| The opening caption | "each busy with one small thing": the book's busy grown-ups | "each of them somebody's work" |
| The cellist | "something turns" in fog toward a lighthouse's note: Bradbury's "The Fog Horn" | a fishing boat turns |
| The novelist | "forty books for every page": Johnson on turning over half a library | "a great deal for very little writing" |
| The contraption | "Then it would be the town's": owning, and at odds with the hall | "Then I wouldn't know how it works" |
| The bell-striker | "I carved his left arm": the old woodcarver and his puppet | "I re-hung his hammer twice" |
| The tide ring | children in a shrinking ring, one who "panics": *Battle Royale*; a watcher who never plays: the geographer | tag, laughter, and the old man rakes the line |
| The fingerpost | "born that way": a song title | "born by a colder sea" |
| The ending | an invitation to write to the author, as that book ends; and "his evenings" was untrue | one plain line and the link |

For tone it also cut a billing joke at the boat, a boast in the contraption's gloss, a line too clever at the lighthouse, and
"I am told", which made the brother sound grudging. It judged the abbey's encounter reverent. Its builder's questions
(what counts as met, what decides each outcome, what is stored) are answered in sections 4, 5 and 7.

The critic read the first draft, in which residents stood at the landmarks. The owner's correction then moved five of
them to curios and made it a quest of five. The residents and their lines are the ones the critic read; the places,
the keepsakes, the count and the quest's captions are new since.

A second fresh Opus reader read only what was new. It found the pine, the bell, the basket, the keepsakes, the five
quatrefoils and the ending clear. Three things were near something, and are changed above: the desk had "nothing else
for a mile" (one person alone on a world; it now has a hay wain at the gate); the contraption had sails and two
chimneys, all turning (a walking castle in small; it is now a squat mill-shed with one flue); and the dead oak was
white (a bare tree on an empty stage; it is grey, at a field's edge, with a boy throwing a ball at it). It also caught
that the brother could not walk up from the abbey to a hill across the sea, so the bell-striker stands above the abbey.

## 13. Left to the builder

- The sprites: the hall, each tableau, the pennant. Drawn and judged on renders, with the owner's pick of the hall.
- The exact feel of the throw and the bow, and how the camera frames a tableau beside the sheet.
- The order of work. Suggested: the hall's page on the town and the retirements; then the quest section, the
  quatrefoils and one encounter end to end (the pine); then the other four; then the ending.
- The words, after the owner has edited them.
