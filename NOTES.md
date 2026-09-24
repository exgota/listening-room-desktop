# Notes: four visualizers for the Listening room

Keys 1–4 switch visualizers on the player page (the choice is remembered). Nothing is
visible to switch with: no dropdown, no control. The default is set in
`site/visualizer.js` (`visualizerDefault`).

| Key | Visualizer | In one line |
| --- | --- | --- |
| 1 | Plate (the default) | Chladni figures: the harmony shapes the sand, the kick strikes the plate |
| 2 | Type | The sung words set as posters that assemble in the singer's rhythm |
| 3 | Pocket | A cut-paper troupe, one performer per instrument, on the band's own groove |
| 4 | Rig | A timecoded stage lighting show in a black room |

While audio plays, the play button is hidden. The controls, the file row and the brand fade
out at the moment playback starts, and come back when the pointer moves or keyboard focus
enters them. Clicking the picture or pressing Space pauses and resumes. On the desktop
layout the stage is now full-bleed: the controls sit over it on a themed scrim when shown.

_This file is being written as the work proceeds; sections marked (draft) are updated at
the end._

## Shared ground

### Timing: every picture is a function of song time

`drawVisualizer` reads a song clock: `audio.currentTime`, run forward between the element's
own updates on the frame timestamp (at most 0.25 s ahead). Every visualizer draws from that
time and the precomputed analysis only. Nothing accumulates between frames, so:

- a seek anywhere lands on the right picture;
- pause, seek back into a build and resume all give the same frames as playing straight
  through;
- `window.visualizerDebug.renderAt(t)` draws any exact song time headlessly.

The acceptance script checks this by rendering the same time after seeks in other orders
and comparing the frames.

### Analysis added: `performance.json` → `visual`

`tools/extend_performance.py` adds a `visual` block and leaves every existing field alone.
It reads the committed stems and never runs Demucs again. The block holds:

- **Corrected beat grid.** The tracked grid was off by −28 ms (Desire), −19 (Ophelia), −25
  (American Boy), +21 (Outside) and −6 (NBLY). The offset was measured from each kick's
  transient against its nearest beat, in exact 1 ms bins.
- **Drops on the corrected downbeat.** Each was verified in 1 ms waveform views of the mix,
  drum and bass stems.
- **Drum hits split by NMF of the drum stem.** Kicks and backbeat snares are snapped to the
  corrected eighth-note grid. Hats keep their own timing, so swing survives.
- **Bass notes** from pYIN on the bass stem.
- **Sung notes** from the CREPE pitch series.
- **Chords** as triads per beat (Viterbi-smoothed).
- **Scenes:** intro, verse, groove, break, build, gap, drop, drive and outro.
- **Named peaks** from the brief: NBLY's chord passages, and the word on Desire's main drop.
- **Revised lyrics** (see below).

### Lyrics

Whisper large-v3-turbo and large-v3 re-transcribed each vocal stem (`tools/lyrics/`), and
the result was merged with the original medium.en words by vote:

- A word counts as confirmed when a second model heard the same word within 0.35 s.
- Words sung over a silent stem (hallucinations) are dropped.
- Starts are snapped to vocal onsets.

Type shows only lines that are at least 70% confirmed, and only their confirmed words.

### Where the data and the brief disagree

- **Desire: "desire" is sung 12 times, not 11.** The 12th is at 3:10.3 ("I want desire"),
  which the first transcription misheard. Every visualizer uses the 12.
- **Drop times, corrected by up to 30 ms (1–3 frames).** Each corrected time was checked
  against the stems:

  | Song | Drop | Corrected time |
  | --- | --- | --- |
  | NBLY | 2:18.13 | 2:18.126 |
  | NBLY | 4:36.26 | 4:36.252 |
  | Desire | 0:45.8 | 0:45.772 |
  | Desire | 1:16.28 | 1:16.252 |
  | Desire | 2:47.7 | 2:47.672 |
  | Desire | 3:48.66 | 3:48.632 |
  | The Fate of Ophelia | 0:36.52 | 0:36.501 |
  | The Fate of Ophelia | 1:34.70 | 1:34.681 |
  | Outside | 2:21.16 | 2:21.177 |
  | American Boy | 0:48.83 | 0:48.808 |

- **Desire has a fourth drop at 1:16.25** that the brief does not list: an instrumental
  post-chorus after a two-bar hole. It is treated as a secondary drop.
- **The main drop is the strongest, and of equals the later.** That makes it 2:47.7 for
  Desire, 4:36.3 for NBLY and 1:34.7 for Ophelia. Each visualizer saves something for it:
  - Rig: the gel colour.
  - Type: the permanent palette swap.
  - Pocket: the song's own colour for the whole section and a larger cast.
  - Plate: the vermilion ground.
- **Of the drops without a hole in the data:**
  - Ophelia's drops and American Boy's have none.
  - Outside's lead-in anchor (2:20.72–2:21.18) is a single beat.

  The visualizers treat that last beat as the held breath.

## Cost per frame (assumptions to check on the M4) (draft)

The budget is 10 ms at 100 Hz for everything: page, compositing and visualizer. This
machine has no GPU, so frame time can't be measured here. Each visualizer is bounded by
construction instead:

- fixed internal resolution caps;
- bounded draw calls and primitives;
- no readbacks;
- no per-frame allocation in the hot paths, beyond small strings for canvas text and the
  captions.

The waveform canvas is no longer resized every frame, and it is not drawn while the
controls are hidden.

- **Rig (WebGL2, one full-screen fragment pass).**
  - Internal resolution is at most 1600×900 (1.44 MP), and the browser scales it to the
    stage.
  - Each pixel tests 17 cones: 8 heads, 8 floor jets and 1 follow-spot.
    - A miss costs about 50 operations.
    - A hit costs about 150: the closed-form scattering integral plus two 3D-noise fetches.
  - About 4 beams cover a typical pixel, and floor pixels (about 35%) add a reflected pass
    and pools of light.
  - Estimate: about 2,500–3,500 operations per pixel, so 3.6–5.0 G operations per frame.
    The M4's 10-core GPU does about 2 T FMA per second, so this is 2–4 ms at realistic
    occupancy.
  - One draw call, no textures but a 32³ R8 noise volume. JS time is about 0.1 ms (17 beams'
    uniforms).
- **Type (Canvas2D).**
  - One field fill and one ink block.
  - Up to about 10 text runs at poster size (glyphs 150–900 px), each drawn at most twice
    through clip rectangles for the inversion. Glyphs above 256 px are drawn as paths.
  - Layout is computed once per line (cached); no measurement happens per frame except for
    the one or two words of a mode change.
  - Estimate: 1–3 ms CPU (Skia recording) and under 1 ms GPU.
- **Pocket (Canvas2D).**
  - About 25–40 flat polygons (48-sided discs, 32-sided domes, triangles) plus the lane's
    stamps (at most about 60 small shapes in a bar).
  - Estimate: under 1 ms CPU, negligible GPU.
- **Plate (WebGL2 points, a Canvas2D caption layer).**
  - 196,608 + 65,536 grains. Each vertex runs 2 × 7 Newton steps on a two-mode Chladni field
    (about 700 operations), about 0.18 G operations per frame.
  - About 1.3 M point fragments with alpha blending, now all inside the square plate
    (about a third of the frame).
  - One full-screen ground pass.
  - Estimate: under 1.5 ms GPU. The captions cost two short text lines and the striker a
    frame.

## The four

### 1 · Plate (the default)

**Concept.** A Chladni plate: one square plate on an engraved sheet, sand lying on the nodal
lines of the figure the harmony sets, and a second, vermilion sand for the voice. Each song
has its own family of figures and its own emblem, which only its first drop lands on, and
the plate moves at the pace of the harmony rather than the beat: the calmest of the four
until a drop.

**Mapping.**

| Musical element | What it drives |
| --- | --- |
| Harmony | The figure, from the song's own family (NBLY rings and rosettes, Desire hourglass bands, Ophelia pills, Outside a ruled grid, American Boy columns): its place in the family from the section's energy and the chord's root, re-formed at most every two bars on a downbeat and never straight back to the figure before; a re-form is a dissolve, each grain leaving the old line for the new at its own moment |
| Voice | Vermilion sand, one of the song's own three voice figures per sung phrase (phrases from the sung notes, split at lines and every two bars); the black sand steps back while it sings |
| Key word | Concentric rings, used for nothing else, held at least 0.6 s |
| Bass | Line weight: heavy while a bass note sounds, released over 0.2 s; a legato note takes over the weight of the one before |
| Kick | The whole plate darkens for an instant, the striker at the centre jumps, a wave runs out to the rim |
| Snare | The band round the plate's frame fills for an instant |
| Hats | Ticks along the top edge at their place in the bar |
| Breakdown | The X (the only X in the piece), bare, then ringed, with arcs and with lobes, a step every four bars, under the voice |
| Chord passages (NBLY) | The plate inverts (ivory sand on a black plate) and every chord re-forms it |
| Build | The figure contracts a step on each downbeat, the first one visibly; the voice recedes |
| Gap | The knot alone, shrinking beat by beat |
| Drop | The knot thrown out on the exact frame, in heavy lines, the black at full for four bars: the first drop onto the song's emblem, a later main drop onto a denser relative of it, other drops onto its siblings; the drop section then steps through the siblings |
| Song's turn | The sheet turns vermilion for sixteen bars (eight when the song is nearly over), then ink and vermilion alternate |
| First frame | The song's emblem in full black under the first voice figure |
| Outro | Each figure held four bars; the sand drains to the bare knot |

**Measurements.** From the fourth review (on v4, before the v5 changes) and the Node
harness on the frozen and current code.

- Grades by review: D+, C, B-, B.
- Drops: every one lands on the first 10 fps frame after its line (NBLY 2, Desire 3 plus
  1:16.25 on the sheets, Ophelia 2, Outside 1, American Boy 1). Ophelia's first reads on
  the second strip frame at 0:36.60.
- Plate at 350 px wide: 167 px for NBLY, Desire and Outside. Ophelia and American Boy were
  128 px under their two-line titles; since v5c the plate moves right of the title at full
  height instead.
- Re-forms a minute, v4 → v5: NBLY 16.9 → 11.7, Desire 9.7 → 7.8, Ophelia 9.7 → 7.7,
  Outside 13.2 → 8.0, American Boy 9.3 → 6.4. Median figure hold 3.5-8.1 s.
- Sung time with no voice figure: 0-5 % (pass 3: 3-39 %).
- Bass weight flips a minute: 55-99 (pass 3: 134-169). The re-attack blinks the review
  found (70-132 a minute) are gone in v5c.
- The X is on the plate in 0-20 % of frames (pass 3: any X 49-80 %).

**With more time.**

- Measure the frame time on the M4 (262,144 grains, 14 Newton steps each).
- Replace the ideal cosine modes with a real free-edge square plate's modes (computed once
  offline), and let the sand migrate with a little physics instead of dissolving.
- Give American Boy's swing a visible element at phone size (a row of bold cells inside the
  plate's top edge instead of ticks).
- A late-only figure per song, so the last third has shapes the first two never had.

### 2 · Type

**Concept.** The sung words set as posters in a heavy grotesque: each line appears as a pale
tint and fills in word by word on the frame each word is sung. Around the words there is only
typography: the song is planned once as a timeline so each passage keeps one treatment, and
the drop's word is the largest type the song ever shows.

**Mapping.**

| Musical element | What it drives |
| --- | --- |
| Voice (sung words) | Each confirmed word fills in solid as it is sung, with a rule under the word being sung; a line is set when at least half its words are confirmed; unsung words are tints at about 3:1 against the field |
| Key word | Reversed out of an ink box inside its line; its running count (01–12) in the corner tab |
| Kick | The corner tab shows the beat of the bar, solid on each kick (while a count runs it only blinks); before the voice, the hook hops from side to side on every kick |
| Snare | Before the voice, the hook widens for an instant on every snare; the wall's odd rows step on it |
| Bass | A block of ink rising from the bottom to the note's height, inverting the rows it covers (whole rows at a time) |
| Harmony | In NBLY's chord passages the chord names, spelled in the song's key, with drawn flats |
| Intro | The song's word through the first bar, then the hook hopping with the kit, then the last four bars counted down to the voice |
| Instrumental passages | One mode per piece of at most eight bars, taken in turn by section: the hook as a wall stepping on kick and snare, spelled a letter a beat, breathing once a bar; after the turn a stack that grows a row a bar. The drop's word is never used |
| Breakdown | Lines set smaller, centred, with no ink band or tab |
| Build | The ink floods up the frame, stopping at the edges of rows and numerals; bars counted down where no line is sung |
| Gap | Full flood; the beats left as a row of full stops (numerals are for bars) |
| Drop | The song's word across the frame, on the field the flood hid. The main drop's word fills the whole frame below the title (two rows split at a syllable, or run off the foot) and holds a bar; the other drops are a size down |
| Song's turn | Field and ink swap for good |
| Ending | The song's word as a tint |

**Measurements.** From the fourth review (on v4, before the v5 changes) and the Node plan
replay on the current code.

- Grades by review: C-, C+, B- (the third was cut off before its grade).
- Drops: all ten change on the first frame after the drop line (NBLY 2:18.200 and 4:36.300,
  Desire 0:45.800, 2:47.700 and 3:48.700, Ophelia 0:36.500 and 1:34.700, Outside 2:21.200,
  American Boy 0:48.900; Desire 1:16.25 on the 2 fps sheets). Counts and chord names flip on
  the first frame after their beat lines.
- Lines set, current code: NBLY 79 of 115, Desire 52 of 53, Ophelia 44 of 47, Outside 40
  of 54, American Boy 103 of 107. The sung-note time inside a shown line is 80, 91, 75, 66
  and 93 %. The skipped lines are mostly vocal chops and ad-libs the two transcriptions do
  not agree on.
- Flashes (instrumental runs under 2 s between lines): 4 in the set (pass 2: 25).
- Hierarchy since v5c: the main drop's word, then the secondary drops' (0.82 of a full
  one-row fit), numerals at most 0.75 of those, other big type at most 0.6.

**With more time.**

- Listen through the lines the two transcriptions disagree on (36 in NBLY, 14 in Outside)
  and hand-confirm them, so the long ad-lib stretches have words.
- Give instrumental stretches a direction: the next line's first word assembling over the
  last four bars before the voice returns.
- Resume a line cut by a hit from the word being sung, rather than skipping it.
- Kerning and optical sizes for the poster sizes; a second face for the late palette.

### 3 · Pocket

**Concept.** A troupe of cut-paper figures, one per instrument, on a small stage, each moving
only on its own instrument's onsets, so the groove on screen is the band's groove. Under the
stage lies the pocket itself: one beat in sixteenth cells, where every onset of the last two
bars is stamped where it actually landed, so swing and push are visible in a single frame.

**Mapping.**

| Musical element | What it drives |
| --- | --- |
| Kick | The kit's drum (a black disc) touches the floor exactly on each kick (and squashes on a kick in a hold, in the air) |
| Hats | The kit's cymbals: one rings on the off-beat hats, the other on the swung sixteenths (the late hats, or the late bass notes where the hats carry no swing, as in American Boy), added as the song goes on |
| Bass | The dome winds up before each note and lands on it, taller for higher notes: syncopation shows as a landing off the drum's |
| Snare (strong, beats 2 and 4) | The mustard hands clap; through a build they close a notch per bar |
| Voice | The singer, a cut-paper profile: taller with pitch, the mouth opening with the level, a lean that snaps once a beat (on the swung sixteenth in a swung song, with a bigger throw) |
| The pocket (lane) | One beat in cells; the last two bars of voice, hats and claps, kick and bass stamped at their place in the beat |
| Arrangement | Performers on stage only while their part plays (they rise through the floor onto their first note); the featured performer changes every eight bars, and one not featured stays well under its size, so a swap always shows |
| Section | A field per run of scenes (pale before the turn, dark after it); every second eight bars of a run on a partner field, never a block under four bars |
| Key word | Large cut-paper letters in the band beside the title; then a slip in a growing pile |
| Chord passages | The field changes colour with each chord |
| Intro | The song's own colour until the first phrase ends |
| Build | The field steps toward night each bar (nearly to night before a drop with no hole), the troupe gathers inward, the last bar trembles; the singer turns cream once the field is dark |
| Gap | Night; the troupe held in the air |
| Drop | The troupe lands together on new marks with a slam. The main drop lands on a cream flash, then the song's own colour for its whole section (NBLY cobalt, Desire tomato, Ophelia emerald, Outside mustard, American Boy violet), the troupe 1.35x |
| Song's turn | The stage goes dark, a different dark per section; later drops flash cream |
| First frame and ending | The song's poster, the troupe posed in its colour; it returns on the last downbeat and its hands keep the tempo after the music |

**Measurements.** From the fifth review (on v5, before the v6 changes).

- Grades by review: D+, C-, C+, B- (the fourth was cut off after three songs).
- Every hole and drop changes on the first 10 fps frame after its line (15 peaks in the five
  songs), and the drum lands on the frame after each kick.
- Nothing enters the title box (0 hits in 13,190 replayed frames); no figures overlap
  except in the closing crossfade, which v6 replaced with a cut.
- Longest single picture (same field, same composition): 16.2 s. Named field changes per
  song: 14-43, no grey anywhere.
- Field contrast at the drops, the frame before against the drop frame: 13-15:1 for the
  cream landings, 2.0-4.6:1 for the main drops' own colours (1.2:1 for American Boy). v6
  lands every main drop on a cream flash first.
- Cymbals, share of frames with a visible ring after the turn: NBLY 38 %, Outside 40 %,
  Desire 26 %, Ophelia 24 %, American Boy 4 % (its hats carry no swing; v6 moves its swing
  cymbal onto the swung bass notes).

**With more time.**

- Make the swing a stage-sized event on a phone: a beat ruler across the floor where each
  landing leaves a footprint at its phase in the beat.
- Let figures trade places with a walk when a swap cannot change sizes, and give breakdowns
  a staging the verses never use.
- A fourth performer for the "other" stem (keys and guitars), with its own column.
- Real cut-paper texture and a few hand-cut pose variants per figure.

### 4 · Rig

**Concept.** A timecoded lighting show in a black room: eight moving heads on a truss, a row
of floor jets, a follow-spot and truss strobes, each fixture played by one part of the song.
Nothing is a spectrum or a meter: every cue is a lighting designer's cue, placed at the exact
time the analysis says it happens, and each song has its own opening, drop picture and
signature.

**Mapping.**

| Musical element | What it drives |
| --- | --- |
| Kick | The floor jets fire (one row of upward shafts at the stage lip) |
| Bass note | Every head pans together with the note, low left to high right across the song's own bass range, snapping with an overshoot; a repeated note nods them |
| Opening | The song's own composition (its thumbnail, opened on a kick), breathing over two bars: the heads rise and their beams widen, then sink |
| Voice | The warm follow-spot from above, moving between five stage marks with the sung pitch (a visit to a neighbouring mark under a second is ignored) |
| Snare / hats | Truss strobe cells flash on the backbeat; hats sparkle |
| Swing (American Boy, Outside) | The heads chase sideways on the beat and on the swung sixteenth, from the first bar |
| Section | Look (fan, cross, blade, rain, scissor…) and camera per section and per eight bars, the camera turning at every section change; each song's signature look recurs in its drives |
| Breakdown | A look per breakdown, in each song's own order; one of six bars or more wakes the rig pair by pair |
| Key word | Every head sweeps onto the singer's mark just before the word (lenses dimmed), holds, and lets go over a beat |
| Build | Beams converge steadily into a spike high over the stage, brightening as they close in thickening haze; the camera pushes in |
| Gap / breath | Blackout; four big blinders light a pair per beat; the spot stays lit (held at its peak) if someone sings into the hole. A drop without a hole breathes only where the music dips |
| Drop | Everything fires over the audience on the exact frame, the brightest state of the song for three beats, eased over four more into the drop section: at least eight bars in the drop's own camera and looks, in thicker haze (the main drop's thickest and hottest), a pair of heads chasing across the rig on the eighths. No two songs share a drop camera: NBLY from above, Desire from the floor (its main drop from the side, pouring every head onto the singer), Ophelia from overhead, Outside from the back of the room, American Boy from below |
| Song's turn | The song's gel colour, saved until then (NBLY blue, Desire red, Ophelia mint, Outside amber, American Boy magenta), gelled heads raised to make up what the gel takes; a hit and a tail of its own when the turn is not a drop |
| End | The opening composition returns for at least the last eight bars, heads dropping out, with a slow sweep; the last two bars fade to black |

**Measurements.** From the fourth review (on v5) and 1 fps luma renders of the current code.

- Grades by review: C, C+, B- (the third was cut off before its grade).
- Drops: every drop with a 10 fps strip lands on the first frame after its line (nine).
  Build top against hit: 1.6-3.2x.
- Title contrast: median 0.86-0.88 per song, no frame under 0.35 outside the hit frames; the
  flash now spares the title's corner.
- Drop sections against drives (mean luma above the transport, current code): NBLY 0.173
  and its main drop 0.174 against 0.122 (1.42x); Desire 0.183 and its main drop 0.163
  against 0.137 (1.34x and 1.19x). The fourth review had found them level with the drives.
- Drop pictures across songs: the fourth review found two pairs sharing a camera
  (similarity 0.57 and 0.66); since v7 each song's drop has its own camera.

**With more time.**

- Measure the frame time on the M4; the fragment pass is the heaviest of the four.
- Visible fixture bodies and gobo textures, so the rig reads as hardware, not only light.
- Hand-programmed cues for each song's two or three key moments on top of the rules.
- Camera moves (a crane, a dolly) timed to phrases, not only cuts and drifts.
