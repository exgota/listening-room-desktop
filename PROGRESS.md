# Progress

Read `PLAN.md` first. Newest entries at the bottom of each section.

## State

- Stage: design written; next is analysis extension + slot/harness.

## Environment notes (for a fresh context)

- Server: `python3 server.py --port 8080` from repo root (build first: `cd site && node build.mjs`).
- Headless Chromium has no AAC decoder: `canPlayType('audio/mp4; codecs="mp4a.40.2"')` is "".
  Frame renders don't need audio (debug hook renders any song time). The acceptance script
  uses `tools/render/test_server.py`, which serves MP3 transcodes of the mixes.
- Puppeteer lives in `tools/render/node_modules` (`PUPPETEER_SKIP_DOWNLOAD=1 npm install`),
  Chromium at `/opt/pw-browsers/chromium`, launch with `--no-sandbox`.
- Scratch (not in repo): decoded WAVs of mixes and stems at 22.05 kHz mono, overview plots,
  transcription outputs: `/tmp/claude-0/-home-user-listening-room-desktop/f7c1db63-cf80-51c6-8003-4163b282aedb/scratchpad/`.
- Re-transcription: `tools/lyrics/transcribe.py` (faster-whisper, large-v3-turbo and large-v3,
  CPU int8). Turbo takes ~1 min per song; large-v3 several minutes.

## Listening notes (from data)

- NBLY 139 BPM regular grid. Intro vocal chops + drums, no bass until 0:27.6. Groove to 1:16.
  Breakdowns 1:24.6–1:47, 1:52–2:02.6 (verse vocals). Build 2:04.3–2:16.4, hole 2:16.4, drop
  2:18.13 (instrumental, vocal chops). Vocals over full band 2:45–3:13. Breakdowns 3:15–3:25,
  3:42.7–4:06.9. Chord section 4:08–4:19 (claps, no kick, bass on). Bass out at 4:22, kicks
  back 4:29, hole 4:34.96, drop 4:36.26. Vocals return over drop 5:03–5:31. Outro to 6:00.
- Desire 125 BPM (no `beat_grid` field; tracked beats). Four-on-floor kicks from 0:00 with no
  bass. Build 0:15.3 (data calls the whole 0:15–0:44 a build), vocals from 0:30, drop 0:45.8.
  Build 1:01–1:14, drop 1:16.28 (vocals stop; instrumental post-chorus; the brief does not
  list this one as a drop). Breakdown 2:21–2:30.5, build 2:30.5–2:45.8, "Is it desire?"
  2:47.44–2:48.10 straddles the drop at 2:47.70. Drop 3:48.66 is instrumental (vocals out).
- Ophelia 132 BPM. Breakdown 0:09.2–0:20.2 (vocals), build to 0:36.5, drop 0:36.52 (vocals
  continue). Instrumental drop-like 1:05–1:20. Breakdown 1:22–1:32.9, drop 1:34.70.
  Breakdown 2:20–2:27.4, end 2:35. "came" at 1:26.4, 1:33.8, 1:37.4, 1:41.1.
- Outside 136 BPM. 0:00–0:44 vocals + claps/hats, no bass; bass in 0:44; instrumental groove
  1:05–1:40 (reentry 1:10.57); vocals 1:40–2:07; build 2:07.04–2:21.16 (bass out 2:08);
  drop 2:21.16 (lead-in anchor 2:20.72–2:21.16). 2:37–2:51 kick out; outro chords change
  colour at 4:15 (F#/D/B). Risk of mush 0:44–2:07: must be varied by scene.
- American Boy 118 BPM regular. Drums + hats only to 0:16, "other" enters 0:16, breakdown
  0:32.6–0:40.7 (vocals), drop 0:48.83 (bass + drums). Groove: kick four-on-floor with a
  pickup on the last 16th, bass syncopated (pushes before the beat), off-beat hats strong,
  16ths present; drums thin 2:02–2:18 (claps out), 2:51–3:07; vocals end 3:39.
- `claps` in the data fire ~4 per bar in most songs (snare band catches hats/kick click);
  treat as "backbeat-ish" only after refinement.
