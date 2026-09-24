# Review brief for a visualizer pass

You are reviewing one of four music visualizers for the Listening room (a personal music
player, desktop, Chrome, 1920×1080). The clips will be screen recordings of the whole page
posted on X, where they autoplay muted at ~350 px wide on a phone. You cannot hear; the
spectrogram strips and the song notes below are your ears. Be a demanding art director and a
precise QA engineer at once. Praise nothing that is merely fine.

## What the owner asked for (judge against this)

- The first frame (t = 0, paused, with the play button) is the thumbnail: striking at once,
  no fade-in, no load state. The first two seconds must hook.
- Large forms and high contrast over fine detail; rhythm legible with no sound. It has to stop
  a thumb at 350 px. Fine lines/noise turn to grey mush at that size and in X's compression.
- Kick, bass and voice must be distinguishable by eye (each has its own element).
- The picture late in a song must not look like the picture early on.
- The emotional peaks must land hardest (see the peak list). The visualizer knows the song in
  advance: it should gather through a build, hold its breath in the gap before a drop, and
  land the drop on the exact frame.
- Failure modes to hunt: everything jittering with loudness; parts-first incoherence; dead
  stretches in breakdowns; mush late in songs; "everything pulses on the beat"; a
  screensaver that loops; spectrum bars / radial FFT rings / Milkdrop plasma / generic
  particle explosions / neon glow / default three.js looks / bloom as decoration.
- The whole window must look right while playing, including the title (top left: song title
  and original artist). Controls are hidden while playing; the paused stills show them.

## Songs and peaks (times in m:ss, song seconds in brackets)

- NBLY (Flume, 139 BPM, 6:05): hole from 2:16.4 and drop at 2:18.13 [138.126]; synth chords
  2:20–2:25; chord section 4:08–4:19; hole from 4:35.0 and drop at 4:36.25 [276.25]. Four
  breakdowns incl. a long one 3:43–4:07. Drops are instrumental (vocal chops).
- Desire (125 BPM, 4:21): "Is it desire?" at 2:47.44, then the main drop at 2:47.67
  [167.672]. Secondary drops 0:45.77 and 3:48.63; another at 1:16.25. The word "desire" is the
  anchor (sung 12 times). Intro 0:00–0:30 is kick only, no bass.
- The Fate of Ophelia (132 BPM, 2:35): drops 0:36.50 and 1:34.68 (main); breakdowns
  0:09–0:20, 1:22–1:33, 2:20–2:27. Anchor word "came" around the second drop.
- Outside (136 BPM, 4:46): one build 2:07–2:21.2, one drop at 2:21.18; a one-beat lead-in
  hole 2:20.7–2:21.18. A long one-peak song: the risk is mush before the build.
- American Boy (118 BPM, 4:12): a groove song, not a drop song; one drop at 0:48.81 after a
  vocal breakdown 0:34.6–0:40.7. Swung sixteenths; syncopated bass. It must be about groove.

## Your materials (all under the review directory you were given)

- `sheets/<song>_NN.png`: whole song at 2 fps, 5 columns × 8 rows = 20 s per sheet, each
  thumbnail ~192 px wide (roughly phone size), labelled with m:ss.mmm. View every sheet of
  every song in order: this is stepping through the song.
- `strips/<song>-<t>_1..4.png`: for each peak, one image per second of a 4 s window: the mix
  spectrogram (0–8 kHz; grey lines beats, blue ticks kicks, orange ticks snares, green lines
  gap start and drop) and below it the 10 frames of that second, each under the time it
  shows. Use these to check sync without ears: does the picture change on the exact frame of
  the drop, do kicks/snares line up with visual hits.
- `stills/`: the paused first frame of each song and a frame at each peak, 960×540. Ask of
  each: is this up to the bar?
- Do not load the raw frames in `frames/` or `strip-frames/` unless you need one specific
  frame; if you do, downscale it to 960 px wide first
  (`ffmpeg -v error -y -i in.png -vf scale=960:-1 out.png`).

## What to return

Write your verdict to `<review dir>/verdict.md` as you go (so nothing is lost), then return
it as your final message. Structure:

1. Overall grade (A–F) and a two-sentence judgement of the concept as executed.
2. Per song: what works, what fails, with exact timestamps (m:ss.mmm from the labels).
3. Peaks: for each listed peak, does it land (sync to the frame, hardest moment)? Say which
   frame the change happens on versus the spectrogram's drop line.
4. Kick / bass / voice legibility at thumbnail size.
5. First frames: thumbnail quality per song.
6. Early vs late: does the song's picture evolve?
7. Defects: a numbered list, most severe first, each with timestamp(s), what you see, and a
   concrete suggestion. Include any rendering glitches (flicker, pops, popping elements,
   overlaps with the title, empty frames, stuck states).

Do not modify any files outside your review directory. Do not start a server; one is running
on port 8080. Rendering is slow (software GPU); be patient.
