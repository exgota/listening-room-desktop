// Pocket: a troupe of cut-paper figures, one per instrument, on a small stage. Every
// movement is keyed to that instrument's own onsets, so the groove on screen is the band's
// groove: the drum (a black disc) touches the floor exactly on each kick; the bass (a red
// dome) winds up before each note and lands on it, wherever the bass line pushes or lays
// back; the hands clap on the backbeat; the fringe marks every hi-hat where it actually
// falls against a faint sixteenth grid, so swing shows as uneven spacing; the singer
// stretches with the sung pitch. Figures walk on when their instrument enters and leave when
// it stops. Builds wind everyone up, the gap holds them in the air, the drop lands them.

const pocketColors = {
  cream: "#f2e8d3",
  black: "#151413",
  tomato: "#e4472b",
  mustard: "#eab12c",
  cobalt: "#2749b5",
  pink: "#f2a6b8",
  teal: "#17806f",
};
// Field colours by scene, chosen so no figure disappears into the field.
const pocketFields = ["mustard", "pink", "teal", "cobalt", "tomato", "cream"];
const pocketFigureColor = { drum: "black", bass: "tomato", hands: "mustard", singer: "cobalt", fringe: "black" };

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
    let sceneFields = [];
    let themeField = "";
    // A cut edge per figure: fixed small irregularities so the shapes read as cut paper.
    const cutEdge = Array.from({ length: 64 }, (_, index) => 1 + (hash01(index * 31 + 7) - 0.5) * 0.035);

    function fieldFor(sceneIndex, kind) {
      return sceneFields[sceneIndex] || "mustard";
    }

    function setSong(model) {
      song = model;
      presence = null;
      sceneFields = [];
      if (!model) return;
      // Scene colours: breaks cool, drops hot, the rest cycling, never the same twice in a row.
      let previous = "";
      model.scenes.forEach((scene, index) => {
        let name;
        if (scene.kind === "drop") name = "tomato";
        else if (scene.kind === "break" || scene.kind === "gap") name = "cobalt";
        else if (scene.kind === "build") name = "pink";
        else name = ["mustard", "teal", "pink", "cream"][(scene.kindIndex + index) % 4];
        if (name === previous) name = name === "mustard" ? "teal" : "mustard";
        sceneFields.push(name);
        previous = name;
      });
      // Who is on stage: each stem present from the first bar it plays until two quiet bars.
      const bars = model.downbeats;
      const performance = model;
      const present = (series, start, end, floor) => performance.mean(series, start, end) > floor;
      presence = {};
      for (const [figure, series, floor] of [["drum", null, 0], ["bass", "bass", 0.18], ["singer", "vocal", 0.2], ["hands", null, 0], ["fringe", "hats", 0.12]]) {
        const spans = [];
        let open = null,
          quiet = 0;
        for (let index = 0; index < bars.length; index++) {
          const start = bars[index],
            end = index + 1 < bars.length ? bars[index + 1] : model.duration;
          let on;
          if (figure === "drum") {
            const first = model.kicks.last(start) + 1,
              last = model.kicks.last(end - 0.001);
            on = last - first + 1 >= 2;
          } else if (figure === "hands") {
            const first = model.snares.last(start) + 1,
              last = model.snares.last(end - 0.001);
            let strong = 0;
            for (let event = first; event <= last; event++) if (model.snares.strength[event] > 0.5) strong++;
            on = strong >= 1;
          } else on = present(series, start, end, floor);
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

    // How awake a figure is: 0 resting (its instrument is not playing), 1 playing. Everyone
    // stays on stage so every frame is composed; a figure wakes over the half second before
    // its instrument's first bar and settles over the half second after its last.
    function onStage(figure, time) {
      const spans = presence?.[figure];
      if (!spans) return { amount: 1, entering: 0 };
      for (const span of spans) {
        if (time >= span.start - 0.45 && time < span.end + 0.6) {
          if (time < span.start) return { amount: easeInCubic(1 - (span.start - time) / 0.45), entering: 0 };
          if (time > span.end) return { amount: 1 - easeInOutCubic((time - span.end) / 0.6), entering: 0 };
          return { amount: 1, entering: 0 };
        }
      }
      return { amount: 0, entering: 0 };
    }

    function paperShape(points, color) {
      context.fillStyle = pocketColors[color] || color;
      context.beginPath();
      points.forEach(([x, y], index) => (index ? context.lineTo(x, y) : context.moveTo(x, y)));
      context.closePath();
      context.fill();
    }

    function disc(cx, cy, rx, ry, color, seed = 0) {
      const points = [];
      for (let index = 0; index < 48; index++) {
        const angle = (index / 48) * Math.PI * 2;
        const wobble = cutEdge[(index + seed) % 64];
        points.push([cx + Math.cos(angle) * rx * wobble, cy + Math.sin(angle) * ry * wobble]);
      }
      paperShape(points, color);
    }

    function dome(cx, floor, width, height, lean, color) {
      const points = [];
      for (let index = 0; index <= 32; index++) {
        const angle = Math.PI + (index / 32) * Math.PI;
        const wobble = cutEdge[(index + 11) % 64];
        const y = floor + Math.sin(angle) * height * wobble;
        const x = cx + Math.cos(angle) * width * 0.5 * wobble + lean * (floor - y);
        points.push([x, y]);
      }
      paperShape(points, color);
    }

    // Height of a figure bouncing between events: on the floor at each event, a parabola
    // between them, lower when the events come faster. With no event for a while it rests,
    // and hops up in time to land on the next one.
    function bounce(events, time, maximum, perSecond) {
      const index = events.last(time);
      const next = index + 1 < events.length ? events.time[index + 1] : Infinity;
      const last = index >= 0 ? events.time[index] : -Infinity;
      const gap = next - last;
      if (gap <= 1.6) {
        const u = (time - last) / gap;
        return { height: Math.min(maximum, gap * perSecond) * 4 * u * (1 - u), age: time - last };
      }
      const toNext = next - time;
      if (toNext < 0.4) {
        const u = 1 - toNext / 0.4;
        return { height: Math.min(maximum, 0.4 * perSecond) * 4 * u * (1 - u), age: time - last };
      }
      return { height: 0, age: time - last };
    }

    // ---- figures: each drawn at a song time, so echoes are the same figure a beat late ----

    function drawDrum(time, x, floor, unit, color, size, windUp, hang) {
      const radius = 195 * unit * size;
      // the bounce stays under the title band
      const jump = bounce(song.kicks, time, 300 * unit * size, 1300 * unit * size);
      const contact = hitDecay(jump.age, 0.06);
      const rx = radius * (1 + 0.3 * contact - 0.12 * windUp);
      const ry = radius * (1 - 0.32 * contact + 0.12 * windUp);
      const cy = floor - ry - jump.height * (1 - windUp * 0.6) - hang * 330 * unit;
      disc(x, cy, rx, ry, color, 3);
    }

    function bassX(index, width) {
      if (index < 0) return width * 0.62;
      return width * (0.3 + 0.62 * fract((song.bassNotes.pitch[index] - 24) / 24));
    }

    function drawBass(time, floor, unit, width, color, size, windUp, hang, slam, awake = 1) {
      const notes = song.bassNotes;
      const last = notes.last(time);
      const next = last + 1 < notes.length ? last + 1 : -1;
      let x = bassX(last, width),
        lift = 0,
        lean = 0;
      if (next >= 0) {
        const nextStart = notes.start[next];
        const gapToNext = nextStart - (last >= 0 ? notes.start[last] : nextStart - 1);
        const flight = Math.min(0.2, gapToNext * 0.8);
        if (time > nextStart - flight) {
          const u = (time - (nextStart - flight)) / flight;
          x = mixValue(bassX(last, width), bassX(next, width), easeInOutCubic(u));
          lift = 4 * u * (1 - u) * Math.min(240, 1300 * flight) * unit * size;
          lean = bassX(next, width) > bassX(last, width) ? 0.22 : -0.22;
        }
      }
      const squash = last >= 0 ? hitDecay(time - notes.start[last], 0.07) * notes.strength[last] : 0;
      const w = 600 * unit * size * (1 + 0.2 * squash) * (1 + windUp * 0.15);
      const h = 290 * unit * size * (1 - 0.28 * squash) * (1 - windUp * 0.35) * (1 + slam * 0.3) * (0.5 + 0.5 * awake);
      dome(x, floor - lift * awake - hang * 180 * unit, w, h, lean * awake, color);
    }

    function render(time, frame) {
      const width = frame.width,
        height = frame.height;
      context.setTransform(scale, 0, 0, scale, 0, 0);
      if (!song) {
        context.fillStyle = pocketColors.mustard;
        context.fillRect(0, 0, width, height);
        return;
      }
      const scene = song.scene(time);
      const drop = song.dropContext(time);
      const inGap = drop.phase === 2;
      const sinceDrop = drop.phase === 3 ? drop.since : Infinity;
      const unit = height / 1080;
      const floor = height * 0.885;

      // Fields: the scene's colour on the left; the harmony's panel on the right, its edge
      // moving to a new place on each chord change.
      let fieldName = fieldFor(scene.index, scene.kind);
      if (inGap) fieldName = "black";
      const field = pocketColors[fieldName] || pocketColors.black;
      const dark = fieldName === "black" || fieldName === "cobalt" || fieldName === "teal" || fieldName === "tomato";
      if (fieldName !== themeField) {
        themeField = fieldName;
        document.documentElement.style.setProperty("--pocket-field", field);
        document.documentElement.style.setProperty("--pocket-ink", dark ? pocketColors.cream : pocketColors.black);
        waveformTheme = null;
      }
      context.fillStyle = field;
      context.fillRect(0, 0, width, height);
      const panelNames = ["cream", "pink", "mustard", "teal", "cobalt", "tomato"].filter((name) => name !== fieldName);
      const chordIndex = song.chordIndex(time);
      if (!inGap && chordIndex >= 0) {
        const chord = song.chords[chordIndex];
        const previous = chordIndex > 0 ? song.chords[chordIndex - 1] : chord;
        const edgeFor = (entry) => width * (0.52 + 0.3 * fract(entry.root * 5 / 12 + entry.minor * 0.37));
        const move = easeOutCubic((time - chord.start) / 0.18);
        const edge = mixValue(edgeFor(previous), edgeFor(chord), move);
        const panel = panelNames[(chord.root + chord.minor * 3) % panelNames.length];
        context.fillStyle = pocketColors[panel];
        context.fillRect(edge, 0, width - edge, floor);
      }
      const floorColor = dark ? pocketColors.cream : pocketColors.black;
      context.fillStyle = floorColor;
      context.fillRect(0, floor, width, height - floor);
      const onField = (name) => (name === fieldName ? "cream" : name === "black" && dark && fieldName !== "tomato" && fieldName !== "teal" ? "cream" : name);

      // Wind-up through a build; hold in the air through the gap; slam on the drop.
      const windUp = drop.phase === 1 ? easeInCubic(drop.progress) : 0;
      const hang = inGap ? easeOutCubic(clamp01((time - drop.drop.gapStart) / 0.25)) : 0;
      const slam = sinceDrop < 0.25 ? 1 - sinceDrop / 0.25 : 0;
      const shake = windUp > 0 ? Math.sin(time * 90) * windUp * 9 * unit : 0;
      // Echoes join later in the song: the same figures an eighth and a quarter note late.
      const echoes = scene.kind === "drive" || scene.kind === "drop" ? (time / song.duration > 0.55 ? 2 : 1) : 0;

      // Hats → the fringe along the top: each hat of the last beat and a half is a tick at its
      // true phase in the bar, over a faint grid of the bar's sixteenths.
      const gridLeft = width * 0.44,
        gridRight = width * 0.975,
        gridTop = 0;
      const fringe = onStage("fringe", time);
      {
        const tickWidth = 34 * unit,
          tickHeight = 210 * unit * (0.3 + 0.7 * fringe.amount);
        const ink = hexColor(pocketColors[onField(pocketFigureColor.fringe)]);
        context.fillStyle = cssColor(ink, 0.18);
        for (let step = 0; step < 16; step++) {
          const x = gridLeft + (step / 16) * (gridRight - gridLeft);
          context.fillRect(x - 3 * unit, gridTop, 6 * unit, tickHeight * (step % 4 === 0 ? 0.42 : 0.24));
        }
        let index = song.hats.last(time);
        while (index >= 0) {
          const hatTime = song.hats.time[index];
          const age = time - hatTime;
          if (age > song.beatPeriod * 1.5) break;
          const barAt = song.barPosition(hatTime);
          const x = gridLeft + (barAt - Math.floor(barAt)) * (gridRight - gridLeft);
          const fresh = hitDecay(age, song.beatPeriod * 0.4);
          const length = tickHeight * (0.5 + 0.5 * song.hats.strength[index]) * (0.3 + 0.7 * fresh);
          context.fillStyle = cssColor(ink, 0.3 + 0.7 * fresh);
          context.fillRect(x - tickWidth / 2, gridTop, tickWidth, length * (1 - hang * 0.4));
          index--;
        }
      }

      // Voice → the singer: a tall column, taller with the pitch, its mouth open with the level.
      const singer = onStage("singer", time);
      const singerX = width * 0.6 + shake;
      {
        const pitch = song.value("pitch", time);
        const level = clamp01((song.value("vocal", time) - 0.15) / 0.6);
        const range = pitch > 0 ? clamp01((pitch - 50) / 28) : 0.2;
        const bodyHeight = (420 + 420 * range) * unit * (0.62 + 0.38 * level) * (0.45 + 0.55 * singer.amount);
        const bodyWidth = 230 * unit;
        const lift = hang * 140 * unit;
        const top = floor - bodyHeight - lift;
        context.fillStyle = pocketColors[onField(pocketFigureColor.singer)];
        context.beginPath();
        context.moveTo(singerX - bodyWidth / 2, floor - lift);
        context.lineTo(singerX - bodyWidth / 2, top + bodyWidth / 2);
        context.arc(singerX, top + bodyWidth / 2, bodyWidth / 2, Math.PI, 0);
        context.lineTo(singerX + bodyWidth / 2, floor - lift);
        context.closePath();
        context.fill();
        context.fillStyle = field;
        const mouthHeight = 10 * unit + 120 * unit * level;
        context.beginPath();
        context.ellipse(singerX, top + bodyWidth * 0.66, 60 * unit, mouthHeight / 2, 0, 0, Math.PI * 2);
        context.fill();
      }

      // Snare → the hands: two big triangles that meet on each backbeat.
      const hands = onStage("hands", time);
      {
        const next = song.snares.until(time);
        const last = song.snares.since(time);
        const approach = song.beatPeriod * 0.5;
        let apart = 1;
        if (next < approach) apart = next / approach;
        if (last < 0.14) apart = Math.min(apart, easeOutCubic(last / 0.14));
        apart = mixValue(1.25, apart, hands.amount);
        const cx = width * 0.8 + shake,
          cy = height * 0.4 - hang * 80 * unit + (1 - hands.amount) * 150 * unit;
        const gap = 14 * unit + 260 * unit * apart;
        const size = 200 * unit;
        const color = onField(pocketFigureColor.hands);
        paperShape([[cx - gap / 2, cy], [cx - gap / 2 - size, cy - size * 0.8], [cx - gap / 2 - size, cy + size * 0.8]], color);
        paperShape([[cx + gap / 2, cy], [cx + gap / 2 + size, cy - size * 0.8], [cx + gap / 2 + size, cy + size * 0.8]], color);
      }

      // Bass → the dome, with echoes behind it.
      const bass = onStage("bass", time);
      {
        const entering = 0;
        for (let echo = echoes; echo >= 1; echo--) {
          context.save();
          context.translate(0, -entering);
          drawBass(time - echo * song.beatPeriod * 0.5, floor, unit, width, onField(echo === 1 ? "pink" : "mustard"), 1 - 0.18 * echo, windUp, hang, 0, bass.amount);
          context.restore();
        }
        context.save();
        context.translate(shake, -entering);
        drawBass(time, floor, unit, width, onField(pocketFigureColor.bass), 1, windUp, hang, slam, bass.amount);
        context.restore();
      }

      // Kick → the drum: a big disc that touches the floor exactly on each kick.
      const drum = onStage("drum", time);
      {
        context.save();
        for (let echo = echoes; echo >= 1; echo--)
          drawDrum(time - echo * song.beatPeriod * 0.5, width * 0.17 + echo * 150 * unit, floor, unit, onField(echo === 1 ? "cobalt" : "teal"), 1 - 0.25 * echo, windUp, hang);
        drawDrum(time, width * 0.17 + shake, floor, unit, onField(pocketFigureColor.drum), 1, windUp, hang);
        context.restore();
      }

      // The key word leaves the singer as big cut-paper letters.
      const anchor = song.anchor.kind === "word" ? song.anchorAt(time) : -1;
      if (anchor >= 0) {
        const moment = song.anchor.moments[anchor];
        const age = time - moment.start;
        const size = 230 * unit;
        context.font = `700 ${size}px "Jost", sans-serif`;
        context.textAlign = "center";
        context.fillStyle = pocketColors[onField("cream")];
        const rise = easeOutBack(age / 0.22) * 230 * unit;
        context.fillText(song.anchor.word.toUpperCase(), singerX, floor - 420 * unit - rise);
        context.textAlign = "left";
      }

      // The drop: the floor rises to meet everything for its first frames.
      if (slam > 0) {
        context.fillStyle = floorColor;
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
        return { "--pocket-field": pocketColors.mustard, "--pocket-ink": pocketColors.black };
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
