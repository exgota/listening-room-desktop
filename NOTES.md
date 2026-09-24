# Notes: four visualizers for the Listening room

Keys 1–4 switch visualizers on the player page (the choice is remembered). Nothing is
visible to switch with: no dropdown, no control. The default is set in
`site/visualizer.js` (`visualizerDefault`).

| Key | Visualizer | In one line |
| --- | --- | --- |
| 1 | Rig | A timecoded stage lighting show in a black room |
| 2 | Type | The sung words set as posters that assemble in the singer's rhythm |
| 3 | Pocket | A cut-paper troupe, one performer per instrument, on the band's own groove |
| 4 | Plate | Chladni figures: the harmony shapes the sand, the kick strikes the plate |

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
  - Pocket: the night stage and a larger cast.
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
  - About 1.3 M point fragments with alpha blending.
  - One full-screen ground pass.
  - Estimate: under 1.5 ms GPU. The captions cost one text line a frame.

## The four (draft)

(Concept, mapping, measurements, and more-time notes per visualizer are written at the end
of the review passes.)
