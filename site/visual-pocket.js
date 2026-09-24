// Pocket: a troupe of cut-paper figures, one per instrument, on a small stage. Every
// movement is keyed to that instrument's own onsets, so the groove on screen is the band's
// groove: the kit's drum (a black disc) touches the floor exactly on each kick, and once the
// kit grows its two cymbals ring on the off-beat hats and on the swung sixteenth, so the row
// spells the pattern; the bass (a red dome, taller for a higher note) winds up before each
// note and lands on it, wherever the bass line pushes or lays back; the hands above it clap
// on beats two and four; the singer, a cut-paper profile, opens its mouth with the voice and
// snaps its lean on the beat and on the song's measured swung sixteenth. Under the stage the
// pocket itself: one beat, four sixteenth cells, where every onset of the last two bars is
// stamped at the place in the beat it actually landed, so swing and push show as offsets in
// a single frame. The stage shows who is playing: a performer rises through the floor to
// arrive on its first note and sinks when its part ends, and each has its own column. A
// build steps the field darker bar by bar, closes the hands a notch per bar and gathers the
// troupe; the gap holds them in the air on night; the main drop lands in the song's own
// colour for its whole section; after the song's turn the stage is dark. The song opens and
// closes on its poster: the troupe posed in that colour.

const pocketInk = {
  cream: "#f2e8d3",
  black: "#151413",
  tomato: "#e4472b",
  mustard: "#eab12c",
  cobalt: "#2749b5",
};
const pocketFields = {
  cream: "#f2e8d3",
  blush: "#f6c6cf",
  mint: "#bfe2d3",
  sky: "#c2d3ee",
  lilac: "#d9d0f0",
  night: "#151413",
  ink: "#17213f",
  aubergine: "#2b1a33",
  bottle: "#10302a",
};
const pocketDark = ["ink", "bottle", "aubergine"];
const pocketPale = ["cream", "mint", "blush", "sky", "lilac"];
// Each song's opening field, stage order (it turns at each drop) and its own main-drop colour.
const pocketSongs = {
  "5ff86d6cd02ebd7308e03df8": { field: "sky", order: ["singer", "drum", "bass"], main: "#2749b5" }, // NBLY: cobalt
  "1d589940ca458d793a3fad8a": { field: "blush", order: ["drum", "bass", "singer"], main: "#e4472b" }, // Desire: tomato
  f127a026dc751f1528bfb95d: { field: "mint", order: ["bass", "singer", "drum"], main: "#1bb07a" }, // Ophelia: emerald
  "8eee874c702a10807f79706c": { field: "cream", order: ["drum", "singer", "bass"], main: "#eab12c" }, // Outside: mustard
  "4048d4a6dce44c151690b2b1": { field: "lilac", order: ["bass", "drum", "singer"], main: "#6b3fd6" }, // American Boy: violet
};
const pocketRise = 0.5; // seconds to rise through the floor or sink through it

registerVisualizer({
  key: "pocket",
  name: "Pocket",
  order: 3,
  create() {
    const canvas = createVisualCanvas();
    const context = canvas.getContext("2d");
    let song = null;
    let scale = 1;
    let presence = null;
    let themeField = "";
    let swingLate = 0; // where the swung sixteenth lands, in beats past the straight one
    let sceneFields = [];
    let segments = [];
    let segmentStarts = new Float64Array(0);
    let setup = { field: "cream", order: ["drum", "bass", "singer"], main: "#e4472b" };
    let bassLow = 28,
      bassHigh = 52;
    let layoutKey = "";
    let songEnd = Infinity;
    let finale = Infinity; // the last downbeat: the troupe takes its closing pose
    let mainSection = null; // [start, end] of the main drop's section
    let fieldRuns = []; // per scene: [start, end] of the run of scenes sharing its field
    let introColourEnd = 0; // the intro plays in the song's own colour until its first phrase ends
    const layouts = new Map();
    // A cut edge per figure: fixed small irregularities so the shapes read as cut paper.
    const cutEdge = Array.from({ length: 64 }, (_, index) => 1 + (hash01(index * 31 + 7) - 0.5) * 0.035);
    // Onset lists: the drum lands on kicks and drop frames; the cymbals on the off-beat hats
    // and on the late (swung) sixteenth hats; the hands on strong events on beats 2 and 4.
    let landing = new SongEvents([]);
    let offbeats = new SongEvents([]);
    let lates = new SongEvents([]);
    let backbeats = new SongEvents([]);

    function setSong(model) {
      song = model;
      presence = null;
      themeField = "";
      sceneFields = [];
      segments = [];
      segmentStarts = new Float64Array(0);
      layouts.clear();
      landing = offbeats = lates = backbeats = new SongEvents([]);
      songEnd = finale = Infinity;
      mainSection = null;
      fieldRuns = [];
      introColourEnd = 0;
      if (!model) return;
      setup = pocketSongs[model.identifier] || { field: "cream", order: ["drum", "bass", "singer"], main: "#e4472b" };
      // The claps: strong snare-band events on beats two and four (when most strong events
      // are there; otherwise all strong ones).
      const strong = [],
        onBackbeat = [];
      for (let index = 0; index < model.snares.length; index++) {
        if (model.snares.strength[index] <= 0.4) continue;
        const event = [model.snares.time[index], model.snares.strength[index]];
        strong.push(event);
        const position = fract(model.barPosition(event[0])) * 4;
        const beat = Math.round(position);
        if (Math.abs(position - beat) < 0.12 && (beat === 1 || beat === 3)) onBackbeat.push(event);
      }
      backbeats = new SongEvents(onBackbeat.length >= strong.length * 0.4 ? onBackbeat : strong);
      const events = [];
      for (let index = 0; index < model.kicks.length; index++) events.push([model.kicks.time[index], model.kicks.strength[index]]);
      for (const drop of model.drops) if (!events.some(([time]) => Math.abs(time - drop.time) < 0.03)) events.push([drop.time, 1]);
      events.sort((first, second) => first[0] - second[0]);
      landing = new SongEvents(events);
      // Swing, measured: the median place of bass notes that fall in the last quarter of the
      // beat, against the straight sixteenth at 0.75.
      const late = [];
      for (let index = 0; index < model.bassNotes.length; index++) {
        const phase = fract(model.beatPosition(model.bassNotes.start[index]));
        if (phase > 0.6 && phase < 0.97) late.push(phase);
      }
      late.sort((a, b) => a - b);
      swingLate = late.length > 20 ? clampRange(late[late.length >> 1] - 0.75, 0, 0.15) : 0;
      // The cymbals' hats: the off-beat ones, and the late sixteenths (where swing shows).
      const off = [],
        lateHats = [];
      for (let index = 0; index < model.hats.length; index++) {
        if (model.hats.strength[index] < 0.25) continue;
        const phase = fract(model.beatPosition(model.hats.time[index]));
        const event = [model.hats.time[index], model.hats.strength[index]];
        if (phase > 0.4 && phase < 0.6) off.push(event);
        else if (phase >= 0.62 && phase < 0.97) lateHats.push(event);
      }
      // where the hats carry no swing (American Boy swings in its bass), the swing cymbal
      // rings on the bass notes that land late in the beat, and weaker off-beat hats count
      if (off.length < model.downbeats.length)
        for (let index = 0; index < model.hats.length; index++) {
          const phase = fract(model.beatPosition(model.hats.time[index]));
          if (model.hats.strength[index] >= 0.12 && model.hats.strength[index] < 0.25 && phase > 0.4 && phase < 0.6) off.push([model.hats.time[index], model.hats.strength[index]]);
        }
      off.sort((a, b) => a[0] - b[0]);
      if (lateHats.length < model.downbeats.length && swingLate > 0.04) {
        lateHats.length = 0;
        for (let index = 0; index < model.bassNotes.length; index++) {
          const phase = fract(model.beatPosition(model.bassNotes.start[index]));
          if (phase > 0.6 && phase < 0.97) lateHats.push([model.bassNotes.start[index], Math.max(0.5, model.bassNotes.strength[index])]);
        }
      }
      offbeats = new SongEvents(off);
      lates = new SongEvents(lateHats);
      // The bass line's range, for the dome's height.
      const pitches = Array.from(model.bassNotes.pitch).sort((a, b) => a - b);
      if (pitches.length > 8) {
        bassLow = pitches[Math.floor(pitches.length * 0.05)];
        bassHigh = Math.max(bassLow + 5, pitches[Math.floor(pitches.length * 0.95)]);
      }
      // The song's end: the last moment anything sounds (a bar before the file ends when the
      // mix never falls silent); the closing pose from the last downbeat before it.
      const mix = model.series.mix;
      songEnd = model.duration;
      if (mix) {
        let index = mix.length - 1;
        while (index > 0 && mix[index] < 0.08) index--;
        songEnd = Math.min(model.duration, index / 100 + 0.3);
        if (songEnd > model.duration - 0.5) songEnd = model.duration - model.barPeriod;
      }
      finale = model.barTime(model.barIndex(songEnd - 0.05));
      // The main drop's section keeps the song's colour.
      if (model.mainDrop >= 0) {
        const time = model.drops[model.mainDrop].time;
        const scene = model.scene(time + 0.01);
        mainSection = [time, Math.max(scene.end, time + 4 * model.barPeriod)];
      }
      // Each scene's field: pale before the turn (a partner tone every eight bars keeps long
      // scenes moving), dark after it; night only for the holds.
      const turn = model.lateStart;
      let darkIndex = 0;
      model.scenes.forEach((scene, index) => {
        const after = scene.start >= turn - 0.05;
        let field;
        if (index === 0) field = setup.field;
        else if (scene.end - scene.start < 1) field = sceneFields[index - 1]; // a sliver keeps the last look
        else if (scene.kind === "gap") field = "night";
        else if (after) field = pocketDark[darkIndex++ % pocketDark.length];
        else
          switch (scene.kind) {
            case "verse": field = "blush"; break;
            case "break": field = "sky"; break;
            case "groove": field = "mint"; break;
            case "build": field = "blush"; break;
            default: field = ["cream", "mint", "lilac"][scene.kindIndex % 3];
          }
        sceneFields.push(field);
      });
      fieldRuns = sceneFields.map(() => [0, 0]);
      for (let index = 0; index < sceneFields.length; ) {
        let end = index;
        while (end + 1 < sceneFields.length && sceneFields[end + 1] === sceneFields[index]) end++;
        for (let inner = index; inner <= end; inner++) fieldRuns[inner] = [model.scenes[index].start, model.scenes[end].end];
        index = end + 1;
      }
      introColourEnd = model.scenes.length ? Math.max(model.barTime(2), Math.min(model.scenes[0].end, model.barTime(8))) : 0;
      presence = findPresence(model);
      segments = findSegments(model);
      segmentStarts = Float64Array.from(segments.map((segment) => segment.start));
    }

    // Who is playing: each part from the first bar it plays until two quiet bars; gaps under
    // four bars are bridged and fragments under two bars dropped, so no one bobs in and out.
    function findPresence(model) {
      const bars = model.downbeats;
      const result = {};
      for (const [figure, series, floor] of [["drum", null, 0], ["bass", "bass", 0.18], ["singer", "vocal", 0.2], ["hands", null, 0]]) {
        const spans = [];
        let open = null,
          quiet = 0;
        for (let index = 0; index < bars.length; index++) {
          const start = bars[index],
            end = index + 1 < bars.length ? bars[index + 1] : model.duration;
          let on;
          if (figure === "drum") on = model.kicks.last(end - 0.001) - model.kicks.last(start) >= 2;
          else if (figure === "hands") on = backbeats.last(end - 0.001) > backbeats.last(start);
          else on = model.mean(series, start, end) > floor;
          if (on) {
            quiet = 0;
            if (!open) open = { start: Math.max(0, start), end };
            open.end = end;
          } else if (open && ++quiet >= 2) {
            spans.push(open);
            open = null;
          }
        }
        if (open) spans.push(open);
        const merged = [];
        for (const span of spans) {
          const last = merged[merged.length - 1];
          if (last && span.start - last.end < 4 * model.barPeriod) last.end = span.end;
          else merged.push({ start: span.start, end: span.end });
        }
        result[figure] = merged.filter((span) => span.end - span.start >= 2 * model.barPeriod);
      }
      return result;
    }

    // The stage over the song: a list of segments, each the troupe's target arrangement
    // (who is on, in which order, how big the kit is, who is featured) and how long the move
    // into it takes (0 for a drop: the drop is a cut to the new marks).
    function findSegments(model) {
      const dropAt = (time) => {
        for (const drop of model.drops) if (Math.abs(drop.time - time) < 0.25) return drop.time;
        return -1;
      };
      // A part that starts within the first four bars is on stage from the first frame; the
      // singer waits on stage for its first line if that comes within sixteen bars. In the
      // outro nobody leaves: the troupe stays for its closing pose.
      const openingReach = model.barTime(4);
      const firstSong = presence.singer.length ? presence.singer[0] : null;
      const outro = model.scenes.find((scene, index) => scene.kind === "outro" && model.scenes.slice(index).every((next) => next.kind === "outro"));
      const outroStart = outro ? outro.start : finale;
      const enterTime = (span) => {
        const drop = dropAt(span.start);
        if (span === firstSong && span.start <= model.barTime(16)) return 0;
        if (drop >= 0) return drop;
        return span.start <= openingReach ? 0 : Math.max(0, span.start - pocketRise);
      };
      const leaveTime = (span) => {
        if (span.end >= outroStart - 0.05) return Infinity;
        const drop = dropAt(span.end);
        return drop >= 0 ? drop : span.end;
      };
      const members = (time) => {
        const on = new Set();
        for (const figure of ["drum", "bass", "singer", "hands"])
          for (const span of presence[figure]) if (time >= enterTime(span) && time < leaveTime(span)) on.add(figure);
        if (!on.size) {
          // silence: the band waits on stage for the part that comes next
          let next = null;
          for (const figure of ["drum", "bass", "singer"])
            for (const span of presence[figure]) if (span.start > time && (!next || span.start < next.start)) next = { figure, start: span.start };
          on.add(next ? next.figure : "singer");
        }
        return on;
      };
      const hard = [{ time: 0, duration: 0 }];
      for (const figure of ["drum", "bass", "singer", "hands"])
        for (const span of presence[figure]) {
          const enter = enterTime(span);
          if (enter > 0) hard.push({ time: enter, duration: dropAt(span.start) >= 0 ? 0 : pocketRise });
          const leave = leaveTime(span);
          if (leave < Infinity) hard.push({ time: leave, duration: dropAt(span.end) >= 0 ? 0 : pocketRise });
        }
      for (const drop of model.drops) hard.push({ time: drop.time, duration: 0 });
      if (model.lateStart < Infinity) hard.push({ time: model.lateStart, duration: 0.6 });
      // A new feature every eight bars and at each scene, unless a harder change is near.
      const soft = [];
      for (let bar = 8; bar < model.downbeats.length; bar += 8) soft.push({ time: model.barTime(bar), duration: 0.6 });
      for (const scene of model.scenes) soft.push({ time: scene.start, duration: 0.6 });
      const all = hard.concat(soft.filter((entry) => !hard.some((other) => Math.abs(other.time - entry.time) < model.barPeriod)));
      all.sort((a, b) => a.time - b.time || a.duration - b.duration);
      const result = [];
      for (const boundary of all) {
        const settled = boundary.time + boundary.duration + 0.001;
        let dropsPassed = 0;
        for (const drop of model.drops) if (drop.time <= boundary.time + 0.001) dropsPassed++;
        const on = members(settled);
        const turn = dropsPassed % setup.order.length;
        const order = setup.order.slice(turn).concat(setup.order.slice(0, turn));
        const scene = model.scene(settled);
        const phrase = Math.max(0, Math.floor(model.barIndex(settled) / 8));
        // Every eight bars someone else is featured, so the composition itself moves: in verses
        // and breakdowns the singer and the rest take turns; elsewhere the feature walks along
        // the stage order.
        const present = order.filter((name) => on.has(name));
        let feature = null;
        if (scene.kind === "verse" || scene.kind === "break") feature = phrase % 2 ? "singer" : present.find((name) => name !== "singer") || null;
        else if (scene.kind === "gap") feature = result.length ? result[result.length - 1].feature : null; // the gap holds
        else if (scene.kind !== "build" && (scene.kind !== "drop" || settled - scene.start > 7.5 * model.barPeriod) && present.length > 1) feature = present[phrase % present.length];
        if (feature && !on.has(feature)) feature = null;
        // the kit grows: the off-beat cymbal after the first drop, the swing cymbal after the turn
        const kit = 1 + (dropsPassed > 0 ? 1 : 0) + (settled >= model.lateStart ? 1 : 0);
        const segment = {
          start: boundary.time,
          duration: boundary.duration,
          order: order.filter((name) => (name === "bass" ? on.has("bass") || on.has("hands") : on.has(name))),
          dome: on.has("bass"),
          hands: on.has("hands"),
          kit,
          feature,
        };
        const previous = result[result.length - 1];
        if (previous && previous.order.join() === segment.order.join() && previous.dome === segment.dome && previous.hands === segment.hands && previous.kit === segment.kit && previous.feature === segment.feature) continue;
        if (previous && Math.abs(previous.start - segment.start) < 0.05) {
          result[result.length - 1] = { ...segment, start: previous.start, duration: Math.min(previous.duration, segment.duration) };
          continue;
        }
        result.push(segment);
      }
      return result;
    }

    // Column widths and the scale each performer can take before it would leave the stage
    // (in 1080ths of the frame height).
    const drumRadius = 150;
    function columnWidth(segment, name, size) {
      if (name === "drum") return (drumRadius * 2.8 + (segment.kit > 1 ? 2 * drumRadius * 1.25 : 0)) * size;
      if (name === "bass") return (segment.dome ? 680 : 520) * size;
      if (name === "spacer") return size;
      return 400 * size;
    }
    function columnCap(segment, name, room) {
      if (name === "drum") return room / (200 + 2 * drumRadius);
      if (name === "bass") return segment.dome && segment.hands ? (room - 30) / 614 : segment.dome ? room / 390 : room / 330;
      if (name === "spacer") return Infinity;
      return 1.6;
    }

    // Where each performer stands in a segment: the columns in order, each as large as the
    // stage allows (the featured one larger), spaced evenly. Nothing overlaps by construction.
    // The poster keeps the middle clear for the play button.
    function layoutFor(index, left, right, room, unit, poster = false, frameMiddle = 0) {
      const cacheKey = poster ? `poster${index}:${frameMiddle ? "gap" : "closed"}` : index;
      const cached = layouts.get(cacheKey);
      if (cached) return cached;
      const segment = poster ? { order: setup.order, dome: true, hands: true, kit: 3, feature: "singer" } : segments[index];
      let names = segment.order.slice();
      if (poster && frameMiddle) names.splice(Math.ceil(names.length / 2), 0, "spacer");
      const base = (name) => (name === "spacer" ? 240 : segment.feature && names.length > 1 ? (name === segment.feature ? 1.3 : 0.9) : 1);
      const span = (right - left) / unit;
      const gap = 50;
      const nominal = names.reduce((sum, name) => sum + columnWidth(segment, name, base(name)), 0);
      const fit = Math.min(1.45, (span - gap * (names.length + 1)) / Math.max(1, nominal));
      // (a performer not featured stays well under its cap, so a swap shows even on a full stage)
      const sizes = names.map((name) => (name === "spacer" ? 240 : Math.min(base(name) * fit, columnCap(segment, name, room) * (segment.feature && names.length > 1 && name !== segment.feature ? 0.75 : 1), 1.6)));
      const widths = names.map((name, column) => columnWidth(segment, name, sizes[column]));
      const spacing = (span - widths.reduce((sum, value) => sum + value, 0)) / (names.length + 1);
      const result = {};
      let x = spacing,
        spacerX = 0;
      names.forEach((name, column) => {
        if (name !== "spacer") result[name] = { x: left + (x + widths[column] / 2) * unit, size: sizes[column], half: (widths[column] / 2) * unit };
        else spacerX = left + (x + widths[column] / 2) * unit;
        x += widths[column] + spacing;
      });
      if (poster && frameMiddle) {
        // the play button stands at the middle of the frame: move the gap there, drawing the
        // row in about that middle if it would leave the stage
        const shift = frameMiddle - spacerX;
        let reach = 1;
        for (const entry of Object.values(result)) {
          const cx = entry.x + shift;
          if (cx - entry.half < left) reach = Math.min(reach, (frameMiddle - left) / Math.max(1, frameMiddle - (cx - entry.half)));
          if (cx + entry.half > right) reach = Math.min(reach, (right - frameMiddle) / Math.max(1, cx + entry.half - frameMiddle));
        }
        for (const entry of Object.values(result)) {
          entry.x = frameMiddle + (entry.x + shift - frameMiddle) * reach;
          entry.size *= reach;
        }
      }
      layouts.set(cacheKey, result);
      return result;
    }

    // How awake a figure is: 0 resting (its instrument is silent), 1 playing.
    function awake(figure, time) {
      const spans = presence?.[figure];
      if (!spans) return 1;
      for (const span of spans) {
        if (time >= span.start - 0.45 && time < span.end + 0.6) {
          if (time < span.start) return easeInCubic(1 - (span.start - time) / 0.45);
          if (time > span.end) return 1 - easeInOutCubic((time - span.end) / 0.6);
          return 1;
        }
      }
      return 0;
    }

    function paperShape(points, color) {
      context.fillStyle = color;
      context.beginPath();
      points.forEach(([x, y], index) => (index ? context.lineTo(x, y) : context.moveTo(x, y)));
      context.closePath();
      context.fill();
    }

    function disc(cx, cy, rx, ry, color, seed = 0, tilt = 0) {
      context.fillStyle = color;
      context.beginPath();
      const cos = Math.cos(tilt),
        sin = Math.sin(tilt);
      for (let index = 0; index < 48; index++) {
        const angle = (index / 48) * Math.PI * 2;
        const wobble = cutEdge[(index + seed) % 64];
        const x = Math.cos(angle) * rx * wobble,
          y = Math.sin(angle) * ry * wobble;
        const px = cx + x * cos - y * sin,
          py = cy + x * sin + y * cos;
        if (index) context.lineTo(px, py);
        else context.moveTo(px, py);
      }
      context.closePath();
      context.fill();
    }

    function dome(cx, floor, width, height, color) {
      context.fillStyle = color;
      context.beginPath();
      for (let index = 0; index <= 32; index++) {
        const angle = Math.PI + (index / 32) * Math.PI;
        const wobble = cutEdge[(index + 11) % 64];
        const y = floor + Math.sin(angle) * height * wobble;
        const x = cx + Math.cos(angle) * width * 0.5 * wobble;
        if (index) context.lineTo(x, y);
        else context.moveTo(x, y);
      }
      context.closePath();
      context.fill();
    }

    // Height of a disc between its landings: on the floor at each, a parabola between them,
    // lower when they come faster. With no landing for a while it rests, and hops up in time
    // to land on the next one.
    function bounce(events, time, maximum, perSecond) {
      const index = events.last(time);
      const next = index + 1 < events.length ? events.time[index + 1] : Infinity;
      const last = index >= 0 ? events.time[index] : -Infinity;
      const strength = index >= 0 ? events.strength[index] : 0;
      const gap = next - last;
      if (gap <= 1.6) {
        const u = (time - last) / gap;
        return { height: Math.min(maximum, gap * perSecond) * 4 * u * (1 - u), age: time - last, strength };
      }
      const toNext = next - time;
      if (toNext < 0.4) {
        const u = 1 - toNext / 0.4;
        return { height: Math.min(maximum, 0.4 * perSecond) * 4 * u * (1 - u), age: time - last, strength };
      }
      return { height: 0, age: time - last, strength };
    }

    // The dome's shape for a bass note: taller and narrower for a higher note, same area.
    function domeShape(index) {
      const pitch = index >= 0 ? song.bassNotes.pitch[index] : (bassLow + bassHigh) / 2;
      const height = 200 + 100 * clamp01((pitch - bassLow) / (bassHigh - bassLow));
      return { width: 120000 / height, height };
    }

    // Colours for a field: the figures keep theirs unless the field would swallow them.
    function colorsFor(fieldColor) {
      const [r, g, b] = fieldColor;
      const dark = r + g + b < 1.2;
      const near = (hex) => {
        const [x, y, z] = hexColor(hex);
        return Math.abs(x - r) + Math.abs(y - g) + Math.abs(z - b) < 0.55;
      };
      return {
        dark,
        ink: dark ? pocketInk.cream : pocketInk.black,
        singer: dark && b > r && b > g ? "#f4a3c0" : near(pocketInk.cobalt) ? pocketInk.cream : dark ? "#6f8ef7" : pocketInk.cobalt,
        dome: near(pocketInk.tomato) || (r > 0.35 && g < 0.3 && dark) ? pocketInk.cream : pocketInk.tomato,
        hands: near(pocketInk.mustard) ? pocketInk.black : pocketInk.mustard,
      };
    }

    function render(time, frame) {
      const width = frame.width,
        height = frame.height;
      context.setTransform(scale, 0, 0, scale, 0, 0);
      if (!song || !segments.length) {
        context.fillStyle = pocketFields.cream;
        context.fillRect(0, 0, width, height);
        return;
      }
      const unit = height / 1080;
      const floor = height * 0.72;
      // nothing rises into the title
      const ceiling = Math.max(height * 0.2, (frame.titleBottom || 0) + 12 * unit);
      const room = (floor - ceiling) / unit;
      const sceneIndex = song.sceneIndex(time);
      const drop = song.dropContext(time);
      const leadIn = song.anchor.kind === "lead_in" ? song.anchorAt(time) : -1;
      const inGap = drop.phase === 2 || leadIn >= 0;
      const sinceDrop = drop.phase === 3 ? drop.since : Infinity;
      const hit = sinceDrop < song.barPeriod;
      const windUp = drop.phase === 1 ? drop.progress : 0;
      // The poster: the first moment and the closing bar.
      const posterIn = time < 0.35 ? 1 : time < 0.7 ? 1 - easeInOutCubic((time - 0.35) / 0.35) : 0;
      const posterOut = time >= finale ? 1 : 0;
      const poster = Math.max(posterIn, posterOut);
      // Build progress in whole bars: the build steps once a bar.
      let barsDone = 0,
        barsTotal = 1;
      if (drop.phase === 1) {
        const startBar = song.barIndex(drop.build.start + 0.01);
        barsTotal = Math.max(1, song.barIndex(drop.build.end - 0.01) + 1 - startBar);
        barsDone = clamp01((song.barIndex(time) - startBar + easeOutCubic(clamp01(fract(song.barPosition(time)) / 0.15))) / barsTotal);
      }

      // Field: the scene's (held through a build from where the build began); in a chord
      // passage the chord's; a build steps it darker bar by bar (on the dark stage, hotter);
      // the gap is night; the main drop's section is the song's colour; later drops flash
      // cream for their first bar.
      let fieldName = sceneFields[drop.phase === 1 ? song.sceneIndex(drop.build.start + 0.01) : sceneIndex];
      const peak = song.peakAt(time);
      if (peak && peak.kind === "chords") {
        const chordIndex = song.chordIndex(time);
        if (chordIndex >= 0) {
          const before = sceneFields[song.sceneIndex(peak.start - 0.05)];
          const pick = (index) => pocketPale[(((song.chords[index].root * 7) % 12) + 12) % 5];
          fieldName = pick(chordIndex);
          if (chordIndex > 0 && song.chords[chordIndex - 1].start >= peak.start - 0.5 && pick(chordIndex - 1) === fieldName) fieldName = pocketPale[(pocketPale.indexOf(fieldName) + 1) % 5];
          if (fieldName === before) fieldName = pocketPale[(pocketPale.indexOf(fieldName) + 2) % 5];
        }
      }
      // A run of scenes on one field opens on it and takes a partner field (another of the
      // pale five, or of the dark three; never a grey mix) for every second eight bars of the
      // run, so a long stretch moves; a partner block under four bars is skipped.
      if ((pocketPale.includes(fieldName) || pocketDark.includes(fieldName)) && drop.phase !== 1 && !(peak && peak.kind === "chords") && fieldRuns[sceneIndex]) {
        const opened = song.barIndex(fieldRuns[sceneIndex][0] + 0.01);
        const closes = song.barIndex(fieldRuns[sceneIndex][1] - 0.01) + 1;
        const block = Math.floor(Math.max(0, song.barIndex(time) - opened) / 8);
        if (block % 2 === 1 && Math.min(opened + (block + 1) * 8, closes) - (opened + block * 8) >= 4)
          fieldName = pocketPale.includes(fieldName) ? pocketPale[(pocketPale.indexOf(fieldName) + 3) % 5] : pocketDark[(pocketDark.indexOf(fieldName) + 1) % 3];
      }
      let fieldColor = hexColor(pocketFields[fieldName] || pocketFields.cream);
      const baseColors = colorsFor(fieldColor);
      let colors = baseColors;
      if (windUp > 0) {
        const holeless = drop.drop.gapStart >= drop.drop.time - 0.05;
        fieldColor = mixColor(fieldColor, hexColor(pocketFields.night), (holeless ? 0.8 : 0.55) * barsDone);
        if (!baseColors.dark && 0.2126 * fieldColor[0] + 0.7152 * fieldColor[1] + 0.0722 * fieldColor[2] < 0.45) colors = { ...baseColors, singer: pocketInk.cream };
      }
      const inMain = mainSection && time >= mainSection[0] && time < mainSection[1];
      if (sceneIndex === 0 && time < introColourEnd) {
        fieldColor = hexColor(setup.main);
        colors = colorsFor(fieldColor);
      }
      if (inMain && time - mainSection[0] < 0.1) {
        // the main drop's first frames: a cream flash, the hardest landing of the song
        fieldColor = hexColor(pocketFields.cream);
        colors = colorsFor(fieldColor);
      } else if (inMain) {
        fieldColor = hexColor(setup.main);
        colors = colorsFor(fieldColor);
      } else if (hit && drop.index !== song.mainDrop && baseColors.dark) {
        fieldColor = hexColor(pocketFields.cream);
        colors = colorsFor(fieldColor);
      }
      if (inGap) {
        fieldColor = hexColor(pocketFields.night);
        colors = colorsFor(fieldColor);
      }
      if (poster > 0) {
        fieldColor = mixColor(fieldColor, hexColor(setup.main), poster);
        colors = poster > 0.5 ? colorsFor(hexColor(setup.main)) : colors;
      }
      const dark = colors.dark;
      const field = cssColor(fieldColor);
      if (field !== themeField) {
        themeField = field;
        document.documentElement.style.setProperty("--pocket-field", field);
        document.documentElement.style.setProperty("--pocket-ink", colors.ink);
        waveformTheme = null;
      }
      context.fillStyle = field;
      context.fillRect(0, 0, width, height);
      // Floor: the field, a shade darker; the pocket lane lives on it.
      context.fillStyle = cssColor(mixColor(fieldColor, dark ? [1, 1, 1] : [0, 0, 0], dark ? 0.1 : 0.12));
      context.fillRect(0, floor, width, height - floor);

      // Wind-up: everyone crouches through a build and the troupe gathers bar by bar; the
      // last bar trembles hard; the gap holds them in the air, stretched; the drop lands them.
      const crouch = inGap ? 0 : 0.55 * barsDone;
      const lastBar = drop.phase === 1 && barsDone > 1 - 1 / barsTotal;
      const shake = windUp > 0 && !inGap ? Math.sin(song.beatPosition(time) * Math.PI * 8) * (lastBar ? 60 : 6 + 14 * barsDone) * unit : 0;
      const gather = 1 - 0.3 * (inGap ? 1 : drop.phase === 1 ? barsDone : 0);
      let hang = 0;
      if (inGap) {
        const holdStart = drop.phase === 2 ? drop.drop.gapStart : song.anchor.moments[leadIn].start;
        hang = easeOutCubic(clamp01((time - holdStart) / 0.25));
      }
      const slam = sinceDrop < 0.25 ? 1 - sinceDrop / 0.25 : 0;
      const liftFor = (maximum, depth) => hang * (1 - depth) * Math.min(maximum, room * unit * 0.4);
      // the main drop lands the cast a size larger, settling over its first bar
      const grow = drop.phase === 3 && drop.index === song.mainDrop ? 1 + 0.35 * (1 - easeInOutCubic(clamp01(sinceDrop / song.barPeriod))) : 1;

      // The key word: small in the free band right of the title, or, sung into the main drop,
      // across the stage behind the troupe.
      const word = song.anchor.kind === "word" ? song.anchor.word.toUpperCase() : "";
      let wordState = null;
      if (word) {
        const index = lastIndexAtOrBefore(song.anchorStarts, time);
        if (index >= 0) {
          const moment = song.anchor.moments[index];
          const main = song.mainDrop >= 0 && Math.abs(song.drops[song.mainDrop].time - moment.start) < 1.2;
          const holdEnd = main ? song.drops[song.mainDrop].time + song.barPeriod : Math.min(index + 1 < song.anchor.moments.length ? song.anchor.moments[index + 1].start : Infinity, Math.max(moment.end, moment.start + 0.8));
          if (time < holdEnd) wordState = { main, age: time - moment.start, index };
        }
      }

      // The stage: this segment's arrangement, moved into from the last one's (or the poster).
      const slipHeight = Math.min(38 * unit, (room * unit * 0.9) / Math.max(8, song.anchor.moments.length));
      let slipWidth = 0;
      if (word) {
        context.font = `800 ${slipHeight * 0.78}px "Jost", sans-serif`;
        slipWidth = context.measureText(word).width + slipHeight * 0.6;
      }
      const stageLeft = width * 0.03,
        stageRight = width * 0.97 - (word ? slipWidth + 30 * unit : 0);
      const key = `${width}x${height}:${ceiling}:${stageRight}`;
      if (key !== layoutKey) {
        layoutKey = key;
        layouts.clear();
      }
      const segmentIndex = Math.max(0, lastIndexAtOrBefore(segmentStarts, time));
      const segment = segments[segmentIndex];
      const progress = segment.duration > 0 ? clamp01((time - segment.start) / segment.duration) : 1;
      let before = layoutFor(Math.max(0, segmentIndex - 1), stageLeft, stageRight, room, unit);
      let after = layoutFor(segmentIndex, stageLeft, stageRight, room, unit);
      const previousSegment = segments[Math.max(0, segmentIndex - 1)];
      // Who arrives makes room first and rises after; who leaves sinks first and the others
      // close up after: nobody crosses anybody.
      const arriving = Object.keys(after).some((name) => !before[name]);
      const leaving = Object.keys(before).some((name) => !after[name]);
      const move = easeInOutCubic(arriving ? clamp01(progress / 0.6) : leaving ? clamp01((progress - 0.4) / 0.6) : progress);
      const posterLayout = poster > 0 ? layoutFor(0, stageLeft, stageRight, room, unit, true, frame.playing === false ? width / 2 : 0) : null;
      const middle = (stageLeft + stageRight) / 2;
      const squeeze = (entry) => (entry ? { x: middle + (entry.x - middle) * gather, size: entry.size * gather, depth: entry.depth } : null);
      const place = (name) => {
        const a = before[name],
          b = after[name];
        let entry = null;
        if (a && b) entry = { x: mixValue(a.x, b.x, move), size: mixValue(a.size, b.size, move), depth: 0 };
        else if (b) entry = { x: b.x, size: b.size, depth: 1 - easeOutCubic(clamp01((progress - 0.4) / 0.6)) };
        else if (a && progress < 1) entry = { x: a.x, size: a.size, depth: easeInCubic(clamp01(progress / 0.6)) };
        if (posterLayout && posterLayout[name]) {
          const p = posterLayout[name];
          entry = entry ? { x: mixValue(entry.x, p.x, poster), size: mixValue(entry.size, p.size, poster), depth: entry.depth * (1 - poster) } : poster > 0.02 ? { x: p.x, size: p.size, depth: 1 - poster } : null;
        }
        return squeeze(entry);
      };

      // The main drop's word stands behind the troupe, across the stage.
      if (wordState && wordState.main) {
        const size = Math.min(400 * unit, (floor - ceiling) * 0.95, (width * 0.9) / (word.length * 0.62));
        context.font = `800 ${size}px "Jost", sans-serif`;
        const total = context.measureText(word).width;
        const pop = easeOutBack(clamp01(wordState.age / 0.12));
        const settle = song.mainDrop >= 0 ? clamp01((time - song.drops[song.mainDrop].time) / song.barPeriod) : 1;
        context.fillStyle = cssColor(mixColor(fieldColor, hexColor(colors.ink), time < song.drops[song.mainDrop].time ? 0.4 : 1 - 0.6 * easeInOutCubic(settle)));
        context.save();
        context.translate(width / 2, (ceiling + floor) / 2 + size * 0.34);
        context.scale(0.7 + 0.3 * pop, 0.7 + 0.3 * pop);
        context.fillText(word, -total / 2, 0);
        context.restore();
      }

      context.save();
      context.beginPath();
      context.rect(0, 0, width, floor);
      context.clip();

      // Voice → the singer: a cut-paper profile, a flared skirt and a round head facing the
      // middle of the stage; taller with the pitch; its mouth, a notch cut from the head,
      // opens with the voice; it snaps its lean on the beat and on the swung sixteenth.
      const singer = place("singer");
      if (singer) {
        const singerAwake = Math.max(awake("singer", time), poster);
        const size = singer.size * grow;
        const x = singer.x + shake;
        const facing = x < middle ? 1 : -1;
        const pitch = song.value("pitch", time);
        const level = poster > 0.5 ? 0.8 : clamp01((song.value("vocal", time) - 0.15) / 0.6);
        const range = pitch > 0 ? clamp01((pitch - 50) / 28) : 0.4;
        const phase = fract(song.beatPosition(time));
        const snap = (age) => easeOutBack(clamp01(age / 0.08));
        // one snap a beat: on the swung sixteenth in a swung song (with a bigger throw), on the
        // beat otherwise; it eases back through the rest of the beat
        const swung = swingLate > 0.06;
        const since = fract(phase - (swung ? 0.75 + swingLate : 0));
        const lean = since < 0.1 ? mixValue(-1, 1, snap(since)) : 1 - 2 * easeInOutCubic((since - 0.1) / 0.9);
        const sway = clampRange(lean, -1, 1) * (swung ? 0.2 : 0.1) * singerAwake * (1 - windUp) * (1 - poster);
        const bodyWidth = 210 * unit * size;
        const available = floor - ceiling - 20 * unit;
        const bodyHeight = Math.min(available, (440 + 380 * range) * unit * size * (0.8 + 0.2 * level) * (0.9 + 0.1 * singerAwake) * (1 - crouch * 0.4));
        const lift = Math.min(liftFor(260 * unit, singer.depth) - singer.depth * (bodyHeight + 40 * unit), floor - ceiling - 10 * unit - bodyHeight);
        const base = floor - lift;
        const top = base - bodyHeight;
        const headRadius = bodyWidth * 0.46;
        const headX = x + sway * bodyHeight,
          headY = top + headRadius;
        context.fillStyle = colors.singer;
        // skirt and body
        context.beginPath();
        context.moveTo(x - bodyWidth * 0.62, base);
        context.lineTo(headX - bodyWidth * 0.22, headY + headRadius * 0.6);
        context.lineTo(headX + bodyWidth * 0.22, headY + headRadius * 0.6);
        context.lineTo(x + bodyWidth * 0.62, base);
        context.closePath();
        context.fill();
        // head in profile, facing the middle of the stage
        context.beginPath();
        context.arc(headX, headY, headRadius, 0, Math.PI * 2);
        context.fill();
        // the face in profile: a nose, and a mouth notch cut in from the front that opens with
        // the voice; a small eye above
        paperShape([[headX + facing * headRadius * 0.86, headY - headRadius * 0.3], [headX + facing * headRadius * 1.24, headY + headRadius * 0.06], [headX + facing * headRadius * 0.9, headY + headRadius * 0.12]], colors.singer);
        const open = headRadius * (0.07 + 0.34 * level * singerAwake);
        context.fillStyle = field;
        context.beginPath();
        context.moveTo(headX + facing * headRadius * 0.42, headY + headRadius * 0.36);
        context.lineTo(headX + facing * headRadius * 1.2, headY + headRadius * 0.3 - open * 0.3);
        context.lineTo(headX + facing * headRadius * 1.2, headY + headRadius * 0.3 + open);
        context.closePath();
        context.fill();
        context.beginPath();
        context.arc(headX + facing * headRadius * 0.46, headY - headRadius * 0.28, headRadius * 0.12, 0, Math.PI * 2);
        context.fill();
      }

      // Bass → the dome, hopping to every note; the hands ride above it.
      const bassPlace = place("bass");
      if (bassPlace) {
        const size = bassPlace.size * grow;
        const x = bassPlace.x + shake;
        const hasDome = (before.bass && previousSegment.dome) || (after.bass && segment.dome) || poster > 0.02;
        const domeDepth = before.bass && after.bass && previousSegment.dome !== segment.dome ? (segment.dome ? 1 - easeOutCubic(progress) : easeInCubic(progress)) : bassPlace.depth;
        if (hasDome) {
          const bassAwake = Math.max(awake("bass", time), poster);
          const notes = song.bassNotes;
          const last = notes.last(time);
          const next = last + 1 < notes.length ? last + 1 : -1;
          let shape = domeShape(last),
            hop = 0;
          if (next >= 0 && bassAwake > 0.2) {
            const nextStart = notes.start[next];
            const gapToNext = nextStart - (last >= 0 ? notes.start[last] : nextStart - 1);
            const flight = Math.min(0.2, gapToNext * 0.8);
            if (time > nextStart - flight) {
              const u = (time - (nextStart - flight)) / flight;
              const target = domeShape(next);
              shape = { width: mixValue(shape.width, target.width, easeInOutCubic(u)), height: mixValue(shape.height, target.height, easeInOutCubic(u)) };
              hop = 4 * u * (1 - u) * Math.min(90, 600 * flight);
            }
          }
          const squash = last >= 0 && !inGap ? hitDecay(time - notes.start[last], 0.07) * notes.strength[last] : 0;
          const w = shape.width * unit * size * (1 + 0.12 * squash) * (1 + crouch * 0.2);
          const h = shape.height * unit * size * (1 - 0.22 * squash) * (1 - crouch * 0.35) * (1 + slam * 0.3) * (0.5 + 0.5 * bassAwake);
          const lift = Math.min(hop * unit * size * bassAwake * (1 - poster) + liftFor(200 * unit, domeDepth) - domeDepth * (h + 40 * unit), floor - ceiling - 10 * unit - h);
          dome(x, floor - lift, w, h, colors.dome);
        }
        // Snare → the hands: two triangles that meet on beats two and four. Through a build
        // they close a notch each bar.
        const handsBefore = before.bass && previousSegment.hands,
          handsAfter = after.bass && segment.hands;
        if (handsBefore || handsAfter || poster > 0.02) {
          const pop = poster > 0.02 ? 1 : handsBefore && handsAfter ? 1 : handsAfter ? easeOutCubic(clamp01((progress - 0.4) / 0.6)) : 1 - easeInCubic(clamp01(progress / 0.6));
          if (pop > 0.02) {
            const handsAwake = Math.max(awake("hands", time), poster);
            const nextBeat = backbeats.until(time);
            const lastBeat = backbeats.since(time);
            const approach = song.beatPeriod * 0.5;
            let apart = 1;
            if (nextBeat < approach) apart = nextBeat / approach;
            if (lastBeat < 0.14) apart = Math.min(apart, easeOutCubic(lastBeat / 0.14));
            if (drop.phase === 1) apart = Math.min(apart, 1 - 0.85 * barsDone);
            if (inGap) apart = 0.15;
            if (poster > 0.5 && time > songEnd) {
              const beat = fract(song.barPosition(time));
              apart = beat < 0.08 ? 0.2 : mixValue(0.2, 1, easeOutCubic(clamp01((beat - 0.08) / 0.4)));
            }
            apart = mixValue(1.25, apart, handsAwake);
            const handSize = 140 * unit * size * pop;
            const handGap = 14 * unit + 180 * unit * size * apart;
            const over = hasDome ? floor - (390 * size + 30) * unit - handSize * 0.8 : floor - room * unit * 0.5;
            const cy = Math.max(ceiling + handSize * 0.8 + 6 * unit, over - liftFor(120 * unit, 0) + (1 - handsAwake) * 60 * unit + crouch * 60 * unit);
            paperShape([[x - handGap / 2, cy], [x - handGap / 2 - handSize, cy - handSize * 0.8], [x - handGap / 2 - handSize, cy + handSize * 0.8]], colors.hands);
            paperShape([[x + handGap / 2, cy], [x + handGap / 2 + handSize, cy - handSize * 0.8], [x + handGap / 2 + handSize, cy + handSize * 0.8]], colors.hands);
          }
        }
      }

      // Kick → the kit: the drum touches the floor exactly on each kick (and on each drop);
      // the cymbals ring on the off-beat hats (left) and on the late, swung sixteenths (right).
      const drumPlace = place("drum");
      if (drumPlace) {
        const drumAwake = Math.max(awake("drum", time), poster);
        const size = drumPlace.size * grow;
        const kit = poster > 0.5 ? 3 : after.drum ? segment.kit : previousSegment.kit;
        const radius = drumRadius * unit * size;
        const x = drumPlace.x + shake;
        const jump = bounce(landing, time, 200 * unit, 1100 * unit);
        const contact = time < 0.12 ? 0 : hitDecay(jump.age, 0.06) * (0.4 + 0.6 * jump.strength) * (inGap ? 0.7 : 1);
        const rx = radius * (1 + 0.25 * contact + crouch * 0.25);
        const ry = radius * (1 - 0.3 * contact - crouch * 0.25 + hang * 0.08);
        const rise = jump.height * drumAwake * size * (1 - barsDone * 0.5) * (inGap ? 0 : 1) * (1 - poster);
        const lift = rise + liftFor(330 * unit, drumPlace.depth) - drumPlace.depth * (2 * ry + 40 * unit);
        const cy = Math.max(ceiling + ry, floor - ry - lift);
        disc(x, cy, rx, ry, colors.ink, 3);
        // the cymbals on their stands
        if (kit > 1) {
          const cymbal = (events, side, seed) => {
            const cx = x + side * radius * 2.05;
            const last = events.last(time);
            const age = last >= 0 ? time - events.time[last] : Infinity;
            const ring = inGap ? 0 : hitDecay(age, 0.1) * (last >= 0 ? events.strength[last] : 0);
            const stand = radius * 1.35;
            const baseY = floor + drumPlace.depth * (stand + radius) - liftFor(330 * unit, drumPlace.depth);
            const cyC = baseY - stand - ring * radius * 0.35;
            context.fillStyle = colors.ink;
            context.fillRect(cx - 9 * unit * size, cyC, 18 * unit * size, baseY - cyC);
            disc(cx, cyC, radius * 0.78, radius * 0.13, colors.ink, seed, side * (0.08 + 0.45 * ring));
          };
          cymbal(offbeats, -1, 17);
          if (kit > 2) cymbal(lates, 1, 29);
        }
      }
      context.restore();

      // The pocket, along the floor: one beat, four sixteenth cells; every onset of the last
      // two bars stamped where it landed in the beat (the voice as pills, the hats as ticks,
      // the claps as triangles, the kick as discs, the bass as half-domes), older ones fainter.
      // Swing and push show as offsets from the cells' edges in a single frame.
      {
        const laneLeft = width * 0.03,
          laneRight = width * 0.97,
          laneTop = floor + (height - floor) * 0.1,
          laneBottom = height - (height - floor) * 0.16;
        const laneHeight = laneBottom - laneTop;
        const cell = (laneRight - laneLeft) / 4;
        const phaseNow = fract(song.beatPosition(time));
        const xAt = (phase) => laneLeft + (laneRight - laneLeft) * phase;
        for (let index = 0; index < 4; index++) {
          context.fillStyle = cssColor(mixColor(fieldColor, dark ? [1, 1, 1] : [0, 0, 0], index % 2 ? (dark ? 0.16 : 0.2) : dark ? 0.1 : 0.12));
          context.fillRect(laneLeft + cell * index, laneTop, cell, laneHeight);
        }
        const rows = 3;
        const rowHeight = laneHeight / rows;
        const rowY = (row) => laneTop + rowHeight * (row + 0.5);
        const stampSize = rowHeight * 0.46;
        const window = song.beatPeriod * 8;
        const stamp = (list, kind, row, minimum = 0) => {
          let index = list.last(time);
          while (index >= 0) {
            const at = list.time ? list.time[index] : list.start[index];
            const age = time - at;
            if (age > window) break;
            const strength = list.strength[index];
            if (strength >= minimum) {
              const x = xAt(fract(song.beatPosition(at)));
              const y = rowY(row);
              context.globalAlpha = 0.18 + 0.82 * Math.exp(-age / (song.beatPeriod * 2.2));
              if (kind === "kick") disc(x, y, stampSize, stampSize, colors.ink, index);
              else if (kind === "bass") dome(x, y + stampSize * 0.7, stampSize * 2.4, stampSize * 1.5, colors.dome);
              else if (kind === "clap") paperShape([[x, y - stampSize], [x - stampSize, y + stampSize * 0.8], [x + stampSize, y + stampSize * 0.8]], colors.hands);
              else if (kind === "voice") {
                context.fillStyle = colors.singer;
                context.beginPath();
                context.roundRect(x - stampSize * 1.3, y - stampSize * 0.6, stampSize * 2.6, stampSize * 1.2, stampSize * 0.6);
                context.fill();
              } else {
                context.fillStyle = colors.ink;
                context.fillRect(x - 5 * unit, y - stampSize, 10 * unit, stampSize * 2);
              }
              context.globalAlpha = 1;
            }
            index--;
          }
        };
        stamp(song.vocalNotes, "voice", 0, 0.2);
        stamp(song.hats, "hat", 1, 0.25);
        stamp(backbeats, "clap", 1);
        stamp(landing, "kick", 2);
        stamp(song.bassNotes, "bass", 2);
        context.fillStyle = cssColor(hexColor(colors.ink), 0.9);
        context.fillRect(xAt(phaseNow) - 3 * unit, laneTop - 6 * unit, 6 * unit, laneHeight + 12 * unit);
      }

      // Every key word sung so far lies in a pile of paper slips at the right of the stage.
      if (word) {
        context.font = `800 ${slipHeight * 0.78}px "Jost", sans-serif`;
        let count = 0;
        for (const moment of song.anchor.moments) {
          const landed = moment.end + song.beatPeriod;
          if (landed > time) break;
          const fall = easeInCubic(clamp01((time - landed) / 0.3));
          const y = floor - (count + 1) * slipHeight - (1 - fall) * 200 * unit;
          const x = width * 0.965 - slipWidth + (hash01(count * 13 + 5) - 0.5) * slipHeight;
          context.save();
          context.translate(x + slipWidth / 2, y + slipHeight / 2);
          context.rotate((hash01(count * 7 + 3) - 0.5) * 0.12);
          context.fillStyle = colors.ink;
          context.fillRect(-slipWidth / 2, -slipHeight / 2, slipWidth, slipHeight * 0.92);
          context.fillStyle = field;
          context.fillText(word, -slipWidth / 2 + slipHeight * 0.3, slipHeight * 0.26);
          context.restore();
          count++;
        }
      }

      // The key word sung (not into the main drop): cut-paper letters in the band right of
      // the title, whole at once, held at least 0.8 s.
      if (wordState && !wordState.main) {
        const band = ceiling - 8 * unit;
        const size = Math.min(band / 0.8, (width * 0.5) / (word.length * 0.62));
        context.font = `800 ${size}px "Jost", sans-serif`;
        const total = context.measureText(word).width;
        const pop = easeOutBack(clamp01(wordState.age / 0.1));
        let x = width * 0.97 - total;
        const baseline = band;
        context.fillStyle = colors.ink;
        for (let letter = 0; letter < word.length; letter++) {
          const glyph = word[letter];
          const letterWidth = context.measureText(glyph).width;
          context.save();
          context.translate(x + letterWidth / 2, baseline - size * 0.35);
          context.rotate((hash01(letter * 17 + wordState.index) - 0.5) * 0.24);
          context.scale(0.6 + 0.4 * pop, 0.6 + 0.4 * pop);
          context.fillText(glyph, -letterWidth / 2, size * 0.35);
          context.restore();
          x += letterWidth;
        }
      }

      // The drop: the floor rises to meet everything for its first frames.
      if (slam > 0) {
        context.fillStyle = colors.ink;
        context.fillRect(0, floor - height * 0.05 * slam, width, height * 0.05 * slam);
      }
    }

    return {
      canvas,
      setSong(model) {
        themeField = "";
        setSong(model);
      },
      themeFor() {
        themeField = "";
        const field = song ? setup.main : pocketFields.cream;
        return { "--pocket-field": field, "--pocket-ink": colorsFor(hexColor(field)).ink };
      },
      setActive(on) {
        canvas.hidden = !on;
      },
      resize(width, height, ratio) {
        const [w, h, s] = canvasPixels(width, height, Math.min(ratio, 2), 2560 * 1440);
        canvas.width = w;
        canvas.height = h;
        scale = s;
        layouts.clear();
        layoutKey = "";
      },
      render,
      debug: () => ({ segments, presence, sceneFields }),
    };
  },
});
