# A simple story

Status: for the owner, written by Fable and checked by one Opus reader (2026-11-18). It replaces the direction in
`2026-11-18-lore-and-story.md`, which the owner set aside. Nothing here is built. **[Call]** marks a choice of
Fable's; the owner can overturn it.

**[Owner, 2026-11-18]** "I'm thinking a more simple story, not like deep lore. I'm just thinking for something maybe
like Little Prince a little bit, like something that's simple but more like sociological, psychological... just not
nothing like world building. Like it's just too much. I just want something simple."

So there is no history here, no peoples, no named realm and no rules: a dragon, a few houses, and one person at each.
*The Little Prince* is a guide to tone only (see the last section).

## Three tiny premises

**1. The question.** The dragon can go anywhere, and has never stayed in one place long enough to make anything. It
does not see why a person would, so it goes to ask. At each house one person is busy with one small thing, and each
gives a different, honest reason. The dragon does not argue with any of them.

**2. The chair.** At every house a chair has been put out by the door, and the keeper cannot quite say who for. Each
of them has been keeping something ready (a lamp trimmed, a loaf, a tune) for a visitor who has not come yet. The one
who comes is whoever is reading. It is about waiting: a made thing is only half finished until somebody turns up.

**3. What it could not carry.** The dragon owns nothing. At each house the keeper offers it one small thing, and each
turns out to be something that cannot be carried off, only attended to: a view, a tune, the way a knot is tied. It is
about attention, and what is kept by looking and not by having.

**[Call] The first.** It gives seven different reasons where the other two give one idea seven times, and a reason
tells you about the person who gives it. It is also the safest beside a real project: a reason for making is not a
verdict on what was made. The second can sound like asking, which a portfolio should not. The third has to land the
same moral at every house, and that moral sits too near the best-known line of the book whose tone we are borrowing.

## The story

**Opening line**

> The dragon can go anywhere, and has never stayed anywhere long enough to make a thing. So it goes to ask the people
> who have.

**Closing line**

> The dragon still has not made anything. It has asked, though, and listened, and it suspects that is where making
> starts.

**The encounters.** One for the abbey and one for each kind of landmark that can hold a project.

**The abbey.** The porter at the abbey has never made anything either, and says so. He opens the door. "Somebody has
to be glad you came," he says. "It is a job like the others."

**The town.** The baker under the bell tower has made the same loaf for forty years. The dragon asks if she is tired
of it. "I am good at it," she says. "I cannot say that about much else, and it is pleasant, being good at a thing."

**The lighthouse.** The keeper watches for one boat. It is her sister's, and it comes in after dark. The dragon asks
about all the other boats that steer by the light. "They are welcome to it," she says.

**The windmill.** The sails turn whether the miller watches them or not. He watches them. The dragon asks what he is
looking for. "Nothing," he says. "I built half of it. You would stand here too."

**The bridge.** Before the bridge there was a ford, and the woman who built the bridge had wet feet for thirty years.
The dragon asks if that is the whole reason. "I was tired of wet feet," she says. "Then it turned out everybody was."

**The roofless nave.** The mason in the roofless nave checks every stone with a string before he sets it. The dragon
asks who would know if one were a little out. "I would," he says.

**The yew.** The woman who sits under the yew carves spoons and gives them away. The dragon asks why spoons. "Nobody
is ever cross to be given a spoon," she says.

The seven reasons, for whoever edits these later: somebody has to receive what is made; it is pleasant to be good at
one thing; it was for one person, and the rest are welcome; it is a pleasure to watch what you built work; it annoyed
me first; I would know; nobody minds a small useful thing.

Four rules keep them simple:

- **A reason, never a verdict.** Any project can sit at any landmark. So each keeper says why they do their own small
  thing, and none says how it is going: nothing unfinished, unnoticed, unthanked or slow.
- **Nobody has a name**, and no place has a past beyond what one person remembers.
- **Three to five sentences**, in the plain voice of the Codex's captions. One thing said, then stop.
- **Each stands alone.** A visitor may meet them in any order, or meet one and leave.

## How it appears

- **One paragraph on the Codex's page**, as the last thing on it: below the project's name, description, ledger and
  links (at the abbey, below About Me, the register and the terminal button). A thin rule, then the paragraph in the
  page's italic. Nothing above it changes.
- **Never a gate.** No prompt, no button, no count. Nothing is stored and nothing unlocks. Landing shows the project
  at once; the paragraph is there to be read or not.
- **The opening line** is the first caption of a flight, in the strip the discovery captions already use.
- **The closing line** shows as the visitor leaves the flight, if they landed anywhere. It is on no Codex page, so it
  never sits on About Me.
- **Plain text, apart from the content.** One small module (say `src/world/story.ts`) holds the nine strings, keyed by
  landmark kind: never by project, and never in `content.ts`. The Codex component imports it directly, so the text is
  not in the page's HTML beside the projects. The Recruiter page and the agent files do not read it. In the Codex it is
  real text in the dialog, so a screen reader reads it.
- **A landmark with no project** shows its paragraph too. The keeper is there whether or not a work is.
- **While a kind still has several landmarks**, its paragraph shows at one of them only, so no two projects end with
  the same words. One landmark of each kind (the biomes session's brief) makes that rule unnecessary.
- **The wonders have no words.** They stay sights.

The story asks nothing else of the world or its generator.

## What is not borrowed, and what is shared

- **Shared, and said plainly:** a traveller who meets one person at each stop is that book's shape, and the shape of
  many older travel tales. It is also how the site already works: one landing, one page. What differs is the regard.
  That book's grown-ups are there to be found absurd. These seven are liked, and each has a reason of their own.
- **Not used:** no rose, fox, planets, aviator or quotations. Nobody here rules, counts, owns, drinks, maps, or wants
  to be admired.
- **Found in the first draft by the reader, and removed:** a keeper tending a lamp all night (the lamplighter; ours
  now watches for a boat); a doorkeeper at an open door that people wait outside (Kafka's "Before the Law"); a mason
  who will not live to see the roof (the cathedral-builder parable); a ringer who cannot hear her own bell; and an
  ending in which a wanderer comes to understand people (*Frieren*'s arc).
- **To keep clear of in later edits:** fixed hours and daily rites, taming, and anything said to be essential or
  invisible.

The earlier document's section 5 still stands as a note on the wonders that sit nearest their films ("the marsh
house" is the exact name of the house in *When Marnie Was There*). Its other sections are set aside.
