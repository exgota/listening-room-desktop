# Plan: four visualizers for the Listening room

Read this with `PROGRESS.md` (what is done, decisions, next step). This file is the design;
it changes only when a design decision changes.

## Constraints that shape everything

- Chrome, Apple M4, 1920×1080, 100 Hz: 10 ms per frame for page + visualizer together.
- Picture = f(song time, precomputed analysis). No accumulated real-time state, so a seek,
  a pause or a headless render at time t all give the same frame. Live Web Audio: not used.
- Consumed muted at ~350 px wide: large forms, hard edges, high contrast, rhythm legible
  without sound. Fine detail is texture at best.
- First frame (t = 0, paused, before play) is the thumbnail: fully composed, no fade-in.
- Kick, bass and voice each own a distinct visual element in every variant.
- Anticipation: the whole song is known, so every variant gathers through a build, holds in
  the gap, and lands the drop on the exact frame. The `anchor` (lead-in holes for NBLY and
  Outside; key word for Desire, Ophelia, American Boy) is each variant's signature cue.
- Late ≠ early: every variant has a song-level arc (things are revealed/added over the song),
  not only a per-section look.

## Concepts considered (the long list)

1. **Rig**: a timecoded stage lighting show in a black void; hard white beams in haze,
   programmed per song like a lighting designer would with timecode. 3D, energy/structure.
2. **Type**: kinetic lyric typography; each sung phrase is set as a poster that fills the
   frame, words revealed on their sung onset; the anchor word takes the whole frame.
3. **Pocket**: geometric dancers (Schlemmer's Triadic Ballet, Saul Bass / Matisse cut paper);
   each instrument is a figure animated with real anticipation and squash, timed to real
   onsets, so swing and syncopation are visible.
4. **Plate**: Chladni figures; the harmony and bass choose the plate's mode, sand migrates to
   the nodal lines, the kick strikes the plate centre and sends a ring through the sand, the
   voice is a second colour of sand tuned to the sung pitch. Engraved-plate look.
5. Slab: one black mass that is pressed, cut and released by the song's energy (Malevich
   meets a hydraulic press). Strong but too close to Rig's energy mapping; merged into Rig's
   build/gap/drop logic.
6. Graphic score (Wehinger's *Artikulation* / Music Animation Machine): the song as a
   scrolling score with shapes per stem. Legible, but reads as a chart, not a stage visual.
7. Harmonograph / Lissajous of the bass–voice interval, re-energised by kicks, decaying to a
   point in the gap. Beautiful but bass and voice collapse into one line; fails the
   "distinguishable by eye" test. Its decay-in-the-gap idea moves into Plate (sand airborne).
8. Albers squares driven by chords. Pure, but too static to stop a thumb.
9. Monolith flight: a camera through brutalist architecture that opens at the drop. Close to
   Rig in driver and palette; Rig is the stronger festival reference.
10. Piano-roll rhythm game (falling notes into a keyboard). Very legible, wrong register.
11. Swiss poster cuts: every downbeat cuts to a new generated poster. Folded into Type's
    instrumental mode.
12. Ikeda data field: barcodes and numerals from the song data. Fine lines die at 350 px;
    its precision survives as annotation layers in Plate and Rig, not as a variant.

## The four, and why they are different

| | Dimensionality | Driver | Rate of change | Palette |
|---|---|---|---|---|
| 1 Rig | 3D (raymarched haze) | energy + structure | slow gathers, instant releases | black, white light, one gel per song |
| 2 Type | 2D typographic | sung words | per word / per phrase cuts | one saturated field colour per song + one ink |
| 3 Pocket | 2D flat, cut paper | rhythm: per-stem onsets, swing | fast, continuous, elastic (per 16th) | polychrome cut paper, background changes per section |
| 4 Plate | 2D physical (particles) | pitch: bass note, chord, sung pitch | slow (per chord), with kick ripples | ivory plate, black sand, one vermilion |

Every pair differs in at least three of the four columns. Pocket is the one built for groove
and swing (American Boy); Type is the one built on words; Rig is the drop machine; Plate is
the harmony instrument.

### 1. Rig

Composition: a black room seen from the audience, a floor that reflects, a back truss of
moving heads, a front row of floor lights, one follow-spot from above. The title sits top
left in white on black.

- Kick → the front floor row flashes (low, wide, at the bottom of frame). Only that element.
- Bass → moving heads pan with the bass line (note pitch → angle, note onset → move with a
  snap and settle). Bass is the big motion.
- Voice → one steep follow-spot beam from above; intensity = vocal level, x follows pitch.
- Hats/claps → strobe cells on the back truss (small, precise).
- Build → the fan of beams converges to one point, sweeps subdivide with the riser, the
  camera pushes in. Gap → blackout, one point of light. Drop → every fixture fires outward
  on the exact frame (full fan + blinders), then a chase keyed to beats.
- Arc: fixtures come online over the song (intro uses few; each drop adds a row); camera
  position changes per section; the gel appears only after the first drop.
- Anchor: key word → blinder hit toward the camera; lead-in hole → the blackout.

### 2. Type

Composition: full-bleed colour field; lyrics typeset as a poster, each line justified to the
measure in a heavy condensed face; words appear on their sung onset in their final slot (the
layout of the whole phrase is computed ahead, so nothing reflows).

- Voice → words; pitch → baseline offset of the current word; held notes stretch tracking.
- Kick → a hard graphic cut in the field (a band that jumps), not a pulse of the text.
- Bass → a solid block rising from the bottom (height follows bass notes); type inverts where
  it crosses the block.
- Instrumental → the anchor word / title as a stepping type wall (rows step on beats).
- Build → last word stutters with the riser; gap → the empty field and a cursor; drop → the
  anchor or title full-frame, inverted.
- Anchor word → full frame in the accent colour, with a running count (e.g. 07/11).
- Arc: the palette inverts after the main drop; later choruses set larger.

### 3. Pocket

Composition: a stage floor line; geometric figures (cut paper) on it; stage flats behind.

- Kick → a black disc that bounces, touching the floor exactly on each kick (squash on
  contact). Bass → a heavy red dome that hops between floor positions by note pitch, winding
  up a 16th before each note (anticipation from the known future) and landing on it.
  Voice → a tall cobalt figure whose height follows pitch and mouth follows level.
  Claps → two yellow triangles that meet. Hats → a fringe of ticks that flick on each hat.
  Chords → stage flats slide/recolour on chord changes.
- Swing is not simulated: every motion is keyed to real onset times, so pocket and swing are
  whatever the band played.
- Choruses multiply the cast into a chorus line; breakdowns rest the rhythm section; builds
  wind everyone up; the gap freezes them mid-air; the drop lands everyone together.
- Anchor word → the whole cast hits a pose ("boy!").

### 4. Plate

Composition: a plate filling the stage, seen from above, ivory with black sand, captioned
like an engraved scientific plate (mode numbers, frequency, bar, time) in small type.

- Bass note + chord → the plate's mode; sand migrates to the new nodal lines over ~300 ms.
- Kick → the driver at the centre strikes; a ring travels out through the sand.
- Voice → vermilion sand forming the mode of the sung pitch; absent when nobody sings.
- Hats → grain shimmer.
- Build → the plate is overdriven, sand leaves the lines; gap → sand airborne, suspended;
  drop → the sand slams into the drop's pattern on the exact frame.
- Arc: plate shape and pattern complexity grow over the song.
- Anchor word → the voice sand forms a reserved pattern.

## Architecture

- `site/visualizer.js`: the slot (five functions), song clock, variant switch (keys 1–4,
  persisted in `localStorage`), playback chrome (play button hidden while playing, transport
  auto-hides while playing and returns on pointer move or focus), theming, debug hooks.
- `site/song-model.js`: fetches and decodes `performance.json` into typed arrays, event lists
  and queries (last/next event, section at t, build progress, gap state).
- `site/visual-rig.js`, `visual-type.js`, `visual-pocket.js`, `visual-plate.js`: one
  variant each, registered with the slot. Each owns its canvas.
- `tools/extend_performance.py`: adds a `visual` block to each `performance.json` (bass notes,
  vocal notes, chords, per-stem onsets, scene list, energy, revised lyrics). Never re-runs
  Demucs; reads the committed stems.
- `tools/render/`: headless review tooling (Puppeteer): render any song time to PNG, frame
  sequences, contact sheets, spectrogram-aligned strips, acceptance script.

## Process

1. Listen through the data (done: overview plots, phrase tables, groove folds).
2. Extend the analysis. 3. Build the slot and harness. 4. Build each variant.
5. Review passes in subagents (three full passes per variant, strips for every peak).
6. Rework, including concepts, when something falls short. 7. Acceptance script. 8. NOTES.md.
