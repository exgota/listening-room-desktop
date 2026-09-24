// Pocket: a troupe of cut-paper figures, one per instrument, on a small stage. Every
// movement is keyed to that instrument's own onsets, so the groove on screen is the band's
// groove: the drum (a black disc) touches the floor exactly on each kick; the bass (a red
// dome) winds up before each note and lands on it, wherever the bass line pushes or lays
// back; the hands clap on the backbeat; the fringe marks every hi-hat against a faint
// sixteenth grid; the singer stretches with the sung pitch and sways with the song's own
// swing (measured from where the bass lands against the beat). Each figure keeps its colour
// all song; the fields come from a pale family none of them can vanish into. The troupe
// moves between formations by section (a trio, a solo for the singer, a chorus line that
// grows after each drop); after the main drop the stage goes to night. A build darkens the
// stage and crouches everyone, the gap holds them in the air, the drop lands them together.

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
  night: "#151413",
};

// Where the troupe stands. x in frame widths; a dome's pair is the range its notes span.
const pocketFormations = {
  trio: { drums: [0.19], drumScale: 1, domes: [[0.34, 0.9]], domeScale: 1, singer: 0.62, singerScale: 1, hands: [0.8, 0.4], handsScale: 1 },
  solo: { drums: [0.11], drumScale: 0.68, domes: [[0.2, 0.4]], domeScale: 0.72, singer: 0.56, singerScale: 1.22, hands: [0.85, 0.34], handsScale: 0.8 },
  line3: { drums: [0.16, 0.5, 0.84], drumScale: 0.72, domes: [[0.08, 0.42], [0.58, 0.92]], domeScale: 0.78, singer: 0.33, singerScale: 1.05, hands: [0.67, 0.36], handsScale: 0.9 },
  line5: { drums: [0.1, 0.3, 0.5, 0.7, 0.9], drumScale: 0.6, domes: [[0.06, 0.4], [0.6, 0.94]], domeScale: 0.74, singer: 0.4, singerScale: 1.0, hands: [0.6, 0.34], handsScale: 0.85 },
};

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
    let sceneLooks = [];
    // A cut edge per figure: fixed small irregularities so the shapes read as cut paper.
    const cutEdge = Array.from({ length: 64 }, (_, index) => 1 + (hash01(index * 31 + 7) - 0.5) * 0.035);
    // The drum lands on every kick and on every drop frame; the hands close on the strong
    // backbeats only (the snare band's ghost notes just twitch them).
    let landing = new SongEvents([]);
    let backbeats = new SongEvents([]);

    function setSong(model) {
      song = model;
      presence = null;
      themeField = "";
      sceneLooks = [];
      landing = new SongEvents([]);
      backbeats = new SongEvents([]);
      if (!model) return;
      const strong = [];
      for (let index = 0; index < model.snares.length; index++)
        if (model.snares.strength[index] > 0.4) strong.push([model.snares.time[index], model.snares.strength[index]]);
      backbeats = new SongEvents(strong);
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
      // Each scene's field and formation.
      model.scenes.forEach((scene) => {
        let dropsSeen = 0;
        for (const drop of model.drops) if (drop.time <= scene.start + 0.05) dropsSeen++;
        const afterMain = model.mainDrop >= 0 && scene.start >= model.drops[model.mainDrop].time - 0.05;
        let field, formation;
        switch (scene.kind) {
          case "intro": field = "cream"; formation = "trio"; break;
          case "verse": field = afterMain ? "night" : "blush"; formation = "solo"; break;
          case "break": field = afterMain ? "night" : "sky"; formation = "solo"; break;
          case "groove": field = "mint"; formation = "trio"; break;
          case "build": field = "blush"; formation = "trio"; break;
          case "gap": field = "night"; formation = "trio"; break;
          case "drop":
            field = afterMain ? "night" : ["cream", "mint", "blush"][scene.kindIndex % 3];
            formation = dropsSeen === 0 ? "trio" : afterMain || dropsSeen >= 2 ? "line5" : "line3";
            break;
          case "drive":
            field = afterMain ? "night" : ["cream", "mint", "blush"][scene.kindIndex % 3];
            // after the drops the troupe keeps changing shape, scene by scene
            formation = dropsSeen === 0 ? "trio" : [afterMain || dropsSeen >= 2 ? "line5" : "line3", "trio", "line3"][scene.kindIndex % 3];
            break;
          case "outro": field = afterMain ? "night" : "cream"; formation = "trio"; break;
          default: field = "cream"; formation = "trio";
        }
        sceneLooks.push({ field, formation });
      });
      // Who is playing: each stem awake from the first bar it plays until two quiet bars.
      const bars = model.downbeats;
      presence = {};
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
            if (!open) open = { start, end };
            open.end = end;
          } else if (open && ++quiet >= 2) {
            spans.push(open);
            open = null;
          }
        }
        if (open) spans.push(open);
        presence[figure] = spans;
      }
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

    function dome(cx, floor, width, height, lean, color) {
      context.fillStyle = color;
      context.beginPath();
      for (let index = 0; index <= 32; index++) {
        const angle = Math.PI + (index / 32) * Math.PI;
        const wobble = cutEdge[(index + 11) % 64];
        const y = floor + Math.sin(angle) * height * wobble;
        const x = cx + Math.cos(angle) * width * 0.5 * wobble + lean * (floor - y);
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

    function bassX(index, range, width) {
      if (index < 0) return (width * (range[0] + range[1])) / 2;
      return width * (range[0] + (range[1] - range[0]) * fract((song.bassNotes.pitch[index] - 24) / 24));
    }

    function drawBass(time, range, floor, unit, width, size, crouch, lift, slam, awakeness) {
      const notes = song.bassNotes;
      const last = notes.last(time);
      const next = last + 1 < notes.length ? last + 1 : -1;
      let x = bassX(last, range, width),
        hop = 0,
        lean = 0;
      if (next >= 0 && awakeness > 0.2) {
        const nextStart = notes.start[next];
        const gapToNext = nextStart - (last >= 0 ? notes.start[last] : nextStart - 1);
        const flight = Math.min(0.2, gapToNext * 0.8);
        if (time > nextStart - flight) {
          const u = (time - (nextStart - flight)) / flight;
          x = mixValue(bassX(last, range, width), bassX(next, range, width), easeInOutCubic(u));
          hop = 4 * u * (1 - u) * Math.min(240, 1300 * flight) * unit * size;
          lean = bassX(next, range, width) > bassX(last, range, width) ? 0.22 : -0.22;
        }
      }
      const squash = last >= 0 ? hitDecay(time - notes.start[last], 0.07) * notes.strength[last] : 0;
      const w = 600 * unit * size * (1 + 0.2 * squash) * (1 + crouch * 0.25);
      const h = 290 * unit * size * (1 - 0.28 * squash) * (1 - crouch * 0.4) * (1 + slam * 0.35) * (0.5 + 0.5 * awakeness);
      dome(x, floor - hop * awakeness - lift, w, h, lean * awakeness, pocketInk.tomato);
    }

    function render(time, frame) {
      const width = frame.width,
        height = frame.height;
      context.setTransform(scale, 0, 0, scale, 0, 0);
      if (!song) {
        context.fillStyle = pocketFields.cream;
        context.fillRect(0, 0, width, height);
        return;
      }
      const unit = height / 1080;
      const floor = height * 0.86;
      // nothing rises into the title
      const ceiling = Math.max(height * 0.2, (frame.titleBottom || 0) + 12 * unit);
      const sceneIndex = song.sceneIndex(time);
      const scene = song.scenes[sceneIndex];
      const look = sceneLooks[sceneIndex];
      const previousLook = sceneLooks[Math.max(0, sceneIndex - 1)];
      const drop = song.dropContext(time);
      const leadIn = song.anchor.kind === "lead_in" ? song.anchorAt(time) : -1;
      const inGap = drop.phase === 2 || leadIn >= 0;
      const sinceDrop = drop.phase === 3 ? drop.since : Infinity;
      const hit = sinceDrop < song.beatPeriod * 2;

      // Field: the scene's; a build darkens it toward night; each drop's hit is night.
      let fieldColor = hexColor(pocketFields[look.field]);
      const windUp = drop.phase === 1 ? drop.progress : 0;
      if (windUp > 0) fieldColor = mixColor(fieldColor, hexColor(pocketFields.night), 0.72 * easeInCubic(windUp));
      if (inGap || hit) fieldColor = hexColor(pocketFields.night);
      const dark = fieldColor[0] + fieldColor[1] + fieldColor[2] < 1.2;
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

      // Harmony: two neutral wings at the sides of the stage, their edges set by the chord.
      const chordIndex = song.chordIndex(time);
      if (chordIndex >= 0 && song.value("other", time) > 0.15) {
        const chord = song.chords[chordIndex];
        const previous = chordIndex > 0 ? song.chords[chordIndex - 1] : chord;
        const reach = (root, minor) => 0.05 + 0.11 * fract(((root * 7) % 12) / 12 + minor * 0.5);
        const move = easeOutCubic((time - chord.start) / 0.2);
        const left = mixValue(reach(previous.root, previous.minor), reach(chord.root, chord.minor), move) * width;
        const right = mixValue(reach(previous.root + 5, previous.minor), reach(chord.root + 5, chord.minor), move) * width;
        context.fillStyle = cssColor(mixColor(fieldColor, dark ? [1, 1, 1] : [0, 0, 0], 0.07));
        context.fillRect(0, 0, left, floor);
        context.fillRect(width - right, 0, right, floor);
      }
      // Floor: the field, a shade darker (the transport sits on it when shown).
      context.fillStyle = cssColor(mixColor(fieldColor, dark ? [1, 1, 1] : [0, 0, 0], dark ? 0.1 : 0.14));
      context.fillRect(0, floor, width, height - floor);

      // Formation: the scene's, walked to over 0.6 s from the previous scene's; a drop
      // puts the troupe on its marks on the drop frame itself.
      const into = scene.kind === "drop" ? 1 : easeInOutCubic((time - scene.start) / 0.6);
      const from = pocketFormations[previousLook.formation],
        to = pocketFormations[look.formation];
      const position = (a, b) => mixValue(a, b, into);

      // Wind-up: everyone crouches through a build; the gap holds them in the air; the drop
      // lands them with a slam.
      const crouch = 0.55 * windUp;
      const shake = windUp > 0 ? Math.sin(time * 70) * (3 + 10 * windUp) * unit : 0;
      let hang = 0;
      if (inGap) {
        const holdStart = drop.phase === 2 ? drop.drop.gapStart : song.anchor.moments[leadIn].start;
        hang = easeOutCubic(clamp01((time - holdStart) / 0.25));
      }
      const slam = sinceDrop < 0.25 ? 1 - sinceDrop / 0.25 : 0;
      const liftFor = (maximum) => hang * Math.min(maximum, (floor - ceiling) * 0.45);
      // the main drop lands the cast a size larger, settling over its first bar
      const grow = drop.phase === 3 && drop.index === song.mainDrop ? 1 + 0.22 * (1 - easeInOutCubic(sinceDrop / (song.beatPeriod * 4))) : 1;

      // Hats → the fringe along the top right: each hat of the last beat and a half is a tick
      // at its phase in the bar, over a faint grid of the bar's sixteenths.
      const inkColor = hexColor(pocketInk[inkName]);
      {
        const fringeAwake = awake("fringe", time);
        const gridLeft = width * 0.5,
          gridRight = width * 0.975;
        const tickWidth = 30 * unit,
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
          if (age > song.beatPeriod * 1.5) break;
          const barAt = song.barPosition(hatTime);
          const x = gridLeft + (barAt - Math.floor(barAt)) * (gridRight - gridLeft);
          const fresh = hitDecay(age, song.beatPeriod * 0.4);
          context.fillStyle = cssColor(inkColor, 0.3 + 0.7 * fresh);
          context.fillRect(x - tickWidth / 2, 0, tickWidth, tickHeight * (0.5 + 0.5 * song.hats.strength[index]) * (0.3 + 0.7 * fresh) * (1 - hang * 0.4));
          index--;
        }
      }

      // Voice → the singer: a tall column, taller with the pitch, its mouth open with the
      // level, swaying with the song's swing.
      const singerAwake = awake("singer", time);
      const singerX = position(from.singer, to.singer) * width + shake;
      const singerScale = position(from.singerScale, to.singerScale) * grow;
      {
        const pitch = song.value("pitch", time);
        const level = clamp01((song.value("vocal", time) - 0.15) / 0.6);
        const range = pitch > 0 ? clamp01((pitch - 50) / 28) : 0.2;
        const phase = fract(song.beatPosition(time));
        const split = 0.5 + swingLate * 2; // the swung eighth lands late by twice the sixteenth's lag
        const swayPhase = phase < split ? (phase / split) * 0.5 : 0.5 + ((phase - split) / (1 - split)) * 0.5;
        const sway = Math.sin(swayPhase * Math.PI * 2) * 0.1 * singerAwake * (1 - windUp);
        const bodyWidth = 230 * unit * singerScale;
        const available = floor - ceiling - bodyWidth * 0.2;
        const bodyHeight = Math.min(available, (380 + 420 * range) * unit * singerScale * (0.62 + 0.38 * level) * (0.5 + 0.5 * singerAwake) * (1 - crouch * 0.4));
        const lift = liftFor(260 * unit);
        const top = floor - bodyHeight - lift;
        const base = floor - lift;
        context.fillStyle = pocketInk.cobalt;
        context.beginPath();
        context.moveTo(singerX - bodyWidth / 2, base);
        context.lineTo(singerX - bodyWidth / 2 + sway * bodyHeight, top + bodyWidth / 2);
        context.arc(singerX + sway * bodyHeight, top + bodyWidth / 2, bodyWidth / 2, Math.PI, 0);
        context.lineTo(singerX + bodyWidth / 2, base);
        context.closePath();
        context.fill();
        // the mouth, only where the body is tall enough to hold it
        if (bodyHeight > bodyWidth * 1.1) {
          context.fillStyle = field;
          const slot = Math.min(bodyWidth * 0.42, 8 * unit + 110 * unit * level * singerScale);
          const slotWidth = bodyWidth * 0.62;
          const cx = singerX + sway * bodyHeight * 0.85,
            cy = top + bodyWidth * 0.7;
          context.beginPath();
          context.roundRect(cx - slotWidth / 2, cy - slot / 2, slotWidth, slot, slot / 2);
          context.fill();
        }
      }

      // Snare → the hands: two triangles that meet on each backbeat.
      {
        const handsAwake = awake("hands", time);
        const next = backbeats.until(time);
        const last = backbeats.since(time);
        const approach = song.beatPeriod * 0.5;
        let apart = 1;
        if (next < approach) apart = next / approach;
        if (last < 0.14) apart = Math.min(apart, easeOutCubic(last / 0.14));
        apart -= 0.12 * song.snares.impulse(time, 0.05) * (1 - clamp01(1 - apart));
        if (inGap) apart = 0.15;
        apart = mixValue(1.25, apart, handsAwake);
        const handsScale = position(from.handsScale, to.handsScale);
        const cx = position(from.hands[0], to.hands[0]) * width + shake;
        const size = 190 * unit * handsScale;
        const cy = Math.max(ceiling + size * 0.8, position(from.hands[1], to.hands[1]) * height - liftFor(120 * unit) + (1 - handsAwake) * 120 * unit + crouch * 90 * unit);
        const gap = 14 * unit + 250 * unit * handsScale * apart;
        paperShape([[cx - gap / 2, cy], [cx - gap / 2 - size, cy - size * 0.8], [cx - gap / 2 - size, cy + size * 0.8]], pocketInk.mustard);
        paperShape([[cx + gap / 2, cy], [cx + gap / 2 + size, cy - size * 0.8], [cx + gap / 2 + size, cy + size * 0.8]], pocketInk.mustard);
      }

      // Bass → the domes (a second one in the chorus line), each hopping to every bass note.
      {
        const bassAwake = awake("bass", time);
        const domeScale = position(from.domeScale, to.domeScale) * grow;
        const count = Math.max(from.domes.length, to.domes.length);
        for (let index = 0; index < count; index++) {
          const a = from.domes[Math.min(index, from.domes.length - 1)],
            b = to.domes[Math.min(index, to.domes.length - 1)];
          const appear = index < from.domes.length ? (index < to.domes.length ? 1 : 1 - into) : into;
          if (appear < 0.02) continue;
          const range = [position(a[0], b[0]), position(a[1], b[1])];
          context.save();
          context.translate(shake, 0);
          drawBass(time, range, floor, unit, width, domeScale * appear, crouch, liftFor(200 * unit), slam, bassAwake);
          context.restore();
        }
      }

      // Kick → the drums: discs that touch the floor exactly on each kick (and on each drop).
      {
        const drumAwake = awake("drum", time);
        const drumScale = position(from.drumScale, to.drumScale) * grow;
        const count = Math.max(from.drums.length, to.drums.length);
        const jump = bounce(time, 300 * unit, 1300 * unit);
        const contact = hitDecay(jump.age, 0.06) * (0.4 + 0.6 * jump.strength);
        const color = dark ? pocketInk.cream : pocketInk.black;
        for (let index = 0; index < count; index++) {
          const a = from.drums[Math.min(index, from.drums.length - 1)],
            b = to.drums[Math.min(index, to.drums.length - 1)];
          const appear = index < from.drums.length ? (index < to.drums.length ? 1 : 1 - into) : into;
          if (appear < 0.02) continue;
          const radius = 195 * unit * drumScale * appear;
          const rx = radius * (1 + 0.32 * contact + crouch * 0.35);
          const ry = radius * (1 - 0.34 * contact - crouch * 0.3);
          const rise = jump.height * drumAwake * drumScale * (1 - windUp * 0.5);
          const cy = Math.max(ceiling + ry, floor - ry - rise - liftFor(330 * unit));
          disc(position(a, b) * width + shake, cy, rx, ry, color, 3 + index * 7);
        }
      }

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
        const laneInk = hexColor(pocketInk[inkName]);
        context.fillStyle = cssColor(laneInk, 0.2);
        for (let step = 0; step < 16; step++) context.fillRect(xAt(step / 16) - 1.5 * unit, laneTop, 3 * unit, laneHeight * (step % 4 === 0 ? 1 : 0.45));
        const size = laneHeight * 0.3;
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
              else if (kind === "bass") dome(x, laneBottom, size * 1.25, size * 0.75, 0, pocketInk.tomato);
              else if (kind === "clap") paperShape([[x, laneTop + laneHeight * 0.05], [x - size * 0.45, laneTop + laneHeight * 0.45], [x + size * 0.45, laneTop + laneHeight * 0.45]], pocketInk.mustard);
              else {
                context.fillStyle = cssColor(laneInk);
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
        context.fillStyle = cssColor(laneInk, 0.85);
        context.fillRect(xAt(phaseNow) - 2 * unit, laneTop - 4 * unit, 4 * unit, laneHeight + 8 * unit);
      }

      // Every key word sung so far lies in a pile of paper slips at the right of the stage.
      if (song.anchor.kind === "word") {
        const word = song.anchor.word.toUpperCase();
        const slipHeight = Math.min(38 * unit, (floor - ceiling) * 0.9 / Math.max(8, song.anchor.moments.length));
        context.font = `800 ${slipHeight * 0.78}px "Jost", sans-serif`;
        const slipWidth = context.measureText(word).width + slipHeight * 0.6;
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

      // The key word leaves the singer as big cut-paper letters.
      const anchor = song.anchor.kind === "word" ? song.anchorAt(time) : -1;
      if (anchor >= 0) {
        const moment = song.anchor.moments[anchor];
        const age = time - moment.start;
        const word = song.anchor.word.toUpperCase();
        const size = Math.min(260 * unit, (width * 0.8) / Math.max(3, word.length) / 0.62);
        context.font = `800 ${size}px "Jost", sans-serif`;
        const total = context.measureText(word).width;
        let x = clampRange(singerX - total / 2, width * 0.03, width * 0.97 - total);
        const baseline = Math.max(ceiling + size * 0.8, floor * 0.55) - easeOutBack(age / 0.22) * 60 * unit;
        context.fillStyle = dark ? pocketInk.cream : pocketInk.black;
        for (let index = 0; index < word.length; index++) {
          const letter = word[index];
          const letterWidth = context.measureText(letter).width;
          const pop = easeOutBack(clamp01((age - index * 0.03) / 0.18));
          context.save();
          context.translate(x + letterWidth / 2, baseline - size * 0.35);
          context.rotate((hash01(index * 17 + anchor) - 0.5) * 0.3);
          context.scale(pop, pop);
          context.fillText(letter, -letterWidth / 2, size * 0.35);
          context.restore();
          x += letterWidth;
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
        return { "--pocket-field": pocketFields.cream, "--pocket-ink": pocketInk.black };
      },
      setActive(on) {
        canvas.hidden = !on;
      },
      resize(width, height, ratio) {
        const [w, h, s] = canvasPixels(width, height, Math.min(ratio, 2), 2560 * 1440);
        canvas.width = w;
        canvas.height = h;
        scale = s;
      },
      render,
    };
  },
});
