// Type: the sung words set as posters. Each sung line is laid out ahead of time as a block
// of rows in a heavy grotesque and shown whole as a hairline outline when it begins; each
// word fills in solid on the frame it is sung, so the poster assembles itself in the
// singer's rhythm. Only words that two transcriptions agree on are set; a line the
// transcription could not confirm is left out. Around the words, only typography: the kick
// is a beat counter; the bass is a block of ink rising from the bottom that inverts the type
// it covers; a build floods the ink up the frame; the gap before a drop is a countdown; the
// drop slams the hook across the frame, inverted. Instrumental passages cycle through
// typographic modes by phrase: the hook as a wall stepping on kick and snare, the hook
// alone changing width on the beat, the four beats of the bar, and, where the harmony leads
// (NBLY's chord passages), the chords themselves.

const typePalettes = {
  "5ff86d6cd02ebd7308e03df8": { field: "#2530f2", ink: "#f3efe4", hook: ["NBLY", "LIKE YOU", "NEVER", "LIKE YOU"] },
  "1d589940ca458d793a3fad8a": { field: "#e4261c", ink: "#16090a", hook: ["DESIRE", "IS IT LOVE", "DESIRE", "I WANT"] },
  f127a026dc751f1528bfb95d: { field: "#0b7556", ink: "#f7f0d8", hook: ["OPHELIA", "CAME FOR ME", "THE FATE OF", "OPHELIA"] },
  "8eee874c702a10807f79706c": { field: "#101010", ink: "#e5ff2f", hook: ["OUTSIDE", "FEELS LIKE", "OUTSIDE", "EVERYTHING RIGHT"] },
  "4048d4a6dce44c151690b2b1": { field: "#ff8db0", ink: "#1a1461", hook: ["AMERICAN BOY", "BOY", "LA LA LA", "BOY"] },
};
const typeDefaultPalette = { field: "#2530f2", ink: "#f3efe4", hook: [] };
const typeFamily = '"Archivo", "Arial Narrow", sans-serif';
const typeChordNames = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
// Posters are made for the feed: a swear word is set as a solid bar of its own shape.
const typeBleeped = /^(fuck\w*|motherfuck\w*|shit\w*|bitch\w*|nigg\w*)$/;

registerVisualizer({
  key: "type",
  name: "Type",
  order: 2,
  create() {
    const canvas = createVisualCanvas();
    const context = canvas.getContext("2d");
    const measure = document.createElement("canvas").getContext("2d");
    let song = null;
    let palette = typeDefaultPalette;
    let hookWords = [];
    let mainDrop = -1;
    let scale = 1;
    let inverted = null;
    let songEnd = Infinity;
    const blockCache = new Map();

    function setFont(target, weight, size, stretch) {
      target.font = `${weight} ${size}px ${typeFamily}`;
      target.fontStretch = stretch;
    }

    function textWidth(text, weight, size, stretch) {
      setFont(measure, weight, size, stretch);
      return measure.measureText(text).width;
    }

    // Split words into rows that each fill the measure; pick the split whose block best
    // fills the box without overflowing, with the least disparity between rows and no row of
    // one or two letters.
    function layout(words, boxWidth, boxHeight, weight = 900) {
      const count = words.length;
      let best = null;
      const splits = 1 << Math.max(0, count - 1);
      for (let mask = 0; mask < splits; mask++) {
        const rows = [];
        let current = [0];
        for (let index = 1; index < count; index++) {
          if (mask & (1 << (index - 1))) {
            rows.push(current);
            current = [index];
          } else current.push(index);
        }
        rows.push(current);
        if (rows.length > 4) continue;
        let total = 0,
          smallest = Infinity,
          largest = 0,
          tiny = 0;
        const sized = rows.map((row) => {
          const text = row.map((index) => words[index].display).join(" ");
          const letters = text.length;
          if (letters <= 2 && count > 1) tiny++;
          const stretch = letters <= 4 ? "expanded" : letters <= 7 ? "normal" : letters <= 12 ? "condensed" : "extra-condensed";
          const natural = textWidth(text, weight, 100, stretch);
          let size = (100 * boxWidth) / natural;
          size = Math.min(size, boxHeight * 0.62);
          total += size * 0.8;
          smallest = Math.min(smallest, size);
          largest = Math.max(largest, size);
          return { indices: row, stretch, size };
        });
        const fill = total / boxHeight;
        const overflow = Math.max(0, fill - 1);
        const score = -Math.abs(0.86 - Math.min(fill, 1)) * 2 - overflow * 4 - (largest / smallest - 1) * 0.25 - rows.length * 0.05 - tiny * 1.5;
        if (!best || score > best.score) best = { score, rows: sized, total };
      }
      const shrink = best.total > boxHeight ? boxHeight / best.total : 1;
      const placed = [];
      let y = 0;
      for (const row of best.rows) {
        const size = row.size * shrink;
        const ascent = size * 0.72;
        y += ascent;
        let x = 0;
        const spaceWidth = textWidth(" ", weight, size, row.stretch);
        for (const index of row.indices) {
          const width = textWidth(words[index].display, weight, size, row.stretch);
          placed[index] = { x, baseline: y, width, size, stretch: row.stretch, ascent };
          x += width + spaceWidth;
        }
        const rowWidth = x - spaceWidth;
        // justify only a small shortfall; a big one would open rivers, so the row sits left
        const extra = boxWidth - rowWidth;
        if (row.indices.length > 1 && extra > 0 && extra < boxWidth * 0.12)
          row.indices.forEach((index, position) => (placed[index].x += (extra / (row.indices.length - 1)) * position));
        y += size * 0.08;
      }
      return { placed, height: y };
    }

    function blockFor(line, boxWidth, boxHeight) {
      const key = `${line.number}:${Math.round(boxWidth)}:${Math.round(boxHeight)}`;
      if (!blockCache.has(key)) {
        if (blockCache.size > 60) blockCache.clear();
        const words = line.shown.map((word) => ({
          ...word,
          display: word.text.replace(/[.,!?;:"]/g, "").toUpperCase(),
          bleep: typeBleeped.test(word.text.toLowerCase().replace(/[^a-z']/g, "")),
        }));
        blockCache.set(key, { words, ...layout(words, boxWidth, boxHeight) });
      }
      return blockCache.get(key);
    }

    function setSong(model) {
      song = model;
      blockCache.clear();
      palette = (model && typePalettes[model.identifier]) || typeDefaultPalette;
      hookWords = palette.hook.length ? palette.hook : [model?.title?.toUpperCase() || ""];
      mainDrop = -1;
      inverted = null;
      songEnd = Infinity;
      if (!model) return;
      mainDrop = model.mainDrop;
      // A line is set when most of it was confirmed by two transcriptions; it shows only its
      // confirmed words.
      for (const line of model.lyrics.lines) {
        line.shown = line.words.filter((word) => word.votes > 0 || word.probability >= 0.85);
        line.confidence = line.shown.length / line.words.length;
      }
      // The song's end: the last moment anything sounds.
      const mix = model.series.mix;
      if (mix) {
        let index = mix.length - 1;
        while (index > 0 && mix[index] < 0.08) index--;
        songEnd = index / 100 + 0.3;
      }
    }

    // The sung line at `time`, if one is showing: its outline from just before its first
    // word until the next line starts, or 1.2 s after its last word.
    function lineAt(time) {
      const index = song.lineIndex(time + 0.12);
      if (index < 0) return null;
      const line = song.lyrics.lines[index];
      const next = song.lyrics.lines[index + 1];
      const until = Math.min(next ? next.start - 0.12 : Infinity, line.end + 1.2);
      // the first half second belongs to the hook (it is the thumbnail)
      if (time < 0.6 || time >= until || line.confidence < 0.7 || !line.shown.length) return null;
      return line;
    }

    // Text in ink above the ink block's edge and in field colour inside it; filled or outlined.
    function drawTextInverted(text, x, baseline, field, ink, edge, clipHeight, outline = 0) {
      const top = baseline - clipHeight;
      const paint = (color) => {
        if (outline > 0) {
          context.lineWidth = outline;
          context.strokeStyle = color;
          context.strokeText(text, x, baseline);
        } else {
          context.fillStyle = color;
          context.fillText(text, x, baseline);
        }
      };
      if (edge > top) {
        context.save();
        context.beginPath();
        context.rect(-10, top - 10, 1e5, Math.min(edge, baseline + clipHeight) - top + 10);
        context.clip();
        paint(ink);
        context.restore();
      }
      if (edge < baseline + clipHeight * 0.3) {
        context.save();
        context.beginPath();
        context.rect(-10, edge, 1e5, 1e5);
        context.clip();
        paint(field);
        context.restore();
      }
    }

    // A word (or a short phrase) as large as the box allows: condensed so it can be tall,
    // and split over two rows when that makes it larger.
    function drawBigWord(word, left, top, right, bottom, field, ink, edge, outline = 0) {
      const boxWidth = right - left,
        boxHeight = bottom - top;
      const fit = (text, rowsHeight) => {
        let best = { size: 0, stretch: "normal" };
        for (const stretch of ["expanded", "normal", "condensed", "extra-condensed"]) {
          const size = Math.min((100 * boxWidth) / textWidth(text, 900, 100, stretch), rowsHeight / 0.74);
          if (size > best.size + 0.5) best = { size, stretch };
        }
        return best;
      };
      const single = fit(word, boxHeight);
      const space = word.indexOf(" ");
      if (space > 0) {
        // two rows: split at the space nearest the middle
        let cut = space,
          middle = word.length / 2;
        for (let index = 0; index < word.length; index++) if (word[index] === " " && Math.abs(index - middle) < Math.abs(cut - middle)) cut = index;
        const rows = [word.slice(0, cut), word.slice(cut + 1)];
        const rowHeight = boxHeight / 2 - boxHeight * 0.02;
        const fits = rows.map((row) => fit(row, rowHeight));
        const size = Math.min(fits[0].size, fits[1].size);
        if (size > single.size * 1.15) {
          rows.forEach((row, index) => {
            setFont(context, 900, size, fits[index].stretch);
            const baseline = top + (index + 1) * (boxHeight / 2) - (boxHeight / 2 - size * 0.72) / 2;
            drawTextInverted(row, left, baseline, field, ink, edge, size, outline);
          });
          return size;
        }
      }
      setFont(context, 900, single.size, single.stretch);
      const baseline = (top + bottom) / 2 + single.size * 0.36;
      drawTextInverted(word, left, baseline, field, ink, edge, single.size, outline);
      return single.size;
    }

    function drawWall(time, width, top, bottom, text, rows, field, ink, edge) {
      const rowHeight = (bottom - top) / rows;
      const size = rowHeight / 0.78;
      const stretch = rows >= 5 ? "condensed" : "normal";
      const unit = `${text}  `;
      setFont(context, 900, size, stretch);
      const unitWidth = context.measureText(unit).width;
      // Rows step on kicks (even rows, leftward) and on snares (odd rows, rightward).
      const kicks = song.kicks.last(time) + 1;
      const snares = song.snares.last(time) + 1;
      const kickEase = easeOutCubic(song.kicks.since(time) / 0.09);
      const snareEase = easeOutCubic(song.snares.since(time) / 0.09);
      for (let row = 0; row < rows; row++) {
        const even = row % 2 === 0;
        const steps = even ? kicks - 1 + kickEase : snares - 1 + snareEase;
        let offset = (((steps * unitWidth) / 4) % unitWidth) * (even ? -1 : 1) - unitWidth * (row % 3) * 0.37;
        offset = ((offset % unitWidth) + unitWidth) % unitWidth - unitWidth;
        const baseline = top + rowHeight * (row + 1) - rowHeight * 0.13;
        drawTextInverted(unit.repeat(Math.ceil(width / unitWidth) + 2), offset, baseline, field, ink, edge, rowHeight);
      }
    }

    // The hook alone, filling the box; its width steps on every beat (condensed, normal,
    // expanded, normal), so the word breathes in the tempo.
    function drawBreathing(time, left, top, right, bottom, text, field, ink, edge) {
      const beat = Math.floor(song.beatPosition(time));
      const stretch = ["condensed", "normal", "expanded", "normal"][((beat % 4) + 4) % 4];
      const boxWidth = right - left;
      const size = Math.min((100 * boxWidth) / textWidth(text, 900, 100, stretch), (bottom - top) / 0.74);
      setFont(context, 900, size, stretch);
      const width = context.measureText(text).width;
      const baseline = (top + bottom) / 2 + size * 0.36;
      drawTextInverted(text, left + (boxWidth - width) / 2, baseline, field, ink, edge, size);
    }

    // The bar's four beats across the frame; the current one solid, the others outlined.
    function drawBeats(time, left, top, right, bottom, field, ink, edge) {
      const current = Math.min(3, Math.floor(fract(song.barPosition(time)) * 4));
      const cell = (right - left) / 4;
      const size = Math.min(cell / 0.62, (bottom - top) / 0.74);
      setFont(context, 900, size, "normal");
      context.textAlign = "center";
      const baseline = (top + bottom) / 2 + size * 0.36;
      for (let index = 0; index < 4; index++)
        drawTextInverted(String(index + 1), left + cell * (index + 0.5), baseline, field, ink, edge, size, index === current ? 0 : Math.max(3, size * 0.012));
      context.textAlign = "left";
    }

    // The chord, as its name: where the harmony leads.
    function drawChord(time, left, top, right, bottom, field, ink, edge) {
      const index = song.chordIndex(time);
      if (index < 0) return;
      const chord = song.chords[index];
      drawBigWord(typeChordNames[chord.root] + (chord.minor ? "m" : ""), left, top, right, bottom, field, ink, edge);
    }

    function render(time, frame) {
      const width = frame.width,
        height = frame.height;
      context.setTransform(scale, 0, 0, scale, 0, 0);
      if (!song) {
        context.fillStyle = palette.field;
        context.fillRect(0, 0, width, height);
        return;
      }
      const drop = song.dropContext(time);
      const afterMain = mainDrop >= 0 && time >= song.drops[mainDrop].time;
      const sinceDrop = drop.phase === 3 ? drop.since : Infinity;
      // the main drop holds its hit for a bar, the others for two beats
      const hitLength = song.beatPeriod * (drop.index === mainDrop ? 4 : 2);
      const inHit = sinceDrop < hitLength;
      const leadIn = song.anchor.kind === "lead_in" ? song.anchorAt(time) : -1;
      const inGap = drop.phase === 2 || leadIn >= 0;
      // Every drop swaps field and ink for its hit; the main drop swaps them for good.
      let field = palette.field,
        ink = palette.ink;
      const mainHit = inHit && drop.index === mainDrop;
      const swap = afterMain !== (inHit && !mainHit);
      if (swap) [field, ink] = [ink, field];
      // The page's title and controls follow the field and ink as they swap.
      if (swap !== inverted) {
        inverted = swap;
        document.documentElement.style.setProperty("--type-field", field);
        document.documentElement.style.setProperty("--type-ink", ink);
        waveformTheme = null;
      }
      const scene = song.scene(time);
      context.fillStyle = field;
      context.fillRect(0, 0, width, height);

      // Ink from the bottom: the bass note's height, or the build's flood rising up the
      // frame; the whole frame in the gap.
      let blockHeight = 0;
      {
        // the bass note's height, sampled as an envelope (fast attack, slow release) so a
        // busy bass line swells and settles instead of strobing
        let level = 0;
        for (let step = 0; step < 8; step++) {
          const at = time - step * 0.04;
          const note = song.bassNotes.active(at);
          if (note < 0) continue;
          const height = 0.05 + 0.13 * clamp01((song.bassNotes.pitch[note] - 26) / 24);
          level = Math.max(level, height * Math.exp(-step * 0.04 / 0.12));
        }
        blockHeight = level * height * clamp01(song.value("bass", time) * 1.6);
      }
      if (drop.phase === 1) blockHeight = Math.max(blockHeight, easeInCubic(drop.progress) * height * 0.82);
      if (inGap) blockHeight = height;
      if (inHit || time > songEnd) blockHeight = 0;
      const edge = height - blockHeight;
      context.fillStyle = ink;
      if (blockHeight > 0.5) context.fillRect(0, edge, width, blockHeight);

      const margin = Math.round(width * 0.034);
      // The title owns the top band; everything set here stays below it.
      const top = Math.max(height * 0.2, (frame.titleBottom || 0) + height * 0.035),
        bottom = height * 0.93;
      let anchor = song.anchor.kind === "word" ? song.anchorAt(time) : -1;
      const line = lineAt(time);
      const peak = song.peakAt(time);
      // A short key word inside a sung line stays in the line (set reversed there); a held
      // one, or one in a gap or a hit, takes the frame.
      if (anchor >= 0 && line && !inGap && !inHit) {
        const moment = song.anchor.moments[anchor];
        if (moment.end - moment.start < 0.45) anchor = -1;
      }

      if (time > songEnd) {
        // After the last sound: the hook, still, in outline.
        drawBigWord(hookWords[0], margin, top, width - margin, bottom, field, ink, edge, Math.max(3, height * 0.006));
      } else if (inGap && anchor >= 0) {
        // The key word sung into the gap: outlined in the flood, filled by the drop.
        drawBigWord(song.anchor.word.toUpperCase(), margin, top, width - margin, bottom, field, ink, edge, Math.max(3, height * 0.008));
      } else if (inGap) {
        // The gap: the flood and a countdown of the beats left before the drop.
        const end = drop.phase === 2 ? drop.drop.time : song.anchor.moments[leadIn].end;
        const beatsLeft = Math.max(1, Math.ceil((end - time) / song.beatPeriod - 1e-6));
        const size = (bottom - top) / 0.74;
        setFont(context, 900, size, "normal");
        context.textAlign = "center";
        drawTextInverted(String(beatsLeft), width / 2, bottom, field, ink, edge, size, Math.max(3, height * 0.012));
        context.textAlign = "left";
      } else if (inHit || anchor >= 0) {
        // The hit and the key word: one word as large as the frame allows.
        const word = anchor >= 0 ? song.anchor.word.toUpperCase() : hookWords[0];
        drawBigWord(word, margin, top, width - margin, bottom, field, ink, edge);
        if (anchor >= 0) {
          const countSize = Math.round(height * 0.05);
          context.font = `500 ${countSize}px "IBM Plex Mono", monospace`;
          context.fillStyle = ink;
          context.textAlign = "right";
          context.fillText(`${String(anchor + 1).padStart(2, "0")}/${String(song.anchor.moments.length).padStart(2, "0")}`, width - margin, top - countSize * 0.4);
          context.textAlign = "left";
        }
      } else if (line) {
        // A sung line: the whole poster in outline, each word filling in as it is sung.
        const block = blockFor(line, width - margin * 2, bottom - top);
        const offsetY = top + (bottom - top - block.height) / 2;
        const current = song.wordIndex(time);
        const outline = Math.max(2.5, height * 0.0048);
        block.words.forEach((word, index) => {
          const place = block.placed[index];
          const x = margin + place.x,
            baseline = offsetY + place.baseline;
          setFont(context, 900, place.size, place.stretch);
          const sung = time >= word.start;
          if (word.bleep) {
            const barTop = baseline - place.ascent;
            context.fillStyle = barTop < edge ? ink : field;
            if (sung) context.fillRect(x, barTop, place.width, place.ascent);
            else {
              context.lineWidth = outline;
              context.strokeStyle = barTop < edge ? ink : field;
              context.strokeRect(x, barTop, place.width, place.ascent);
            }
            return;
          }
          // the key word, when it is sung within a line, is set reversed out of an ink box
          const keyNow = word.key && sung && time < word.end + 0.15;
          if (keyNow) {
            const pad = place.size * 0.06;
            context.fillStyle = ink;
            context.fillRect(x - pad, baseline - place.ascent - pad, place.width + pad * 2, place.ascent + pad * 2);
            context.fillStyle = field;
            context.fillText(word.display, x, baseline);
            return;
          }
          drawTextInverted(word.display, x, baseline, field, ink, edge, place.size, sung ? 0 : outline);
          // the word being sung now carries a rule under it
          if (sung && word.index === current && time < word.end + 0.05) {
            const rule = Math.max(4, place.size * 0.06);
            context.fillStyle = baseline + rule * 1.5 < edge ? ink : field;
            context.fillRect(x, baseline + rule * 0.9, place.width, rule);
          }
        });
      } else {
        // Instrumental: a typographic mode per eight-bar phrase.
        const phrase = Math.max(0, Math.floor(song.barPosition(time) / 8));
        const text = hookWords[phrase % hookWords.length];
        const full = scene.kind === "drop" || scene.kind === "drive";
        let mode;
        if (peak && peak.kind === "chords") mode = "chords";
        else if (scene.kind === "intro" && phrase === 0) mode = "wall";
        else mode = ["wall", "breathing", "wall", "beats"][(phrase + scene.index) % 4];
        if (mode === "chords") drawChord(time, margin, top, width - margin, bottom, field, ink, edge);
        else if (mode === "breathing") drawBreathing(time, margin, top, width - margin, bottom, text, field, ink, edge);
        else if (mode === "beats") drawBeats(time, margin, top, width - margin, bottom, field, ink, edge);
        else drawWall(time, width, top, bottom, text, full ? 5 : 4, field, ink, edge);
      }

      // Kick → the beat counter: the beat of the bar on a tab of the field, solid for the
      // instant of a kick, outlined otherwise. Only while playing (the paused frame has the
      // controls there).
      if (frame.playing && !inGap && !inHit && time <= songEnd) {
        const beatNumber = Math.min(4, Math.floor(fract(song.barPosition(time)) * 4) + 1);
        const kickAge = song.kicks.since(time);
        const kicked = kickAge < 0.13;
        const size = height * 0.17;
        const tabWidth = size * 0.78,
          tabHeight = size * 0.92;
        const tabX = width - margin * 0.5 - tabWidth,
          tabY = height - margin * 0.4 - tabHeight;
        context.fillStyle = kicked ? ink : field;
        context.fillRect(tabX, tabY, tabWidth, tabHeight);
        setFont(context, 900, size, "normal");
        context.textAlign = "center";
        const baseline = tabY + tabHeight / 2 + size * 0.36;
        if (kicked) {
          context.fillStyle = field;
          context.fillText(String(beatNumber), tabX + tabWidth / 2, baseline);
        } else {
          context.lineWidth = Math.max(3, height * 0.005);
          context.strokeStyle = ink;
          context.strokeText(String(beatNumber), tabX + tabWidth / 2, baseline);
        }
        context.textAlign = "left";
      }
    }

    return {
      canvas,
      setSong,
      themeFor(model) {
        // The slot resets the page colours; the next frame sets them for its time again.
        inverted = null;
        const colors = (model && typePalettes[model.identifier]) || typeDefaultPalette;
        return { "--type-field": colors.field, "--type-ink": colors.ink };
      },
      setActive(on) {
        canvas.hidden = !on;
      },
      resize(width, height, ratio) {
        const [w, h, s] = canvasPixels(width, height, Math.min(ratio, 2), 2560 * 1440);
        canvas.width = w;
        canvas.height = h;
        scale = s;
        blockCache.clear();
      },
      render,
    };
  },
});
