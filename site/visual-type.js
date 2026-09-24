// Type: the sung words set as posters. Each sung line is laid out ahead of time as a block
// of justified rows in a heavy grotesque (nothing reflows); each word appears on the frame
// it is sung. Words the transcription could not confirm are set as redaction bars. Around
// the words, only typography: the kick is a beat counter, the bass is a block of ink rising
// from the bottom that inverts the type it covers, instrumental passages are a wall of the
// song's hook stepping on the kick and the snare, the gap before a drop counts down, and
// the drop slams the hook across the whole frame, inverted.

const typePalettes = {
  "5ff86d6cd02ebd7308e03df8": { field: "#2530f2", ink: "#f3efe4", hook: ["NBLY", "LIKE YOU", "NEVER", "LIKE YOU"] },
  "1d589940ca458d793a3fad8a": { field: "#e4261c", ink: "#16090a", hook: ["DESIRE", "IS IT LOVE", "DESIRE", "I WANT"] },
  f127a026dc751f1528bfb95d: { field: "#0b7556", ink: "#f7f0d8", hook: ["OPHELIA", "CAME FOR ME", "THE FATE OF", "OPHELIA"] },
  "8eee874c702a10807f79706c": { field: "#101010", ink: "#e5ff2f", hook: ["OUTSIDE", "FEELS LIKE", "OUTSIDE", "EVERYTHING RIGHT"] },
  "4048d4a6dce44c151690b2b1": { field: "#ff8db0", ink: "#1a1461", hook: ["AMERICAN BOY", "BOY", "LA LA LA", "BOY"] },
};
const typeDefaultPalette = { field: "#2530f2", ink: "#f3efe4", hook: [] };
const typeFamily = '"Archivo", "Arial Narrow", sans-serif';
const typeStretches = ["extra-condensed", "condensed", "semi-condensed", "normal", "semi-expanded", "expanded"];

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
    // fills the box without overflowing, with the least disparity between rows.
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
          largest = 0;
        const sized = rows.map((row) => {
          const text = row.map((index) => words[index].display).join(" ");
          const letters = text.length;
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
        const score = -Math.abs(0.86 - Math.min(fill, 1)) * 2 - overflow * 4 - (largest / smallest - 1) * 0.25 - rows.length * 0.05;
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
          const word = words[index];
          const width = textWidth(word.display, weight, size, row.stretch);
          placed[index] = { x, baseline: y, width, size, stretch: row.stretch, ascent };
          x += width + spaceWidth;
        }
        const rowWidth = x - spaceWidth;
        // justify: spread the leftover across the row's gaps (rows only shrink when too tall)
        if (row.indices.length > 1 && shrink === 1) {
          const extra = (boxWidth - rowWidth) / (row.indices.length - 1);
          row.indices.forEach((index, position) => (placed[index].x += extra * position));
        }
        y += size * 0.08;
      }
      return { placed, height: y };
    }

    function blockFor(line, boxWidth, boxHeight) {
      const key = `${line.number}:${Math.round(boxWidth)}:${Math.round(boxHeight)}`;
      if (!blockCache.has(key)) {
        if (blockCache.size > 60) blockCache.clear();
        const words = line.words.map((word) => ({
          ...word,
          display: word.text.replace(/[.,!?;:"]/g, "").toUpperCase(),
          sure: word.votes > 0 || word.probability >= 0.8,
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
      if (!model) return;
      mainDrop = model.mainDrop;
      // A line is sung text when most of it was confirmed by two transcriptions.
      for (const line of model.lyrics.lines) {
        const sure = line.words.filter((word) => word.votes > 0 || word.probability >= 0.8).length;
        line.confidence = sure / line.words.length;
      }
    }

    // The sung line at `time`, if one is showing: from its first word until the next line
    // starts, or 1.2 s after its last word.
    function lineAt(time) {
      const index = song.lineIndex(time);
      if (index < 0) return null;
      const line = song.lyrics.lines[index];
      const next = song.lyrics.lines[index + 1];
      const until = Math.min(next ? next.start : Infinity, line.end + 1.2);
      if (time >= until || line.confidence < 0.5) return null;
      return line;
    }

    function drawWall(time, width, top, bottom, text, rows, field, ink, bassEdge) {
      const rowHeight = (bottom - top) / rows;
      const size = rowHeight / 0.78;
      const stretch = rows >= 6 ? "condensed" : "normal";
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
        const stepSize = unitWidth / 4;
        let offset = ((steps * stepSize) % unitWidth) * (even ? -1 : 1) - unitWidth * (row % 3) * 0.37;
        offset = ((offset % unitWidth) + unitWidth) % unitWidth - unitWidth;
        const baseline = top + rowHeight * (row + 1) - rowHeight * 0.13;
        drawTextInverted(unit.repeat(Math.ceil(width / unitWidth) + 2), offset, baseline, field, ink, bassEdge, rowHeight);
      }
    }

    // Draw text in ink above the bass block's edge and in field colour inside it.
    function drawTextInverted(text, x, baseline, field, ink, edge, clipHeight) {
      const top = baseline - clipHeight;
      if (edge > top) {
        context.save();
        context.beginPath();
        context.rect(-10, top - 10, 1e5, Math.min(edge, baseline + clipHeight) - top + 10);
        context.clip();
        context.fillStyle = ink;
        context.fillText(text, x, baseline);
        context.restore();
      }
      if (edge < baseline + clipHeight * 0.3) {
        context.save();
        context.beginPath();
        context.rect(-10, edge, 1e5, 1e5);
        context.clip();
        context.fillStyle = field;
        context.fillText(text, x, baseline);
        context.restore();
      }
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
      const hitLength = song.beatPeriod * 2;
      const sinceDrop = drop.phase === 3 ? drop.since : Infinity;
      const inHit = sinceDrop < hitLength;
      // Palette: the song's field and ink; swapped from the main drop on, and for each hit.
      let field = palette.field,
        ink = palette.ink;
      // Every drop swaps field and ink for its hit; the main drop swaps them for good.
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

      // Build: the field is drawn toward the ink as the build gathers.
      let fieldColor = field;
      if (drop.phase === 1) fieldColor = cssColor(mixColor(hexColor(field), hexColor(ink), 0.35 * easeInCubic(drop.progress)));
      context.fillStyle = fieldColor;
      context.fillRect(0, 0, width, height);

      // Bass → a block of ink from the bottom, its height from the sounding note's pitch.
      const noteIndex = song.bassNotes.active(time);
      let blockHeight = 0;
      if (noteIndex >= 0) {
        const pitch = song.bassNotes.pitch[noteIndex];
        const age = time - song.bassNotes.start[noteIndex];
        const level = 0.1 + 0.26 * clamp01((pitch - 26) / 24);
        const previous = noteIndex > 0 && song.bassNotes.end[noteIndex - 1] > song.bassNotes.start[noteIndex] - 0.12
          ? 0.1 + 0.26 * clamp01((song.bassNotes.pitch[noteIndex - 1] - 26) / 24)
          : 0;
        blockHeight = mixValue(previous, level, easeOutCubic(age / 0.07)) * height * clamp01(song.value("bass", time) * 1.6);
      }
      if (drop.phase === 2 || inHit) blockHeight = 0;
      const edge = height - blockHeight;
      context.fillStyle = ink;
      if (blockHeight > 0.5) context.fillRect(0, edge, width, blockHeight);

      const margin = Math.round(width * 0.034);
      // The title owns the top band; everything set here stays below it.
      const top = height * 0.215,
        bottom = height * 0.93;
      const anchor = song.anchor.kind === "word" ? song.anchorAt(time) : -1;
      const line = lineAt(time);

      if (drop.phase === 2 && anchor >= 0) {
        // The key word sung into the gap: drawn in outline, filled by the drop.
        const word = song.anchor.word.toUpperCase();
        const natural = textWidth(word, 900, 100, "expanded");
        const size = Math.min((100 * (width - margin * 2)) / natural, (bottom - top) / 0.74);
        setFont(context, 900, size, "expanded");
        context.lineWidth = Math.max(3, height * 0.008);
        context.strokeStyle = ink;
        context.strokeText(word, margin, (top + bottom) / 2 + size * 0.36);
      } else if (drop.phase === 2) {
        // The gap: the field alone and a countdown of the beats left before the drop.
        const beatsLeft = Math.ceil((drop.drop.time - time) / song.beatPeriod - 1e-6);
        const size = (bottom - top) / 0.74;
        setFont(context, 900, size, "normal");
        context.textAlign = "center";
        context.lineWidth = Math.max(3, height * 0.012);
        context.strokeStyle = ink;
        context.strokeText(String(Math.max(1, beatsLeft)), width / 2, bottom);
        context.textAlign = "left";
      } else if (inHit || anchor >= 0) {
        // The hit and the key word: one word across the whole frame.
        const word = anchor >= 0 ? song.anchor.word.toUpperCase() : hookWords[0];
        const natural = textWidth(word, 900, 100, "expanded");
        const size = Math.min((100 * (width - margin * 2)) / natural, (bottom - top) / 0.74);
        setFont(context, 900, size, "expanded");
        const baseline = (top + bottom) / 2 + size * 0.36;
        drawTextInverted(word, margin, baseline, field, ink, edge, size);
        if (anchor >= 0) {
          context.fillStyle = ink;
          setFont(context, 500, Math.round(height * 0.028), "normal");
          context.font = `500 ${Math.round(height * 0.028)}px "IBM Plex Mono", monospace`;
          const count = `${String(anchor + 1).padStart(2, "0")} / ${String(song.anchor.moments.length).padStart(2, "0")}`;
          context.textAlign = "right";
          context.fillText(count, width - margin, height * 0.12);
          context.textAlign = "left";
        }
      } else if (line) {
        // A sung line: its block, words appearing as they are sung.
        const block = blockFor(line, width - margin * 2, bottom - top);
        const offsetY = top + (bottom - top - block.height) / 2;
        const current = song.wordIndex(time);
        block.words.forEach((word, index) => {
          if (time < word.start) return;
          const place = block.placed[index];
          const x = margin + place.x,
            baseline = offsetY + place.baseline;
          const sung = word.index < current;
          if (!word.sure) {
            // Redaction bar: the rhythm of the word without guessing at it.
            context.fillStyle = sung ? cssColor(hexColor(ink), 0.55) : ink;
            const barTop = baseline - place.ascent;
            if (barTop < edge) context.fillRect(x, barTop, place.width, Math.min(place.ascent, edge - barTop));
            if (baseline > edge) {
              context.fillStyle = field;
              context.fillRect(x, Math.max(edge, barTop), place.width, baseline - Math.max(edge, barTop));
            }
            return;
          }
          setFont(context, 900, place.size, place.stretch);
          context.globalAlpha = sung ? 0.55 : 1;
          drawTextInverted(word.display, x, baseline, field, ink, edge, place.size);
          context.globalAlpha = 1;
        });
      } else {
        // Instrumental: the hook as a wall, rows stepping on the kick and the snare.
        const phrase = Math.max(0, Math.floor(song.barPosition(time) / 8));
        const text = hookWords[((phrase % hookWords.length) + hookWords.length) % hookWords.length];
        const full = scene.kind === "drop" || scene.kind === "drive";
        drawWall(time, width, top, bottom, text, full ? 5 : 4, field, ink, edge);
      }

      // Kick → the beat counter: the beat of the bar, bold on a kick, outlined without one.
      if (drop.phase !== 2 && !inHit) {
        const beatNumber = Math.min(4, Math.floor(fract(song.barPosition(time)) * 4) + 1);
        const kickAge = song.kicks.since(time);
        const kicked = kickAge < song.beatPeriod * 0.9;
        const counterSize = height * 0.16;
        setFont(context, 900, counterSize, "normal");
        const x = width - margin - counterSize * 0.55,
          baseline = height - margin * 0.6;
        const punch = 1 + 0.18 * hitDecay(kickAge, 0.06);
        context.save();
        context.translate(x + counterSize * 0.28, baseline - counterSize * 0.36);
        context.scale(punch, punch);
        context.translate(-(x + counterSize * 0.28), -(baseline - counterSize * 0.36));
        const colorHere = baseline - counterSize * 0.4 > edge ? field : ink;
        if (kicked) {
          context.fillStyle = colorHere;
          context.fillText(String(beatNumber), x, baseline);
        } else {
          context.lineWidth = Math.max(2, height * 0.004);
          context.strokeStyle = colorHere;
          context.strokeText(String(beatNumber), x, baseline);
        }
        context.restore();
      }
    }

    return {
      canvas,
      setSong,
      themeFor(model) {
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
