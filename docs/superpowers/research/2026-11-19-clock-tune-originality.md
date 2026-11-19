# The clock's tune: originality check

The town clock's carved figures walk out to a tune written for this world (`src/world/sound/schedule/tune.ts`,
design §4.8). Originality is a hard rule for the site (`.claude/CLAUDE.md`), so the tune is searched in public melody
indexes before release, not only checked from memory. A close match means rewriting the tune.

## The tune

E Dorian, 6/8, thirteen bars, durations in quavers.

| | |
| --- | --- |
| Notes | E6 D6 B5 C♯6 · D6 B5 A5 · G5 A5 B5 · B5 A5 G5 E5 · C♯6 B5 A5 · F♯5 G5 A5 · E6 F♯6 E6 D6 · C♯6 B5 A5 B5 · G5 A5 F♯5 · B5 C♯6 D6 B5 · A5 G5 F♯5 G5 · F♯5 G5 F♯5 · E5 |
| ABC (K:Edor, L:1/8, M:6/8, an octave down) | `e2dB2c \| d2BA3 \| G2AB3 \| B2AG2E \| c3B2A \| F2GA3 \| e2fe2d \| c2BA2B \| G2AF3 \| B2cd2B \| A2GF2G \| F3G2F \| E6` |
| Parsons code | `*DDUUDDDUURDDDUDDDUUUUDDDDDUDUDUUUDDDDUDUDD` (43 notes) |
| Intervals (semitones) | −2 −3 +2 +1 −3 −2 −2 +2 +2 0 −2 −2 −3 +9 −2 −2 −3 +1 +2 +7 +2 −2 −2 −1 −2 −2 +2 −4 +2 −3 +5 +2 +1 −3 −2 −2 −1 +1 −1 +1 −1 −2 |

## Searches, 2026-11-19 (about 06:40, US Central)

| Where | Query | Result |
| --- | --- | --- |
| Musipedia contour search (`musipedia.org/contour/<code>`, about 11,000 classical and 17,000 folk melodies by its own counts) | the whole Parsons code | Not run: the site answers with a Cloudflare "Verify you are human" check (HTTP 403). Completing it is the owner's to do. |
| FolkTuneFinder (`new.folktunefinder.com`, folk tunes in ABC) | — | Not run: the same Cloudflare check (HTTP 403). |
| Melodyhound (`melodyhound.com`, Musipedia's engine) | — | Down: HTTP 522. |
| Themefinder (`themefinder.org`, `themefinder.stanford.edu`; Essen folksongs and classical themes) | — | Unreachable: no connection. |
| Finnish folk tunes (`esavelmat.jyu.fi`, contour and interval search) | — | Unreachable: no connection. |
| Web search | `"*DDUUDDDUURDDD"` (the opening contour) | No page contains it. |
| Web search | `"e2dB2c d2BA3" OR "E2DB2C" tune Dorian jig 6/8 abc` | No exact match. Nearest: an unnamed E Dorian jig in a Chiff and Fipple forum thread ("can anyone identify this tune") with figures `e3dBA` and `BAGE3`; different notes and contour. |
| Web search | `melody intervals "-2 -3 2 1 -3 -2 -2 2 2" semitones tune` | No match. |

## Corpus comparison, 2026-11-19 (music21's bundled corpus)

**Method.** music21 10.5.2 in a throwaway virtualenv (not a project dependency). Every tune of the folk, fiddle and
chorale collections in its core corpus was parsed; its melody is the top line (first part, ties merged, the top note of
a chord, rests and grace notes skipped). Each melody becomes its semitone intervals (transposition does not matter)
and its Parsons code. The distance is approximate substring matching (Sellers' algorithm): the fewest insertions,
deletions and substitutions that turn the query into *some* stretch of the corpus tune, so a borrowing anywhere in a
tune is found. Queries: the whole tune (42 intervals), its opening (16), each of its four phrases (bars 1–3, 4–6,
7–9, 10–13: 9, 9, 10 and 11 intervals), and the whole Parsons code. Self-test: a Ryan's Mammoth tune's own opening is
found at distance 0, and the same with three intervals altered at distance 3.

**Corpus: 13,367 tunes.** Essen folksongs 8,504; O'Neill's 2,009; Aird's Airs 1,178; Ryan's Mammoth 1,059; Bach
chorales 432; miscellaneous folk 181; lead sheets 2; the Nottingham file 2 (it parsed as two tunes only).

**The whole tune is far from everything.**

| Query | Closest | 1st percentile | Median |
| --- | --- | --- | --- |
| Whole tune, 42 intervals | 18 edits | 21 | 27 |
| Opening, 16 intervals | 5 edits | 6 | 9 |
| Parsons code, 42 steps | 6 edits | 9 | 15 |

Five closest by the whole tune's intervals: *Ben Lowry's* reel (Ryan's, 18 edits); *The Flowers in the Valley*
(O'Neill's 612, 19); *The Joy of My Life* (O'Neill's 808, 19); *The Last of the Twins* (O'Neill's 1601, 19); *Tom and
Jerry* reel (Ryan's, 19). Closest openings (5 edits of 16): *Ben Lowry's*, *The Flowers in the Valley*, *The Harvest
Field* (O'Neill's 1428), *Oyster River* hornpipe and *Williams and Sullivan's* jig (Ryan's). Closest contour (6 of
42): Bach's chorale BWV 161.6 and the jig *Geese in the Bog*; contour alone is known to match loosely.

**Phrases: two coincidences, at chance.** For each phrase, the closest of 13,367 tunes is a single extreme case; the
1st percentile is 2–4 edits.
- Phrase 1 (E D B C♯ D B A G A B) appears with the same intervals in *The Rambler From Clare* (O'Neill's 1009, 6/8, A
  minor), but in its bar 12, not its opening, and in running quavers (`A G E F♯ G E D C D E`). The tune opens
  `A B C A B G A E D E G G`.
- Phrase 2 (B A G E C♯ B A F♯ G A) is one interval from the opening of *Turkies in the Straw* (O'Neill's 1520, a 2/2
  reel in G: `B A G E F♯ E D B C D`). Ours leaps a major sixth (E up to C♯) where it steps up a tone, and it moves in
  6/8 lilt, not running quavers.
- Phrases 3 and 4 are at least one and two edits from plain stepwise descents (*Gerstebinden*, *Tady's Wattle*, *The
  Glasgow Hornpipe*).

**Verdict.** No tune is close as a tune: the nearest needs 18 of 42 intervals changed, and no opening comes within 5
of 16. The two phrase coincidences are what short stepwise modal lines give by chance against thirteen thousand
folk tunes, sit in other places and other rhythms, and would not let a listener name either tune. No rewrite on this
evidence. If the owner wants even these gone, a note or two in bars 2 and 6 would do it; any change must go through
this comparison again (not yet tried).

Earlier, from memory (design §4.8 and the `tune` unit test): the opening and every five-interval stretch were compared
with the Westminster and Whittington chimes, Carol of the Bells, Greensleeves, Scarborough Fair, Drunken Sailor, the
Skye Boat Song, Frère Jacques, Swallowtail, Morrison's, The Butterfly and Sumer is icumen in. None matched.

## Musipedia, 2026-11-19 (run by the owner)

The owner ran Musipedia's contour search on the whole Parsons code in their own browser (Musipedia counts 11,446
classical, 2,457 popular, 17,085 folk, 142 hymn and 121 anthem melodies). The ten nearest, in order: Morley, *April
is in my mistress' face* (soprano); Jagger–Richards, *Fool to Cry* (organ); Honegger, *Chant de Nigamon* (3rd theme);
Bryant, *Bye Bye Love*; Mozart, K. 545 (1st movement, 2nd theme); Paul Simon, *Bridge Over Troubled Water*;
Beethoven, op. 135 (4th movement); Vaughan Williams, Symphony 8 (4th movement, 2nd theme); Sibelius, Symphony 7 (5th
theme); Haydn, Symphony 52 (menuetto). A scattered list of short incipits from every period: no family of tunes.

The top three, note by note (intervals in semitones):
- **Morley, soprano** (from the open LilyPond edition at victoria.uma.es: `D5 C5 B♭4 C5 D5 B♭4 C5 A4 | D5 …`, 4/4). It
  shares the opening contour for five steps (down, down, up, up, down: a turn), which is why it ranks first, but not the
  intervals: ours −2 −3 +2 +1 −3, Morley's −2 −2 +2 +2 −4. Over the whole soprano line the tune is 25 edits of 42 away
  (the opening's 16 intervals: 9). The longest stretches of identical intervals anywhere are 6 notes, twice, both in
  other places and rhythms: our closing B A G F♯ G F♯ against Morley's cadence D C B♭ A B♭ A (bars 21–23: the stock
  fall to the leading note and back), and a falling-thirds figure in our bars 8–10 against Morley's bars 1–3 across a
  rest.
- **Fool to Cry** (G held, F E F E C G): 1 of its 6 intervals agrees with ours from the start; the longest identical
  run anywhere is 4 intervals.
- **Chant de Nigamon** (read from the screenshot: A♭ G A C♭ A G | F C♭ D D C): its contour follows ours a note later,
  but 2 of 10 intervals agree; the longest identical run anywhere is 3 intervals.

**Verdict: original.** Nothing tracks the tune past a common six-note figure, and the corpus check's nearest of 13,367
folk, fiddle and chorale tunes needs 18 of 42 intervals changed. FolkTuneFinder was not searched (the owner's browser
check was used up); the corpus check covers its ground (Irish, Scottish and English fiddle tunes, the Essen songs).

## Still to run (superseded)

The two real indexes need a person to pass Cloudflare's check once in the Claude desktop app's browser pane (its
profile keeps the clearance): `https://www.musipedia.org/contour/DDUUDDDUURDDDUDDDUUUUDDDDDUDUDUUUDDDDUDUDD` and
`https://new.folktunefinder.com/`. Then: Musipedia's contour search on the whole code and on its first sixteen notes,
and FolkTuneFinder's melody search on the first two phrases (`e2dB2c d2BA3 G2AB3 B2AG2E`). Results go in the table
above.
