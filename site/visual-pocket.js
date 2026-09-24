// Pocket: a troupe of cut-paper figures, one per instrument, on a small stage. Every
// movement is keyed to that instrument's own onsets, so the groove on screen is the band's
// groove: the drum (a black disc) touches the floor exactly on each kick; the bass (a red
// dome, taller for a higher note) winds up before each note and lands on it, wherever the
// bass line pushes or lays back; the hands above it clap on the backbeat; the fringe marks
// every hi-hat against a faint sixteenth grid; the singer stretches with the sung pitch and
// sways with the song's own swing (measured from where the bass lands against the beat).
// The stage shows who is playing: a performer rises through the floor to arrive on its first
// note and sinks when its part ends, and each has a column of its own, so no one covers
// another. Phrase by phrase one of them is featured, larger. Each figure keeps its colour all
// song; the fields come from a pale family none of them can vanish into, and in a chord
// passage the field changes with each chord. A build dims the stage and crouches everyone,
// the gap holds them in the air on a dark stage, and the drop lands them together on new
// marks; from the song's turn (its main drop) the stage is night.

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
  oxblood: "#3d1219",
  bottle: "#10302a",
  tomato: "#e4472b",
};
const pocketDark = ["night", "ink", "oxblood", "bottle"];
const pocketPale = ["cream", "mint", "blush", "sky", "lilac"];
// Each song opens on its own field with its own stage order (the order turns at each drop).
const pocketOpenings = {
  "5ff86d6cd02ebd7308e03df8": { field: "sky", order: ["singer", "drum", "bass"] }, // NBLY
  "1d589940ca458d793a3fad8a": { field: "blush", order: ["drum", "bass", "singer"] }, // Desire
  f127a026dc751f1528bfb95d: { field: "mint", order: ["bass", "singer", "drum"] }, // Ophelia
  "8eee874c702a10807f79706c": { field: "cream", order: ["drum", "singer", "bass"] }, // Outside
  "4048d4a6dce44c151690b2b1": { field: "lilac", order: ["bass", "drum", "singer"] }, // American Boy
};
// Column widths at scale 1 (in 1080ths of the frame height). The bass column holds the dome
// at its widest (a low note, squashed) with the hands above it.
const pocketDrumRadius = [150, 118, 100];
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
    let opening = { field: "cream", order: ["drum", "bass", "singer"] };
    let bassLow = 28,
      bassHigh = 52;
    let layoutKey = "";
    const layouts = new Map();
    // A cut edge per figure: fixed small irregularities so the shapes read as cut paper.
    const cutEdge = Array.from({ length: 64 }, (_, index) => 1 + (hash01(index * 31 + 7) - 0.5) * 0.035);
    // The drum lands on every kick and on every drop frame; the hands close on the strong
    // backbeats only.
    let landing = new SongEvents([]);
    let backbeats = new SongEvents([]);

    function setSong(model) {
      song = model;
      presence = null;
      themeField = "";
      sceneFields = [];
      segments = [];
      segmentStarts = new Float64Array(0);
      layouts.clear();
      landing = new SongEvents([]);
      backbeats = new SongEvents([]);
      if (!model) return;
      opening = pocketOpenings[model.identifier] || { field: "cream", order: ["drum", "bass", "singer"] };
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
      // The bass line's range, for the dome's height.
      const pitches = Array.from(model.bassNotes.pitch).sort((a, b) => a - b);
      if (pitches.length > 8) {
        bassLow = pitches[Math.floor(pitches.length * 0.05)];
        bassHigh = Math.max(bassLow + 5, pitches[Math.floor(pitches.length * 0.95)]);
      }
      // Each scene's field: pale before the turn, night after it.
      const turn = model.lateStart;
      let darkIndex = 0;
      model.scenes.forEach((scene, index) => {
        const after = scene.start >= turn - 0.05;
        let field;
        if (index === 0) field = opening.field;
        else if (scene.end - scene.start < 1) field = sceneFields[index - 1]; // a sliver keeps the last look
        else if (after) field = scene.kind === "gap" ? "night" : pocketDark[darkIndex++ % pocketDark.length];
        else
          switch (scene.kind) {
            case "verse": field = "blush"; break;
            case "break": field = "sky"; break;
            case "groove": field = "mint"; break;
            case "build": field = "blush"; break;
            case "gap": field = "night"; break;
            default: field = ["cream", "mint", "lilac"][scene.kindIndex % 3];
          }
        sceneFields.push(field);
      });
      presence = findPresence(model);
      segments = findSegments(model);
      segmentStarts = Float64Array.from(segments.map((segment) => segment.start));
    }

    // Who is playing: each part from the first bar it plays until two quiet bars; gaps under
    // four bars are bridged and fragments under two bars dropped, so no one bobs in and out.
    function findPresence(model) {
      const bars = model.downbeats;
      const result = {};
      for (const [figure, series, floor] of [["drum", null, 0], ["bass", "bass", 0.18], ["singer", "vocal", 0.2], ["hands", null, 0], ["fringe", "hats", 0.12]]) {
        const spans = [];
        let open = null,
          quiet = 0;
        for (let index = 0; index < bars.length; index++) {
          const start = bars[index],
            end = index + 1 < bars.length ? bars[index + 1] : model.duration;
          let on;
          if (figure === "drum") on = model.kicks.last(end - 0.001) - model.kicks.last(start) >= 2;
          else if (figure === "hands") {
            on = false;
            for (let event = model.snares.last(start) + 1; event <= model.snares.last(end - 0.001); event++) if (model.snares.strength[event] > 0.5) on = true;
          } else on = model.mean(series, start, end) > floor;
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
    // (who is on, in which order, how many drums, who is featured) and how long the move into
    // it takes (0 for a drop: the drop is a cut to the new marks).
    function findSegments(model) {
      const dropAt = (time) => {
        for (const drop of model.drops) if (Math.abs(drop.time - time) < 0.25) return drop.time;
        return -1;
      };
      // A part that starts within the first four bars is on stage from the first frame.
      const openingReach = model.barTime(4);
      const firstSong = presence.singer.length ? presence.singer[0] : null;
      const enterTime = (span) => {
        const drop = dropAt(span.start);
        if (span === firstSong && span.start <= model.barTime(16)) return 0; // the singer waits on stage
        if (drop >= 0) return drop;
        return span.start <= openingReach ? 0 : Math.max(0, span.start - pocketRise);
      };
      const leaveTime = (span) => {
        const drop = dropAt(span.end);
        return drop >= 0 ? drop : span.end;
      };
      const members = (time) => {
        const on = new Set();
        for (const figure of ["drum", "bass", "singer", "hands"])
          for (const span of presence[figure]) if (time >= enterTime(span) && time < leaveTime(span)) on.add(figure);
        if (!on.has("drum") && !on.has("bass") && !on.has("singer") && !on.has("hands")) {
          // silence: the band waits on stage for the part that comes next (after the last
          // part the stage is left empty)
          let next = null;
          for (const figure of ["drum", "bass", "singer"])
            for (const span of presence[figure]) if (span.start > time && (!next || span.start < next.start)) next = { figure, start: span.start };
          if (next) on.add(next.figure);
        }
        return on;
      };
      const hard = [{ time: 0, duration: 0 }];
      for (const figure of ["drum", "bass", "singer", "hands"])
        for (const span of presence[figure]) {
          const enter = enterTime(span);
          if (enter > 0) hard.push({ time: enter, duration: dropAt(span.start) >= 0 ? 0 : pocketRise });
          hard.push({ time: leaveTime(span), duration: dropAt(span.end) >= 0 ? 0 : pocketRise });
        }
      for (const drop of model.drops) hard.push({ time: drop.time, duration: 0 });
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
        const turn = dropsPassed % opening.order.length;
        const order = opening.order.slice(turn).concat(opening.order.slice(0, turn));
        const scene = model.scene(settled);
        let feature = null;
        if (scene.kind === "verse" || scene.kind === "break") feature = "singer";
        else if (scene.kind === "gap") feature = result.length ? result[result.length - 1].feature : null; // the gap holds
        else if (scene.kind !== "drop" && scene.kind !== "build") {
          const phrase = Math.max(0, Math.floor(model.barIndex(settled) / 8));
          feature = [null, "drum", null, "bass", null, "singer"][phrase % 6];
        }
        if (feature && !on.has(feature)) feature = null;
        const drums = Math.min(3, 1 + dropsPassed + (settled >= model.lateStart && dropsPassed === 1 ? 1 : 0));
        const segment = {
          start: boundary.time,
          duration: boundary.duration,
          order: order.filter((name) => (name === "bass" ? on.has("bass") || on.has("hands") : on.has(name))),
          dome: on.has("bass"),
          hands: on.has("hands"),
          drums,
          feature,
        };
        const previous = result[result.length - 1];
        if (previous && previous.order.join() === segment.order.join() && previous.dome === segment.dome && previous.hands === segment.hands && previous.drums === segment.drums && previous.feature === segment.feature) continue;
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
    function drumColumn(count, size) {
      const radius = pocketDrumRadius[count - 1] * size;
      return count * radius * 2.8 + (count - 1) * 20 * size;
    }
    function columnWidth(segment, name, size) {
      if (name === "drum") return drumColumn(segment.drums, size);
      if (name === "bass") return (segment.dome ? 680 : 520) * size;
      return 400 * size;
    }
    function columnCap(segment, name, room) {
      if (name === "drum") return room / (300 + 2 * pocketDrumRadius[segment.drums - 1]);
      if (name === "bass") return segment.dome && segment.hands ? (room - 30) / 634 : segment.dome ? room / 410 : room / 330;
      return 1.6;
    }

    // Where each performer stands in a segment: the columns in order, each as large as the
    // stage allows (the featured one larger), spaced evenly. Nothing overlaps by construction.
    function layoutFor(index, left, right, room, unit) {
      const cached = layouts.get(index);
      if (cached) return cached;
      const segment = segments[index];
      const names = segment.order;
      const base = (name) => (segment.feature && names.length > 1 ? (name === segment.feature ? 1.3 : 0.85) : 1);
      const span = (right - left) / unit;
      const gap = 60;
      const nominal = names.reduce((sum, name) => sum + columnWidth(segment, name, base(name)), 0);
      const fit = Math.min(1.35, (span - gap * (names.length + 1)) / Math.max(1, nominal));
      const sizes = names.map((name) => Math.min(base(name) * fit, columnCap(segment, name, room), 1.6));
      const widths = names.map((name, column) => columnWidth(segment, name, sizes[column]));
      const spacing = (span - widths.reduce((sum, value) => sum + value, 0)) / (names.length + 1);
      const result = {};
      let x = spacing;
      names.forEach((name, column) => {
        result[name] = { x: left + (x + widths[column] / 2) * unit, size: sizes[column] };
        x += widths[column] + spacing;
      });
      layouts.set(index, result);
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

    function disc(cx, cy, rx, ry, color, seed = 0) {
      context.fillStyle = color;
      context.beginPath();
      for (let index = 0; index < 48; index++) {
        const angle = (index / 48) * Math.PI * 2;
        const wobble = cutEdge[(index + seed) % 64];
        const x = cx + Math.cos(angle) * rx * wobble,
          y = cy + Math.sin(angle) * ry * wobble;
        if (index) context.lineTo(x, y);
        else context.moveTo(x, y);
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

    // Height of the drum between landings: on the floor at each, a parabola between them,
    // lower when they come faster. With no landing for a while it rests, and hops up in time
    // to land on the next one.
    function bounce(time, maximum, perSecond) {
      const index = landing.last(time);
      const next = index + 1 < landing.length ? landing.time[index + 1] : Infinity;
      const last = index >= 0 ? landing.time[index] : -Infinity;
      const strength = index >= 0 ? landing.strength[index] : 0;
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
      const floor = height * 0.82;
      // nothing rises into the title
      const ceiling = Math.max(height * 0.2, (frame.titleBottom || 0) + 12 * unit);
      const room = (floor - ceiling) / unit;
      const sceneIndex = song.sceneIndex(time);
      const drop = song.dropContext(time);
      const leadIn = song.anchor.kind === "lead_in" ? song.anchorAt(time) : -1;
      const inGap = drop.phase === 2 || leadIn >= 0;
      const sinceDrop = drop.phase === 3 ? drop.since : Infinity;
      const hit = sinceDrop < song.beatPeriod * 2;
      const mainHit = hit && drop.index === song.mainDrop;
      const windUp = drop.phase === 1 ? drop.progress : 0;

      // Field: the scene's; in a chord passage, the chord's; a build dims it (or, on the night
      // stage, heats it); the gap is night; a drop's first two beats are light (the main
      // drop's are tomato).
      let fieldName = sceneFields[sceneIndex];
      const peak = song.peakAt(time);
      if (peak && peak.kind === "chords") {
        const chordIndex = song.chordIndex(time);
        if (chordIndex >= 0) {
          const pick = (index) => pocketPale[(((song.chords[index].root * 7) % 12) + 12) % 5];
          fieldName = pick(chordIndex);
          if (chordIndex > 0 && song.chords[chordIndex - 1].start >= peak.start - 0.5 && pick(chordIndex - 1) === fieldName) fieldName = pocketPale[(pocketPale.indexOf(fieldName) + 1) % 5];
        }
      }
      let fieldColor = hexColor(pocketFields[fieldName]);
      if (windUp > 0) {
        const dusk = 0.5 * windUp + 0.15 * windUp * windUp * windUp;
        fieldColor = fieldName === "night" ? mixColor(fieldColor, hexColor(pocketFields.tomato), 0.75 * dusk) : mixColor(fieldColor, hexColor(pocketFields.night), dusk);
      }
      if (inGap) fieldColor = hexColor(pocketFields.night);
      if (hit) {
        if (mainHit) fieldColor = hexColor(pocketFields.tomato);
        else if (pocketDark.includes(fieldName)) fieldColor = hexColor(pocketFields.cream);
      }
      const dark = fieldColor[0] + fieldColor[1] + fieldColor[2] < 1.2;
      const hot = mainHit;
      const field = cssColor(fieldColor);
      const inkName = dark ? "cream" : "black";
      if (field !== themeField) {
        themeField = field;
        document.documentElement.style.setProperty("--pocket-field", field);
        document.documentElement.style.setProperty("--pocket-ink", pocketInk[inkName]);
        waveformTheme = null;
      }
      context.fillStyle = field;
      context.fillRect(0, 0, width, height);
      // Floor: the field, a shade darker (the transport sits on it when shown).
      context.fillStyle = cssColor(mixColor(fieldColor, dark ? [1, 1, 1] : [0, 0, 0], dark ? 0.1 : 0.14));
      context.fillRect(0, floor, width, height - floor);

      // Wind-up: everyone crouches through a build; the gap holds them in the air, stretched;
      // the drop lands them with a slam.
      const crouch = inGap ? 0 : 0.55 * windUp;
      // a tremble on the sixteenths, growing through the build
      const shake = windUp > 0 && !inGap ? Math.sin(song.beatPosition(time) * Math.PI * 8) * (4 + 20 * windUp) * unit : 0;
      // the troupe gathers toward the middle of the stage as the build rises
      const gather = 1 - 0.25 * (inGap ? 1 : windUp) * (drop.phase === 1 || inGap ? 1 : 0);
      let hang = 0;
      if (inGap) {
        const holdStart = drop.phase === 2 ? drop.drop.gapStart : song.anchor.moments[leadIn].start;
        hang = easeOutCubic(clamp01((time - holdStart) / 0.25));
      }
      const slam = sinceDrop < 0.25 ? 1 - sinceDrop / 0.25 : 0;
      const liftFor = (maximum) => hang * Math.min(maximum, room * unit * 0.4);
      // the main drop lands the cast a size larger, settling over its first bar
      const grow = drop.phase === 3 && drop.index === song.mainDrop ? 1 + 0.18 * (1 - easeInOutCubic(sinceDrop / (song.beatPeriod * 4))) : 1;
      const inkColor = hexColor(pocketInk[inkName]);

      // Hats → the fringe along the top right: each hat of the last beat and a half is a tick
      // at its phase in the bar, over a faint grid of the bar's sixteenths.
      {
        const fringeAwake = awake("fringe", time);
        const gridLeft = width * 0.5,
          gridRight = width * 0.975;
        const tickWidth = 44 * unit,
          tickHeight = Math.min(170 * unit, ceiling * 0.8) * (0.35 + 0.65 * fringeAwake);
        context.fillStyle = cssColor(inkColor, 0.16);
        for (let step = 0; step < 16; step++) {
          const x = gridLeft + (step / 16) * (gridRight - gridLeft);
          context.fillRect(x - 3 * unit, 0, 6 * unit, tickHeight * (step % 4 === 0 ? 0.42 : 0.24));
        }
        let index = song.hats.last(time);
        while (index >= 0) {
          const hatTime = song.hats.time[index];
          const age = time - hatTime;
          if (age > song.beatPeriod) break;
          const barAt = song.barPosition(hatTime);
          const x = gridLeft + (barAt - Math.floor(barAt)) * (gridRight - gridLeft);
          const fresh = hitDecay(age, song.beatPeriod * 0.4);
          context.fillStyle = cssColor(inkColor, 0.3 + 0.7 * fresh);
          context.fillRect(x - tickWidth / 2, 0, tickWidth, tickHeight * (0.5 + 0.5 * song.hats.strength[index]) * (0.3 + 0.7 * fresh) * (1 - hang * 0.4));
          index--;
        }
      }

      // The stage: this segment's arrangement, moved into from the last one's.
      const word = song.anchor.kind === "word" ? song.anchor.word.toUpperCase() : "";
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
      const move = easeInOutCubic(progress);
      const before = layoutFor(Math.max(0, segmentIndex - 1), stageLeft, stageRight, room, unit);
      const after = layoutFor(segmentIndex, stageLeft, stageRight, room, unit);
      const previousSegment = segments[Math.max(0, segmentIndex - 1)];
      // A performer on both sides of the move walks; one arriving rises through the floor,
      // one leaving sinks. `depth` is how far below its place it is, 0..1 of its height.
      const middle = (stageLeft + stageRight) / 2;
      const squeeze = (entry) => (entry ? { x: middle + (entry.x - middle) * gather, size: entry.size * gather, depth: entry.depth } : null);
      const place = (name) => {
        const a = before[name],
          b = after[name];
        if (a && b) return squeeze({ x: mixValue(a.x, b.x, move), size: mixValue(a.size, b.size, move), depth: 0 });
        if (b) return squeeze({ x: b.x, size: b.size, depth: 1 - easeOutCubic(progress) });
        if (a && progress < 1) return squeeze({ x: a.x, size: a.size, depth: easeInCubic(progress) });
        return null;
      };
      context.save();
      context.beginPath();
      context.rect(0, 0, width, floor);
      context.clip();

      // Voice → the singer: a tall column, taller with the pitch, its mouth open with the
      // level, swaying with the song's swing.
      let singerX = width * 0.5;
      const singer = place("singer");
      if (singer) {
        const singerAwake = awake("singer", time);
        const size = singer.size * grow;
        singerX = singer.x + shake;
        const pitch = song.value("pitch", time);
        const level = clamp01((song.value("vocal", time) - 0.15) / 0.6);
        const range = pitch > 0 ? clamp01((pitch - 50) / 28) : 0.2;
        // the lean snaps on the beat (right) and on the swung eighth (left): the swing, in
        // one body
        const phase = fract(song.beatPosition(time));
        const split = 0.5 + swingLate * 2; // the swung eighth lands late by twice the sixteenth's lag
        const snap = (age) => easeOutBack(clamp01(age / 0.09));
        const lean = phase < split ? mixValue(-1, 1, snap(phase)) : mixValue(1, -1, snap(phase - split));
        const sway = lean * 0.12 * singerAwake * (1 - windUp);
        const bodyWidth = 200 * unit * size;
        const available = floor - ceiling - bodyWidth * 0.2;
        const bodyHeight = Math.min(available, (380 + 420 * range) * unit * size * (0.72 + 0.28 * level) * (0.85 + 0.15 * singerAwake) * (1 - crouch * 0.4));
        const lift = liftFor(260 * unit) - singer.depth * (bodyHeight + 40 * unit);
        const top = floor - bodyHeight - lift;
        const base = floor - lift;
        context.fillStyle = hot ? pocketInk.cream : dark ? "#6f8ef7" : pocketInk.cobalt;
        context.beginPath();
        context.moveTo(singerX - bodyWidth / 2, base);
        context.lineTo(singerX - bodyWidth / 2 + sway * bodyHeight, top + bodyWidth / 2);
        context.arc(singerX + sway * bodyHeight, top + bodyWidth / 2, bodyWidth / 2, Math.PI, 0);
        context.lineTo(singerX + bodyWidth / 2, base);
        context.closePath();
        context.fill();
        // the mouth: a low, wide slot that opens with the level (a line while resting)
        context.fillStyle = field;
        const slot = Math.min(bodyWidth * 0.36, 8 * unit + 100 * unit * level * size);
        const slotWidth = bodyWidth * 0.7;
        const cx = singerX + sway * bodyHeight * 0.8,
          cy = top + Math.min(bodyWidth * 1.15, bodyHeight * 0.45);
        context.beginPath();
        context.roundRect(cx - slotWidth / 2, cy - slot / 2, slotWidth, slot, slot / 2);
        context.fill();
      }

      // Bass → the dome, hopping to every note; the hands ride above it.
      const bassPlace = place("bass");
      const domeOn = (a, b) => (a && b ? true : a || b);
      if (bassPlace) {
        const size = bassPlace.size * grow;
        const x = bassPlace.x + shake;
        const hasDome = domeOn(before.bass && previousSegment.dome, after.bass && segment.dome);
        const domeDepth = before.bass && after.bass && previousSegment.dome !== segment.dome ? (segment.dome ? 1 - easeOutCubic(progress) : easeInCubic(progress)) : bassPlace.depth;
        if (hasDome) {
          const bassAwake = awake("bass", time);
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
              hop = 4 * u * (1 - u) * Math.min(110, 700 * flight);
            }
          }
          const squash = last >= 0 && !inGap ? hitDecay(time - notes.start[last], 0.07) * notes.strength[last] : 0;
          const w = shape.width * unit * size * (1 + 0.12 * squash) * (1 + crouch * 0.2);
          const h = shape.height * unit * size * (1 - 0.22 * squash) * (1 - crouch * 0.35) * (1 + slam * 0.3) * (0.5 + 0.5 * bassAwake);
          const lift = hop * unit * size * bassAwake + liftFor(200 * unit) - domeDepth * (h + 40 * unit);
          dome(x, floor - lift, w, h, hot ? pocketInk.cream : pocketInk.tomato);
        }
        // Snare → the hands: two triangles that meet on each backbeat.
        const handsBefore = before.bass && previousSegment.hands,
          handsAfter = after.bass && segment.hands;
        if (handsBefore || handsAfter) {
          const pop = handsBefore && handsAfter ? 1 : handsAfter ? easeOutBack(clamp01(progress / 0.6)) : 1 - easeInCubic(clamp01(progress / 0.6));
          if (pop > 0.02) {
            const handsAwake = awake("hands", time);
            const nextBeat = backbeats.until(time);
            const lastBeat = backbeats.since(time);
            const approach = song.beatPeriod * 0.5;
            let apart = 1;
            if (nextBeat < approach) apart = nextBeat / approach;
            if (lastBeat < 0.14) apart = Math.min(apart, easeOutCubic(lastBeat / 0.14));
            if (inGap) apart = 0.15;
            apart = mixValue(1.25, apart, handsAwake);
            const handSize = 140 * unit * size * pop;
            const handGap = 14 * unit + 180 * unit * size * apart;
            const over = hasDome ? floor - (410 * size + 30) * unit - handSize * 0.8 : floor - room * unit * 0.5;
            const cy = Math.max(ceiling + handSize * 0.8 + 6 * unit, over - liftFor(120 * unit) + (1 - handsAwake) * 60 * unit + crouch * 60 * unit);
            paperShape([[x - handGap / 2, cy], [x - handGap / 2 - handSize, cy - handSize * 0.8], [x - handGap / 2 - handSize, cy + handSize * 0.8]], pocketInk.mustard);
            paperShape([[x + handGap / 2, cy], [x + handGap / 2 + handSize, cy - handSize * 0.8], [x + handGap / 2 + handSize, cy + handSize * 0.8]], pocketInk.mustard);
          }
        }
      }

      // Kick → the drums: discs that touch the floor exactly on each kick (and on each drop).
      const drumPlace = place("drum");
      if (drumPlace) {
        const drumAwake = awake("drum", time);
        const size = drumPlace.size * grow;
        const count = after.drum ? segment.drums : previousSegment.drums;
        const jump = bounce(time, 300 * unit, 1300 * unit);
        const contact = inGap || time < 0.12 ? 0 : hitDecay(jump.age, 0.06) * (0.4 + 0.6 * jump.strength);
        const color = dark ? pocketInk.cream : pocketInk.black;
        const radius = pocketDrumRadius[count - 1] * unit * size;
        const pitch = radius * 2.8 + 20 * unit * size;
        for (let index = 0; index < count; index++) {
          const rx = radius * (1 + 0.25 * contact + crouch * 0.25);
          const ry = radius * (1 - 0.3 * contact - crouch * 0.25 + hang * 0.08);
          const rise = jump.height * drumAwake * size * (1 - windUp * 0.5) * (inGap ? 0 : 1);
          const lift = rise + liftFor(330 * unit) - drumPlace.depth * (2 * ry + 40 * unit);
          const cy = Math.max(ceiling + ry, floor - ry - lift);
          disc(drumPlace.x + shake + (index - (count - 1) / 2) * pitch, cy, rx, ry, color, 3 + index * 7);
        }
      }
      context.restore();

      // The groove lane along the floor: the bar as a line of sixteen steps, each performer
      // stamping where it actually landed (the drum a disc, the bass a half-dome, the clap a
      // triangle, the hats a tick), the previous bar ghosted ahead of the playhead. The pocket
      // and the swing show as offsets from the steps in a single frame.
      {
        const laneLeft = width * 0.03,
          laneRight = width * 0.97,
          laneTop = floor + (height - floor) * 0.14,
          laneBottom = height - (height - floor) * 0.12;
        const laneHeight = laneBottom - laneTop;
        const barPosition = song.barPosition(time);
        const barIndex = Math.floor(barPosition);
        const phaseNow = barPosition - barIndex;
        const xAt = (phase) => laneLeft + (laneRight - laneLeft) * phase;
        context.fillStyle = cssColor(inkColor, 0.2);
        for (let step = 0; step < 16; step++) context.fillRect(xAt(step / 16) - 1.5 * unit, laneTop, 3 * unit, laneHeight * (step % 4 === 0 ? 1 : 0.45));
        const size = laneHeight * 0.42;
        const stamp = (list, kind, fromTime, toTime, alpha, minimum = 0) => {
          let index = list.last(toTime);
          while (index >= 0) {
            const at = list.time ? list.time[index] : list.start[index];
            if (at < fromTime) break;
            const strength = list.strength[index];
            if (strength >= minimum) {
              const position = song.barPosition(at);
              const x = xAt(position - Math.floor(position));
              context.globalAlpha = alpha;
              if (kind === "kick") disc(x, laneTop + laneHeight * 0.62, size * 0.62, size * 0.62, dark ? pocketInk.cream : pocketInk.black, index);
              else if (kind === "bass") dome(x, laneBottom, size * 1.25, size * 0.75, hot ? pocketInk.cream : pocketInk.tomato);
              else if (kind === "clap") paperShape([[x, laneTop + laneHeight * 0.05], [x - size * 0.45, laneTop + laneHeight * 0.45], [x + size * 0.45, laneTop + laneHeight * 0.45]], pocketInk.mustard);
              else {
                context.fillStyle = cssColor(inkColor);
                context.fillRect(x - 2 * unit, laneTop, 4 * unit, laneHeight * 0.18);
              }
              context.globalAlpha = 1;
            }
            index--;
          }
        };
        const barStart = song.barTime(barIndex),
          previousStart = song.barTime(barIndex - 1);
        // ghost of the previous bar, ahead of the playhead
        context.save();
        context.beginPath();
        context.rect(xAt(phaseNow), laneTop - laneHeight, laneRight - xAt(phaseNow) + 10 * unit, laneHeight * 2.2);
        context.clip();
        stamp(song.bassNotes, "bass", previousStart, barStart - 0.001, 0.28);
        stamp(landing, "kick", previousStart, barStart - 0.001, 0.28);
        stamp(backbeats, "clap", previousStart, barStart - 0.001, 0.28);
        stamp(song.hats, "hat", previousStart, barStart - 0.001, 0.28, 0.25);
        context.restore();
        // this bar, up to now
        stamp(song.bassNotes, "bass", barStart, time, 1);
        stamp(landing, "kick", barStart, time, 1);
        stamp(backbeats, "clap", barStart, time, 1);
        stamp(song.hats, "hat", barStart, time, 1, 0.25);
        context.fillStyle = cssColor(inkColor, 0.85);
        context.fillRect(xAt(phaseNow) - 2 * unit, laneTop - 4 * unit, 4 * unit, laneHeight + 8 * unit);
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
          context.fillStyle = dark ? pocketInk.cream : pocketInk.black;
          context.fillRect(-slipWidth / 2, -slipHeight / 2, slipWidth, slipHeight * 0.92);
          context.fillStyle = field;
          context.fillText(word, -slipWidth / 2 + slipHeight * 0.3, slipHeight * 0.26);
          context.restore();
          count++;
        }
      }

      // The key word leaves the singer as big cut-paper letters, whole at once, and stays at
      // least 0.8 s. The one sung into the main drop is set across the frame.
      if (word) {
        const index = lastIndexAtOrBefore(song.anchorStarts, time);
        if (index >= 0) {
          const moment = song.anchor.moments[index];
          const nextStart = index + 1 < song.anchor.moments.length ? song.anchor.moments[index + 1].start : Infinity;
          const holdEnd = Math.min(nextStart, Math.max(moment.end, moment.start + 0.8));
          const main = song.mainDrop >= 0 && Math.abs(song.drops[song.mainDrop].time - moment.start) < 1.2;
          if (time < holdEnd || (main && sinceDrop < song.beatPeriod * 4 && drop.index === song.mainDrop)) {
            const age = time - moment.start;
            const size = main ? Math.min(420 * unit, (width * 0.9) / (word.length * 0.62)) : Math.min(260 * unit, (width * 0.8) / Math.max(3, word.length) / 0.62);
            context.font = `800 ${size}px "Jost", sans-serif`;
            const total = context.measureText(word).width;
            let x = main ? (width - total) / 2 : clampRange(singerX - total / 2, width * 0.03, width * 0.97 - total);
            const pop = easeOutBack(clamp01(age / 0.1));
            const baseline = main ? floor * 0.62 : Math.max(ceiling + size * 0.8, floor * 0.55) - pop * 40 * unit;
            context.fillStyle = dark ? pocketInk.cream : pocketInk.black;
            for (let letter = 0; letter < word.length; letter++) {
              const glyph = word[letter];
              const letterWidth = context.measureText(glyph).width;
              context.save();
              context.translate(x + letterWidth / 2, baseline - size * 0.35);
              context.rotate((hash01(letter * 17 + index) - 0.5) * 0.3);
              context.scale(0.6 + 0.4 * pop, 0.6 + 0.4 * pop);
              context.fillText(glyph, -letterWidth / 2, size * 0.35);
              context.restore();
              x += letterWidth;
            }
          }
        }
      }

      // The drop: the floor rises to meet everything for its first frames.
      if (slam > 0) {
        context.fillStyle = dark ? pocketInk.cream : pocketInk.black;
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
        const field = song ? pocketFields[sceneFields[0]] || pocketFields.cream : pocketFields.cream;
        return { "--pocket-field": field, "--pocket-ink": pocketInk.black };
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
