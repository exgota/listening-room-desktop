// Type: the sung words set as posters. Each sung line is laid out ahead of time as a block
// of rows in a heavy grotesque and shown whole as a pale tint just before it is sung; each
// word fills in solid on the frame it is sung, so the poster assembles itself in the
// singer's rhythm. Only words that two transcriptions agree on are set. Around the words,
// only typography: the kick is a beat counter in the top corner; the bass is a block of ink
// rising from the bottom that inverts the rows it covers; a build floods the ink up the frame
// and counts its bars down; the gap before a drop counts its beats down; the drop slams the
// song's word across the whole frame, the largest type the song ever shows. The key word is
// reversed out of its line and numbered in the corner. The song is planned once as a
// timeline, so a passage keeps its treatment: instrumental stretches take one typographic
// mode per eight bars, in turn by section (an intro counts its bars until the voice comes
// in; then the hook as a wall stepping on kick and snare, the hook spelled a letter a beat,
// the hook breathing bar by bar, the chord names where the harmony leads, and after the
// song's turn a stack that grows bar by bar). The drop's word is kept for the drops.

const typePalettes = {
  "5ff86d6cd02ebd7308e03df8": { field: "#2530f2", ink: "#f3efe4", hook: ["NBLY", "LIKE YOU", "NEVER", "LIKE YOU"] },
  "1d589940ca458d793a3fad8a": { field: "#e4261c", ink: "#16090a", hook: ["DESIRE", "IS IT LOVE", "DESIRE", "I WANT"], split: ["DE", "SIRE"] },
  f127a026dc751f1528bfb95d: { field: "#0b7556", ink: "#f7f0d8", hook: ["OPHELIA", "CAME FOR ME", "THE FATE OF", "OPHELIA"], split: ["OPHE", "LIA"] },
  "8eee874c702a10807f79706c": { field: "#101010", ink: "#e5ff2f", hook: ["OUTSIDE", "FEELS LIKE", "OUTSIDE", "EVERYTHING RIGHT"], split: ["OUT", "SIDE"] },
  "4048d4a6dce44c151690b2b1": { field: "#ff8db0", ink: "#1a1461", hook: ["BOY", "AMERICAN BOY", "LA LA LA", "AMERICAN"] },
};
const typeDefaultPalette = { field: "#2530f2", ink: "#f3efe4", hook: [] };
const typeFamily = '"Archivo", "Arial Narrow", sans-serif';
const typeSharps = ["C", "C♯", "D", "D♯", "E", "F", "F♯", "G", "G♯", "A", "A♯", "B"];
const typeFlats = ["C", "D♭", "D", "E♭", "E", "F", "G♭", "G", "A♭", "A", "B♭", "B"];
// Posters are made for the feed: a swear word keeps its first letter and loses the rest.
const typeBleeped = /^(fuck\w*|motherfuck\w*|shit\w*|bitch\w*|nigg\w*)$/;
const typeTint = 0.36; // an unsung word: the ink at this strength

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
    let themeKey = "";
    let songEnd = Infinity;
    let chordNames = typeSharps;
    let timeline = [];
    let timelineStarts = new Float64Array(0);
    const blockCache = new Map();
    let hitCache = { key: "", size: 0 };
    let tint = typeTint; // an unsung word's strength: more where field and ink are close in value
    let thumbnailEnd = 0.6; // the song's word holds the first frames (to the first downbeat when a count follows)

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
    // one or two letters. No row is set larger than `rowCap` of the box (the drop's word is
    // the only type allowed to be bigger).
    function layout(words, boxWidth, boxHeight, rowCap, weight = 900) {
      const count = words.length;
      let best = null;
      const splits = 1 << Math.max(0, Math.min(count, 12) - 1);
      for (let mask = 0; mask < splits; mask++) {
        const rows = [];
        let current = [0];
        for (let index = 1; index < count; index++) {
          if (index < 12 && mask & (1 << (index - 1))) {
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
          size = Math.min(size, boxHeight * rowCap);
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
      const rowBands = [];
      let y = 0;
      for (const row of best.rows) {
        const size = row.size * shrink;
        const ascent = size * 0.72;
        const rowTop = y;
        y += ascent;
        let x = 0;
        const spaceWidth = textWidth(" ", weight, size, row.stretch);
        for (const index of row.indices) {
          const width = textWidth(words[index].display, weight, size, row.stretch);
          placed[index] = { x, baseline: y, width, size, stretch: row.stretch, ascent };
          x += width + spaceWidth;
        }
        const rowWidth = x - spaceWidth;
        // justify only a small shortfall; a big one would open holes, so the row sits left
        const extra = boxWidth - rowWidth;
        if (row.indices.length > 1 && extra > 0 && extra < boxWidth * 0.05)
          row.indices.forEach((index, position) => (placed[index].x += (extra / (row.indices.length - 1)) * position));
        rowBands.push({ top: rowTop - size * 0.04, bottom: y + size * 0.1 });
        y += size * 0.08;
      }
      return { placed, height: y, rowBands };
    }

    function blockFor(line, boxWidth, boxHeight, rowCap) {
      const key = `${line.number}:${Math.round(boxWidth)}:${Math.round(boxHeight)}:${rowCap}`;
      if (!blockCache.has(key)) {
        if (blockCache.size > 60) blockCache.clear();
        const words = line.shown.map((word) => {
          const clean = word.text.replace(/[.,!?;:"]/g, "").replace(/^-+/, "").toUpperCase();
          const bleep = typeBleeped.test(word.text.toLowerCase().replace(/[^a-z']/g, ""));
          return { ...word, display: bleep ? clean[0] + "*".repeat(Math.max(2, clean.length - 1)) : clean };
        }).filter((word) => word.display.length);
        blockCache.set(key, { words, ...layout(words, boxWidth, boxHeight, rowCap) });
      }
      return blockCache.get(key);
    }

    // The key the chords live in, to spell them: the major key whose scale holds the most
    // chord time; flats for the flat keys.
    function spelling(model) {
      const major = [0, 5, 7],
        minor = [2, 4, 9];
      let best = 0,
        bestScore = -1;
      for (let key = 0; key < 12; key++) {
        let score = 0;
        for (const chord of model.chords) {
          const degree = (chord.root - key + 12) % 12;
          if ((chord.minor ? minor : major).includes(degree)) score += chord.end - chord.start;
        }
        if (score > bestScore) {
          bestScore = score;
          best = key;
        }
      }
      return [1, 3, 5, 8, 10].includes(best) ? typeFlats : typeSharps;
    }

    // The plan: the song as a list of states, each a sung line or an instrumental mode.
    // Gaps and hits are decided per frame and take precedence.
    function plan(model) {
      const hitLength = (index) => model.beatPeriod * (index === model.mainDrop ? 4 : 2);
      // Around each drop: no line may start from 0.3 s before it (or its gap) until its hit
      // ends, and a running line is cut where the gap (or the drop) begins.
      const reserved = model.drops.map((drop, index) => ({
        from: Math.min(drop.gapStart, drop.time - 0.3),
        cut: drop.gapStart < drop.time - 0.01 ? drop.gapStart : drop.time,
        end: drop.time + hitLength(index),
      }));
      if (model.anchor.kind === "lead_in")
        for (const moment of model.anchor.moments) reserved.push({ from: moment.start - 0.3, cut: moment.start, end: moment.end });
      // In a chord passage the chords win over the words.
      const passages = model.peaks.filter((peak) => peak.kind === "chords").map((peak) => ({ from: peak.start, cut: peak.start, end: peak.end }));
      // Sung lines: those with at least half their words (or two words) confirmed, from just
      // before their first confirmed word; each holds through a pause under four seconds.
      const lines = [];
      for (const line of model.lyrics.lines) {
        line.shown = line.words.filter((word) => word.votes > 0 || word.probability >= 0.85);
        // a line is set when half of it is confirmed (a two-word fragment of a long line is not)
        if (line.shown.length < line.words.length && line.shown.length < Math.max(2, Math.ceil(line.words.length * 0.5))) continue;
        // nothing is set inside the thumbnail's first 0.6 s, so an opening line cannot blink
        lines.push({ line, start: Math.max(0.6, line.shown[0].start - 0.35), sungEnd: line.shown[line.shown.length - 1].end });
      }
      // a one-word interjection joins the line before it when that has just ended
      for (let index = 1; index < lines.length; index++) {
        const before = lines[index - 1],
          entry = lines[index];
        if (entry.line.shown.length === 1 && entry.start - before.sungEnd < 1.5 && before.line.shown.length < 12) {
          const merged = { number: `${before.line.number}+${entry.line.number}`, words: before.line.words.concat(entry.line.words), shown: before.line.shown.concat(entry.line.shown) };
          lines.splice(index - 1, 2, { line: merged, start: before.start, sungEnd: entry.sungEnd });
          index--;
        }
      }
      // a line that would show for under a second is set together with the next one
      for (let index = 0; index + 1 < lines.length; index++) {
        const entry = lines[index],
          next = lines[index + 1];
        if (next.start - entry.start < 1.0 && entry.line.shown.length + next.line.shown.length <= 12) {
          const merged = { number: `${entry.line.number}+${next.line.number}`, words: entry.line.words.concat(next.line.words), shown: entry.line.shown.concat(next.line.shown) };
          lines.splice(index, 2, { line: merged, start: entry.start, sungEnd: next.sungEnd });
          index--;
        }
      }
      const states = [];
      lines.forEach((entry, index) => {
        const next = lines[index + 1];
        let end = entry.sungEnd + 1.2;
        if (next) end = next.start - entry.sungEnd < 4 ? next.start : Math.min(end, next.start);
        let start = entry.start;
        for (const window of reserved.concat(passages)) {
          if (start >= window.from && start < window.end) start = window.end;
          if (start < window.cut && end > window.cut) end = window.cut;
        }
        // a line keeps one size throughout: a breakdown line if it begins in a breakdown
        // a line needs half a second of singing left after it appears, and must not be cut
        // before its first word
        const firstWord = entry.line.shown[0].start;
        if (end - start > 0.3 && entry.sungEnd > start + 0.5 && end > firstWord + 0.2)
          states.push({ start, end, kind: "line", line: entry.line, breakdown: model.scene(entry.start + 0.36).kind === "break" });
      });
      // Instrumental stretches: whatever the lines and drops leave, cut at eight-bar lines and
      // at the chord passages, each piece given a mode by its section. A stretch under two
      // bars after a line is the line held; after a hit, the drop's word held.
      const occupied = states.map((state) => ({ start: state.start, end: state.end, state })).concat(reserved.map((window) => ({ start: window.cut, end: window.end, hit: true })));
      occupied.sort((a, b) => a.start - b.start);
      const free = [];
      let cursor = 0,
        previous = null;
      for (const interval of occupied) {
        if (interval.start > cursor + 0.05) free.push({ start: cursor, end: interval.start, previous });
        if (interval.end >= cursor) previous = interval;
        cursor = Math.max(cursor, interval.end);
      }
      if (cursor < model.duration) free.push({ start: cursor, end: model.duration, previous });
      const firstLine = states.length ? states[0].start : model.duration;
      // the modes' words: the hook without the drop's word, which is kept for the drops
      const modeWords = hookWords.length > 1 ? hookWords.slice(1) : hookWords;
      let lastMode = "";
      let block = 0,
        turn = 0,
        lateSeen = false;
      for (const stretch of free) {
        if (stretch.previous && stretch.end - stretch.start < 2 * model.barPeriod) {
          if (stretch.previous.state) stretch.previous.state.end = stretch.end;
          else states.push({ start: stretch.start, end: stretch.end, kind: "mode", mode: "word", text: hookWords[0], from: stretch.start });
          continue;
        }
        const cuts = [stretch.start];
        for (let bar = model.barIndex(stretch.start) + 1; model.barTime(bar) < stretch.end - model.barPeriod; bar++)
          if (bar % 8 === 0) cuts.push(model.barTime(bar));
        for (const peak of model.peaks)
          if (peak.kind === "chords")
            for (const edge of [peak.start, peak.end]) if (edge > stretch.start + 0.5 && edge < stretch.end - 0.5) cuts.push(edge);
        cuts.sort((a, b) => a - b);
        // no piece under two bars: a short one joins its neighbour (a chord passage stays whole)
        const pieces = [];
        cuts.forEach((start, index) => {
          const piece = { start, end: index + 1 < cuts.length ? cuts[index + 1] : stretch.end };
          const last = pieces[pieces.length - 1];
          const chordEdge = model.peaks.some((peak) => peak.kind === "chords" && Math.abs(peak.start - start) < 0.01);
          if (last && chordEdge && last.end - last.start < 2 * model.barPeriod) last.end = piece.end; // the chords start early
          else if (last && !chordEdge && (last.end - last.start < 2 * model.barPeriod || piece.end - piece.start < 2 * model.barPeriod)) last.end = piece.end;
          else pieces.push(piece);
        });
        for (const piece of pieces) {
          const at = piece.start + 0.01;
          const scene = model.scene(at);
          const peak = model.peakAt(piece.start + (piece.end - piece.start) / 2);
          // each section's modes, taken in turn through the song (never one twice running)
          let modes;
          if (peak && peak.kind === "chords") modes = ["chords"];
          else if (piece.start < firstLine && scene.index <= 1) modes = ["count"];
          else if (scene.kind === "build") modes = ["buildcount"];
          else if (scene.kind === "break") modes = ["breathing", "letters"];
          else if (at >= model.lateStart) {
            modes = ["stack", "letters", "wall"];
            // the late look opens on its own mode, the stack
            if (!lateSeen) [lateSeen, turn] = [true, 0];
          } else modes = ["wall", "letters", "breathing"];
          let mode = modes[turn % modes.length];
          if (mode === lastMode && modes.length > 1) mode = modes[++turn % modes.length];
          if (modes.length > 1) turn++;
          states.push({ start: piece.start, end: piece.end, kind: "mode", mode, text: modeWords[block % modeWords.length], from: piece.start });
          lastMode = mode;
          block++;
        }
      }
      states.sort((a, b) => a.start - b.start);
      return states;
    }

    function setSong(model) {
      song = model;
      blockCache.clear();
      hitCache = { key: "", size: 0 };
      palette = (model && typePalettes[model.identifier]) || typeDefaultPalette;
      hookWords = palette.hook.length ? palette.hook : [model?.title?.toUpperCase() || ""];
      mainDrop = -1;
      themeKey = "";
      songEnd = Infinity;
      timeline = [];
      timelineStarts = new Float64Array(0);
      if (!model) return;
      mainDrop = model.mainDrop;
      chordNames = spelling(model);
      const luminance = (hex) => {
        const channel = (value) => (value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
        const [r, g, b] = hexColor(hex).map(channel);
        return 0.2126 * r + 0.7152 * g + 0.0722 * b;
      };
      const [light, dark] = [luminance(palette.field), luminance(palette.ink)].sort((a, b) => b - a);
      tint = (light + 0.05) / (dark + 0.05) < 8 ? 0.6 : typeTint;
      // The song's end: the last moment anything sounds, or a bar before the file ends when
      // the mix never falls silent.
      const mix = model.series.mix;
      if (mix) {
        let index = mix.length - 1;
        while (index > 0 && mix[index] < 0.08) index--;
        songEnd = index / 100 + 0.3;
        if (songEnd > model.duration - 0.5) songEnd = model.duration - model.barPeriod;
      }
      timeline = plan(model);
      timelineStarts = Float64Array.from(timeline.map((state) => state.start));
      thumbnailEnd = 0.6;
      const opening = timeline.find((state) => state.end > 0.6);
      const firstBar = model.downbeats.find((time) => time > 0.05);
      if (opening && opening.kind === "mode" && opening.mode === "count" && firstBar > 0.6 && firstBar < 4) thumbnailEnd = firstBar;
    }

    function stateAt(time) {
      const index = lastIndexAtOrBefore(timelineStarts, time);
      if (index < 0) return null;
      const state = timeline[index];
      return time < state.end ? state : null;
    }

    // Text in ink above the ink block's edge and in field colour inside it; solid or a tint.
    function drawTextInverted(text, x, baseline, field, ink, edge, clipHeight, alpha = 1) {
      const top = baseline - clipHeight;
      context.globalAlpha = alpha;
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
      context.globalAlpha = 1;
    }

    // The size a word (or short phrase) takes when it fills the box: condensed so it can be
    // tall, over two rows when that makes it larger.
    function bigWordFit(word, boxWidth, boxHeight) {
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
        let cut = space;
        const middle = word.length / 2;
        for (let index = 0; index < word.length; index++) if (word[index] === " " && Math.abs(index - middle) < Math.abs(cut - middle)) cut = index;
        const rows = [word.slice(0, cut), word.slice(cut + 1)];
        const fits = rows.map((row) => fit(row, boxHeight / 2 - boxHeight * 0.02));
        const size = Math.min(fits[0].size, fits[1].size);
        if (size > single.size * 1.15) return { size, rows: rows.map((row, index) => ({ text: row, stretch: fits[index].stretch })) };
      }
      return { size: single.size, rows: [{ text: word, stretch: single.stretch }] };
    }

    // Draw a big word no larger than `maximum`, centred in the box.
    function drawBigWord(word, left, top, right, bottom, field, ink, edge, maximum = Infinity, alpha = 1) {
      const fitted = bigWordFit(word, right - left, bottom - top);
      const size = Math.min(fitted.size, maximum);
      const rowPitch = fitted.rows.length > 1 ? (bottom - top) / 2 : 0;
      fitted.rows.forEach((row, index) => {
        setFont(context, 900, size, row.stretch);
        const width = context.measureText(row.text).width;
        const baseline = fitted.rows.length > 1 ? top + (index + 1) * rowPitch - (rowPitch - size * 0.72) / 2 : (top + bottom) / 2 + size * 0.36;
        drawTextInverted(row.text, left + (right - left - width) / 2, baseline, field, ink, edge, size, alpha);
      });
      return size;
    }

    function drawWall(time, width, top, bottom, text, field, ink, edge) {
      const rows = 4;
      const rowHeight = (bottom - top) / rows;
      const size = rowHeight / 0.78;
      const unit = `${text}  `;
      setFont(context, 900, size, "normal");
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
        drawTextInverted(unit.repeat(Math.ceil(width / unitWidth) + 2), offset, baseline, field, ink, edge, rowHeight, row % 2 ? tint + 0.2 : 1);
      }
    }

    // The hook alone, its width stepping once a bar (condensed, normal, expanded, normal).
    function drawBreathing(time, left, top, right, bottom, text, field, ink, edge, maximum) {
      const bar = Math.max(0, song.barIndex(time));
      const stretch = ["condensed", "normal", "expanded", "normal"][bar % 4];
      const boxWidth = right - left;
      const fitted = bigWordFit(text, boxWidth, bottom - top);
      if (fitted.rows.length > 1) return drawBigWord(text, left, top, right, bottom, field, ink, edge, maximum);
      const size = Math.min((100 * boxWidth) / textWidth(text, 900, 100, stretch), (bottom - top) / 0.74, maximum);
      setFont(context, 900, size, stretch);
      const width = context.measureText(text).width;
      drawTextInverted(text, left + (boxWidth - width) / 2, (top + bottom) / 2 + size * 0.36, field, ink, edge, size);
    }

    // After the turn: the hook stacked from the bottom, a row more each bar (the newest solid,
    // the rows under it tints), until four rows stand; each row the next of the hook's words.
    function drawStack(time, state, left, top, right, bottom, field, ink, edge) {
      const bars = Math.max(0, song.barIndex(time) - song.barIndex(state.from + 0.01));
      const rows = 1 + Math.min(3, bars);
      const rowHeight = (bottom - top) / 4;
      const words = hookWords.length > 1 ? hookWords.slice(1) : hookWords;
      const first = Math.max(0, words.indexOf(state.text));
      for (let row = 0; row < rows; row++) {
        const text = words[(first + row) % words.length];
        const size = Math.min(rowHeight / 0.76, (100 * (right - left)) / textWidth(text, 900, 100, "condensed"));
        setFont(context, 900, size, "condensed");
        const width = context.measureText(text).width;
        const baseline = bottom - rowHeight * row - (rowHeight - size * 0.72) / 2;
        drawTextInverted(text, left + (right - left - width) / 2, baseline, field, ink, edge, size, row === rows - 1 ? 1 : tint + 0.15);
      }
    }

    // The hook spelled on the beat: a letter more each beat, the waiting letters as tints; the
    // whole word holds for one beat, then it starts again.
    function drawLetters(time, state, left, top, right, bottom, field, ink, edge, maximum) {
      const text = state.text;
      const count = text.replace(/ /g, "").length;
      const beats = Math.max(0, song.beatIndex(time) - song.beatIndex(state.from + 0.01));
      const shown = (beats % (count + 1)) + 1;
      const fitted = bigWordFit(text, right - left, bottom - top);
      const size = Math.min(fitted.size, maximum);
      const rowPitch = fitted.rows.length > 1 ? (bottom - top) / 2 : 0;
      let letter = 0;
      fitted.rows.forEach((row, index) => {
        setFont(context, 900, size, row.stretch);
        const width = context.measureText(row.text).width;
        const x0 = left + (right - left - width) / 2;
        const baseline = fitted.rows.length > 1 ? top + (index + 1) * rowPitch - (rowPitch - size * 0.72) / 2 : (top + bottom) / 2 + size * 0.36;
        for (let position = 0; position < row.text.length; position++) {
          const glyph = row.text[position];
          if (glyph === " ") continue;
          const x = x0 + context.measureText(row.text.slice(0, position)).width;
          drawTextInverted(glyph, x, baseline, field, ink, edge, size, letter < shown ? 1 : tint);
          letter++;
        }
      });
    }

    // Beats before a drop: a row of full stops, one fewer each beat (numerals are for bars, so
    // the countdown never goes up again when the bars give way to beats).
    function drawPips(count, left, top, right, bottom, field, ink, edge, maximum) {
      const radius = Math.min(maximum * 0.3, (bottom - top) * 0.2, (right - left) / (Math.max(3, count) * 3.2));
      const spacing = radius * 3.2;
      const y = (top + bottom) / 2;
      let x = (left + right) / 2 - ((count - 1) * spacing) / 2;
      for (let index = 0; index < count; index++, x += spacing) {
        context.fillStyle = y - radius > edge ? field : ink;
        context.beginPath();
        context.arc(x, y, radius, 0, Math.PI * 2);
        context.fill();
      }
    }

    // A flat or sharp sign drawn in the face's weight (the font has neither), as tall as the
    // capital, its top at the capital's top.
    function drawAccidental(kind, x, baseline, size, field, ink, edge) {
      const cap = size * 0.72,
        stroke = size * 0.1,
        top = baseline - cap;
      context.save();
      context.beginPath();
      if (kind === "flat") {
        // a stem and an open bowl on its lower half
        const width = size * 0.34;
        context.rect(x, top, stroke, cap);
        context.moveTo(x + stroke, baseline);
        context.lineTo(x + stroke, baseline - cap * 0.5);
        context.bezierCurveTo(x + width * 1.25, baseline - cap * 0.66, x + width * 1.2, baseline - cap * 0.12, x + stroke, baseline);
        context.closePath();
        context.moveTo(x + stroke, baseline - stroke * 0.9);
        context.lineTo(x + stroke, baseline - cap * 0.5 + stroke * 1.3);
        context.bezierCurveTo(x + width * 0.9, baseline - cap * 0.52, x + width * 0.82, baseline - cap * 0.2, x + stroke, baseline - stroke * 0.9);
        context.closePath();
      } else {
        // two uprights and two rising bars
        const width = size * 0.42;
        context.rect(x + width * 0.22, top, stroke * 0.8, cap);
        context.rect(x + width * 0.62, top - cap * 0.04, stroke * 0.8, cap);
        for (const level of [0.36, 0.68]) {
          const y = top + cap * level;
          context.moveTo(x, y + stroke * 0.5);
          context.lineTo(x + width, y - stroke * 0.3);
          context.lineTo(x + width, y - stroke * 1.3);
          context.lineTo(x, y - stroke * 0.5);
          context.closePath();
        }
      }
      context.clip(kind === "flat" ? "evenodd" : "nonzero");
      context.fillStyle = ink;
      context.fillRect(x - size, top - size, size * 3, Math.max(0, Math.min(edge, baseline + size) - (top - size)));
      context.fillStyle = field;
      if (edge < baseline + size) context.fillRect(x - size, Math.max(edge, top - size), size * 3, baseline + size - Math.max(edge, top - size));
      context.restore();
      return kind === "flat" ? size * 0.36 : size * 0.44;
    }

    // A chord's name: the root letter, its accidental as a drawn sign, then "m" for minor.
    function drawChord(chord, left, top, right, bottom, field, ink, edge, maximum) {
      const name = chordNames[chord.root];
      const letter = name[0],
        accidental = name.length > 1 ? (name[1] === "♭" ? "flat" : "sharp") : "",
        suffix = chord.minor ? "m" : "";
      const measureAt = (size) => {
        setFont(context, 900, size, "normal");
        const main = context.measureText(letter).width + (suffix ? context.measureText(suffix).width : 0);
        return main + (accidental ? (accidental === "flat" ? 0.36 : 0.44) * size + size * 0.06 : 0);
      };
      const size = Math.min(maximum, (bottom - top) / 0.74, (100 * (right - left)) / measureAt(100));
      const total = measureAt(size);
      let x = left + (right - left - total) / 2;
      const baseline = (top + bottom) / 2 + size * 0.36;
      setFont(context, 900, size, "normal");
      drawTextInverted(letter, x, baseline, field, ink, edge, size);
      x += context.measureText(letter).width + size * 0.03;
      if (accidental) x += drawAccidental(accidental, x, baseline, size, field, ink, edge) + size * 0.03;
      if (suffix) {
        setFont(context, 900, size, "normal");
        drawTextInverted(suffix, x, baseline, field, ink, edge, size);
      }
    }

    // A number as large as allowed: bars to the voice, bars or beats to the drop.
    function drawCount(value, left, top, right, bottom, field, ink, edge, maximum, alpha = 1) {
      const text = String(value);
      const size = Math.min((bottom - top) / 0.74, ((right - left) / Math.max(1, text.length)) / 0.62, maximum);
      setFont(context, 900, size, "normal");
      context.textAlign = "center";
      drawTextInverted(text, (left + right) / 2, (top + bottom) / 2 + size * 0.36, field, ink, edge, size, alpha);
      context.textAlign = "left";
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
      const late = time >= song.lateStart;
      const sinceDrop = drop.phase === 3 ? drop.since : Infinity;
      // the main drop holds its hit for a bar, the others for two beats
      const hitLength = song.beatPeriod * (drop.index === mainDrop ? 4 : 2);
      const inHit = sinceDrop < hitLength;
      const mainHit = inHit && drop.index === mainDrop;
      const leadIn = song.anchor.kind === "lead_in" ? song.anchorAt(time) : -1;
      const inGap = drop.phase === 2 || leadIn >= 0;
      const scene = song.scene(time);
      // the first half second belongs to the song's word (it is the thumbnail)
      const state = time < thumbnailEnd ? null : stateAt(time);
      // Every drop swaps field and ink for its hit; the song's turn (its main drop, or its last
      // third when that drop comes early) swaps them for good.
      let field = palette.field,
        ink = palette.ink;
      const swap = late && !(mainHit && Math.abs(song.lateStart - song.drops[mainDrop].time) < 0.1);
      if (swap) [field, ink] = [ink, field];
      context.fillStyle = field;
      context.fillRect(0, 0, width, height);

      const margin = Math.round(width * 0.034);
      // The title owns the top band; everything set here stays below it (and above the
      // controls while paused).
      const top = Math.max(height * 0.2, (frame.titleBottom || 0) + height * 0.035),
        bottom = frame.playing === false ? height * 0.8 : height * 0.93;
      const breakdown = Boolean(state && state.kind === "line" && state.breakdown);
      const boxTop = top;
      const boxWidth = width - margin * 2;
      // The line on show, laid out, so the ink's edge can stop between its rows.
      const block = state && state.kind === "line" && !inGap && !inHit ? blockFor(state.line, boxWidth, bottom - boxTop, breakdown ? 0.34 : 0.5) : null;
      const offsetY = block ? boxTop + (bottom - boxTop - block.height) / 2 : 0;

      // The drop's word: the largest type the song shows. Everything else is held to 60 % of it.
      const hitWord = hookWords[0];
      const hitKey = `${width}x${height}:${top}:${bottom}`;
      // (a secondary drop's word; the main drop's is larger still)
      if (hitCache.key !== hitKey) hitCache = { key: hitKey, size: bigWordFit(hitWord, boxWidth, bottom - top).size * 0.82 };
      const cap = hitCache.size * 0.6;
      // numerals, the intro's and a build's alike: as tall as the box allows, under the drop's word
      const numeralCap = Math.min((bottom - top) * 0.9 / 0.74, hitCache.size * 0.9);
      // A build with no line counts its bars down: the flood stops at the numeral's edges.
      const buildCount = drop.phase === 1 && !inGap && !inHit && time <= songEnd && time >= thumbnailEnd && !(state && (state.kind === "line" || state.mode === "chords" || state.mode === "word"));
      let numeralBand = null;
      if (buildCount) {
        const barsLeft = Math.max(1, song.barIndex(drop.drop.gapStart - 0.02) - song.barIndex(time) + 1);
        const size = Math.min((bottom - top) / 0.74, (boxWidth / String(barsLeft).length) / 0.62, numeralCap);
        const baseline = (top + bottom) / 2 + size * 0.36;
        numeralBand = { value: barsLeft, top: baseline - size * 0.76, bottom: baseline + size * 0.04 };
      }

      // Ink from the bottom: the bass note's height, or the build's flood rising up the
      // frame; the whole frame in the gap. Over a line it stops between rows.
      let blockHeight = 0;
      if (!breakdown) {
        // the bass note's height, sampled as an envelope (fast attack, slow release) so a
        // busy bass line swells and settles instead of strobing
        let level = 0;
        for (let step = 0; step < 8; step++) {
          const at = time - step * 0.04;
          const note = song.bassNotes.active(at);
          if (note < 0) continue;
          const noteHeight = 0.06 + 0.2 * clamp01((song.bassNotes.pitch[note] - 26) / 24);
          level = Math.max(level, noteHeight * Math.exp(-step * 0.04 / 0.12));
        }
        blockHeight = level * height * clamp01(song.value("bass", time) * 1.6);
      }
      if (drop.phase === 1) blockHeight = Math.max(blockHeight, drop.progress * height * 0.82);
      if (inGap) blockHeight = height;
      if (inHit || time > songEnd) blockHeight = 0;
      let edge = height - blockHeight;
      if (numeralBand && edge > numeralBand.top && edge < numeralBand.bottom) edge = edge - numeralBand.top < numeralBand.bottom - edge ? numeralBand.top : numeralBand.bottom;
      if (block && blockHeight > 0 && !inGap)
        for (const band of block.rowBands) {
          const rowTop = offsetY + band.top,
            rowBottom = offsetY + band.bottom;
          if (edge > rowTop && edge < rowBottom) {
            edge = edge - rowTop < rowBottom - edge ? rowTop : rowBottom;
            break;
          }
        }
      context.fillStyle = ink;
      if (edge < height - 0.5) context.fillRect(0, edge, width, height - edge);

      // The page's title and controls follow the field and ink as they swap, and flip again
      // when the ink covers the title.
      const titleCovered = edge < (frame.titleBottom || height * 0.12) * 0.55;
      const pageSwap = swap !== titleCovered;
      const key = `${pageSwap}`;
      if (key !== themeKey) {
        themeKey = key;
        document.documentElement.style.setProperty("--type-field", pageSwap ? palette.ink : palette.field);
        document.documentElement.style.setProperty("--type-ink", pageSwap ? palette.field : palette.ink);
        waveformTheme = null;
      }

      let anchor = song.anchor.kind === "word" ? song.anchorAt(time) : -1;
      let showTab = frame.playing !== false && !inGap && !inHit && time <= songEnd && !breakdown;

      if (time > songEnd) {
        // After the last sound: the song's word, still, as a tint.
        drawBigWord(hitWord, margin, top, width - margin, bottom, field, ink, edge, hitCache.size, Math.max(0.55, tint + 0.15));
      } else if (inGap && anchor >= 0) {
        // The key word sung into the gap: a tint in the flood, filled by the drop.
        drawBigWord(song.anchor.word.toUpperCase(), margin, top, width - margin, bottom, field, ink, edge, hitCache.size, tint + 0.2);
      } else if (inGap) {
        // The gap: the flood and the beats left before the drop, on the grid, as full stops.
        const end = drop.phase === 2 ? drop.drop.time : song.anchor.moments[leadIn].end;
        const beatsLeft = Math.max(1, song.beatIndex(end - 0.02) - song.beatIndex(time) + 1);
        drawPips(beatsLeft, margin, top, width - margin, bottom, field, ink, edge, hitCache.size);
      } else if (inHit) {
        // The hit: the song's word. The main drop's fills the whole frame below the title: a
        // long word split over two rows, a short one run off the bottom edge.
        if (mainHit) {
          if (hitWord.length >= 5 && !hitWord.includes(" ")) {
            const half = Math.ceil(hitWord.length / 2);
            const rows = palette.split || [hitWord.slice(0, half), hitWord.slice(half)];
            const inkWidth = (text, stretch) => {
              setFont(context, 900, 100, stretch);
              const metrics = context.measureText(text);
              return metrics.actualBoundingBoxLeft + metrics.actualBoundingBoxRight;
            };
            const room = height - top - height * 0.02;
            let size = 0,
              stretch = "normal";
            for (const candidate of ["expanded", "normal", "condensed"]) {
              const fit = Math.min((room * 1.08) / (0.72 * 2 + 0.08), ...rows.map((row) => (100 * width * 0.97) / inkWidth(row, candidate)));
              if (fit > size) [size, stretch] = [fit, candidate];
            }
            setFont(context, 900, size, stretch);
            rows.forEach((row, index) => {
              const metrics = context.measureText(row);
              const x = (width - (metrics.actualBoundingBoxLeft + metrics.actualBoundingBoxRight)) / 2 + metrics.actualBoundingBoxLeft;
              drawTextInverted(row, x, top + height * 0.02 + size * 0.72 + index * size * 0.8, field, ink, edge, size);
            });
          } else {
            // centred on its ink (not its advance), spanning the frame to a hair of each edge
            const fitted = bigWordFit(hitWord, boxWidth, height - top);
            setFont(context, 900, 100, fitted.rows[0].stretch);
            const probe = context.measureText(hitWord);
            const size = Math.min((100 * width * 0.97) / (probe.actualBoundingBoxLeft + probe.actualBoundingBoxRight), (height - top) / 0.74);
            setFont(context, 900, size, fitted.rows[0].stretch);
            const metrics = context.measureText(hitWord);
            const x = (width - (metrics.actualBoundingBoxLeft + metrics.actualBoundingBoxRight)) / 2 + metrics.actualBoundingBoxLeft;
            drawTextInverted(hitWord, x, height + size * 0.02, field, ink, edge, size);
          }
        } else drawBigWord(hitWord, margin, top, width - margin, bottom, field, ink, edge, hitCache.size);
      } else if (!state && time < thumbnailEnd) {
        // The first frame (the thumbnail): the song's word, solid.
        drawBigWord(hitWord, margin, top, width - margin, bottom, field, ink, edge, cap * 1.2);
        showTab = false;
      } else if (state && state.kind === "line") {
        // A sung line: the whole poster as a tint, each word filling in as it is sung; the key
        // word reversed out of an ink box.
        const current = song.wordIndex(time);
        block.words.forEach((word, index) => {
          const place = block.placed[index];
          const x = margin + place.x,
            baseline = offsetY + place.baseline;
          setFont(context, 900, place.size, place.stretch);
          const sung = time >= word.start;
          const inInk = baseline - place.ascent * 0.5 > edge;
          if (word.key && sung && time < word.end + 0.3) {
            const pad = place.size * 0.06;
            context.fillStyle = inInk ? field : ink;
            context.fillRect(x - pad, baseline - place.ascent - pad, place.width + pad * 2, place.ascent + pad * 2);
            context.fillStyle = inInk ? ink : field;
            context.fillText(word.display, x, baseline);
            return;
          }
          drawTextInverted(word.display, x, baseline, field, ink, edge, place.size, sung ? 1 : tint);
          // the word being sung now carries a rule under it
          if (sung && word.index === current && time < word.end + 0.05) {
            const rule = Math.max(4, place.size * 0.06);
            context.fillStyle = baseline + rule * 1.5 < edge ? ink : field;
            context.fillRect(x, baseline + rule * 0.9, place.width, rule);
          }
        });
      } else if (buildCount) {
        // a build without words counts its bars down to the drop
        drawCount(numeralBand.value, margin, top, width - margin, bottom, field, ink, edge, numeralCap);
        showTab = false;
      } else if (state) {
        // Instrumental: the passage's mode.
        if (state.mode === "word") {
          // the drop's word held until the voice returns
          drawBigWord(hitWord, margin, top, width - margin, bottom, field, ink, edge, hitCache.size);
        } else if (state.mode === "count") {
          // the intro counts its bars, until the voice comes in (the corner keeps the kick)
          drawCount(Math.max(1, song.barIndex(time) + 1), margin, top, width - margin, bottom, field, ink, edge, numeralCap);
        } else if (state.mode === "chords") {
          const index = song.chordIndex(time);
          if (index >= 0) drawChord(song.chords[index], margin, top, width - margin, bottom, field, ink, edge, cap);
          showTab = false;
        } else if (state.mode === "breathing") drawBreathing(time, margin, top, width - margin, bottom, state.text, field, ink, edge, cap);
        else if (state.mode === "letters") drawLetters(time, state, margin, top, width - margin, bottom, field, ink, edge, cap);
        else if (state.mode === "stack") drawStack(time, state, margin, top, width - margin, bottom, field, ink, edge);
        else drawWall(time, width, top, bottom, state.text, field, ink, edge);
      }

      // Kick → the beat counter in the top corner: the beat of the bar on a tab of the field,
      // solid for the instant of a kick, a tint otherwise. While the key word is sung it shows
      // the word's count instead. Only while playing (the paused frame has the controls).
      if (showTab) {
        const tabHeight = Math.min(height * 0.15, top - height * 0.03);
        const size = tabHeight / 0.92;
        const keyCount = anchor >= 0 ? String(anchor + 1).padStart(2, "0") : "";
        const beatNumber = Math.min(4, Math.floor(fract(song.barPosition(time)) * 4) + 1);
        const kicked = song.kicks.since(time) < 0.13;
        const text = keyCount || String(beatNumber);
        setFont(context, 900, size, "normal");
        const tabWidth = Math.max(size * 0.78, context.measureText(text).width + size * 0.2);
        const tabX = width - margin * 0.5 - tabWidth,
          tabY = height * 0.03;
        const solid = kicked || keyCount;
        context.fillStyle = solid ? ink : field;
        context.fillRect(tabX, tabY, tabWidth, tabHeight);
        context.textAlign = "center";
        const baseline = tabY + tabHeight / 2 + size * 0.36;
        context.fillStyle = solid ? field : ink;
        context.globalAlpha = solid ? 1 : tint + 0.2;
        context.fillText(text, tabX + tabWidth / 2, baseline);
        context.globalAlpha = 1;
        context.textAlign = "left";
      }
    }

    return {
      canvas,
      setSong,
      themeFor(model) {
        // The slot resets the page colours; the next frame sets them for its time again.
        themeKey = "";
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
        hitCache = { key: "", size: 0 };
      },
      render,
      debug: () => ({ timeline }),
    };
  },
});
