# Listening room, desktop, without a visualizer

A self-contained copy of the Listening room music player for desktop browsers, with its visualizer removed. The page, library, queue, saved tracks, waveform seeking, keyboard and media controls all work. Five songs are included with their separated stems and analysis. Nothing here talks to the published site.

## Run

```sh
cd site && node build.mjs && cd ..
python3 server.py            # then open http://127.0.0.1:8080/
```

Node builds the page (it inlines `site/*.css` and `site/*.js` into `site/dist/page.html`); Python 3 with only the standard library serves it and the songs. Rebuild after editing anything in `site/`.

If `library/*/playback.m4a` is missing (the light copy ships without audio), run `python3 tools/fetch_audio.py` to download the mixes from the published site, and `tools/prepare_performance.py` to separate stems again.

`BRIEF.md` describes the task.

## Where a visualizer goes

`site/visualizer.js` is an empty slot. The player calls its five functions (selection, seek, draw, start, stop) and keeps a frame loop running while audio plays; the header comment lists them. The element `#visualizer` is a stage that fills the window above the waveform and controls, behind the title; the play button sits at its centre. Anything may replace or extend this, including the page layout.

The audio element is `#audio` (global `audio`); the current track is `selected`.

## Songs and data

`library/<identifier>/` holds, per song:

| File | What it is |
| --- | --- |
| `record.json` | Title, artist, remix credit, duration, quality, waveform peaks |
| `playback.m4a` | The full mix (AAC) |
| `stems/vocals.m4a`, `drums.m4a`, `bass.m4a`, `other.m4a` | Demucs `htdemucs_ft` separation, sample-aligned with the mix |
| `analysis.json` | 40 frequency bands plus energy, bass and onset envelopes, 20 frames per second, base64 bytes |
| `performance.json` | Stem analysis at 100 frames per second (below) |

Songs: The Fate of Ophelia (Taylor Swift, COASTR. Remix), Desire (Olly Alexander, Bobby Santoni Edit), NBLY (Flume, HARRY bootleg), American Boy (Estelle ft. Kanye West, Jafunk Remix), Outside (Calvin Harris, adjustors1k bootleg).

`performance.json`, produced by `tools/prepare_performance.py` (Demucs stems, Beat This beats and downbeats, CREPE vocal pitch, Whisper word timings):

- `duration`, `tempo`, `beats`, `downbeats` (seconds)
- `kicks`, `claps`: `[{time, strength 0..1}]` from the drum stem
- `words`: `[{word, start, end, probability}]` from the vocal stem
- `sections`: `drops [{time, strength, gap_start}]`, `builds [{start, end}]`, `breakdowns [{start, end}]`, and on most songs `reentries [{time, strength}]`
- `bars`: `[{start, end, vocals, drums, bass, other}]`, each stem's level in decibels below its loud bars
- `series`: each `{lower, upper, data}` with `data` one base64 byte per frame at `rate` (100 per second), mapped to `lower + byte / 255 * (upper - lower)`:
  `bass`, `vocal`, `hats`, `other`, `mix` (levels 0..1), `other_attack` (onset strength), `pitch` (vocal MIDI note, 0 when unvoiced), `pitch_class_0`..`pitch_class_11` (chroma of the other stem, C = 0)

The server adds `stems` to each entry of `/api/tracks` with the four stem addresses. `tools/prepare_performance.py` documents its own dependencies and can analyse more audio.
