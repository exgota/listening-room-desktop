# Visualizer variations: brief

This folder is the Listening room, a personal music player, as it runs on desktop, with its visualizer removed. Build four visualizer variations for it. The owner will compare them across all five songs to choose a direction. The best may become a post on X and may go live on the site.

## The bar

The owner's words: "create something incredible, animation, 2D, 3D, even get technically impressive, create something that's like real-time generation. I don't know, can do anything. Should be coherent, should have proper stem understanding, and I really want it to blow me away, like demonstrate capabilities not even thought of as possible." "The goal is to make a banger for Twitter, and the stretch goal is to make something better than anyone's ever seen before." "If my jaw isn't on the goddamn floor I don't want it."

Think first about what a visualizer is for. It is the centerpiece of this player: what a listener looks at while the song plays. Decide what it should show of a song, and why, before deciding how it looks. There are few public references in this field; the closest are live visuals made for DJs and festival stages. Search for them, and for motion design and real-time graphics work, and form your own view.

A variation that is merely pretty fails. Each one should have something that makes a viewer ask "how is that running in a browser?"

## Taste

These come from the owner's reactions to earlier work. They are a floor, not a style to copy.

- **Motion quality, never speed.** Springs, overshoot that settles, secondary motion that lags its leader, no cuts, no strobe, every state change blended. Design for the real frame rate: the owner's display runs at 100 Hz, video at 60 fps.
- **Legible mapping.** Each stem does one visible thing. With the sound off, a viewer should be able to tell the kick from the bass from the voice.
- **Structure lands.** A build gathers, the gap before a drop holds still, the drop releases enormously. The owner's standing complaint about earlier visualizers: underwhelming at the song's emotional peaks. The picture late in a song should not look like the picture early on; the song's whole arc shows.
- **Fine detail.** The owner has loved fine linework whose tone comes from how densely lines crowd, and a kick's pressure wave visibly travelling through a dense form. Those are data about taste, not requirements.
- **No explanatory text on the page.**
- **Readable code.** Every name uses precise professional vocabulary, spelled out, in the language's standard casing: `removeExpiredSessions`, never `nukeOldSessions`; no slang, no cute names. Comments say why.

The page's palette is paper `#f7f8fa`, charcoal `#20242b` text and a cobalt `#3d5cca` accent. A variation may keep it or depart from it, with a reason.

## Songs

See `README.md` for the data. Tune against the data, not one song: nothing may be hard-coded to one song's timestamps.

| Song | Notes |
| --- | --- |
| Desire, Olly Alexander (Bobby Santoni Edit) | 125 BPM house. Drops 0:45.8, 1:16.3, 2:47.7, 3:48.7. Breakdown 2:21.0–2:30.6 (vocal and synths only), build 2:30.6–2:45.8 (claps, no kick, no bass), gap 2:45.8–2:47.7, "Is it desire?" sung at 2:47.44, then the drop at 2:47.7: the strongest moment in the set. |
| NBLY, Flume (HARRY bootleg) | Chord-led future bass, 139 BPM. The owner called out the synth chords around 2:20–2:25 ("that's where the feeling comes from"), the drop at 2:18.1 after a hole from 2:16.4, the chord section 4:08–4:19 and the second drop at 4:36.3. |
| Outside, Calvin Harris (adjustors1k bootleg) | Big-room house, 136 BPM. Drop at 2:21.2 after a build from 2:07.0. |
| American Boy, Estelle ft. Kanye West (Jafunk Remix) | Funky and vocal-heavy, 118 BPM. Drop at 0:48.8. |
| The Fate of Ophelia, Taylor Swift (COASTR. Remix) | The newest track. |

The included analysis is a starting point. Replace it, extend it or add your own (for example chords, bass notes, onsets per stem, lyrics); `tools/prepare_performance.py` shows how it was made.

## Performance

The owner uses Chrome on an Apple M4 (10-core GPU) with a 1920×1080 display at 100 Hz, device pixel ratio 1. Hold 60 fps there at full window size: aim for 8 ms or less per frame. WebGL2 and WebGPU are both available in that Chrome. Seeking must show the right picture within about 300 ms, and a variation should be able to render any exact song time for video capture.

## Deliverables

For each variation, a folder with its page (served by `server.py` like the main page, or a copy of `site/` with its own `visualizer.js`), a `README.md` (what it is, what drives what, how to run it, what was verified and what was not), a `poster.png` still at 1080×1350, and a 40-second 1080×1350 60 fps video with the song's audio for each song, cut around its strongest moment. Plus one index page that links all four.

Finish with a report: each variation in two sentences, what drives what, its three strongest moments with song and timestamp, measured frame times, and anything unverified. Be honest about weaknesses.

## Working method

Iterate. Watch your own output many times: contact sheets across a whole song, frame-by-frame through drops, stills at specific moments. Judge each against the bar and rework what falls short, including going back on the concept itself. At least three full review cycles per variation before the final renders. If it would not stop a thumb scrolling X, keep going.
