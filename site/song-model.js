// The song as the visualizers read it: a track's performance.json decoded once into typed
// arrays, event lists and queries. Every query is a pure function of song time, so a seek,
// a pause or a headless render at any time gives the same picture as playing straight
// through. Nothing here touches the page.

const songSeriesRate = 100;

function decodeSongSeries(entry) {
  const text = atob(entry.data);
  const values = new Float32Array(text.length);
  const scale = (entry.upper - entry.lower) / 255;
  for (let index = 0; index < text.length; index++) values[index] = entry.lower + text.charCodeAt(index) * scale;
  return values;
}

// Index of the last value <= time in a sorted array, or -1.
function lastIndexAtOrBefore(values, time, length = values.length) {
  let low = 0,
    high = length - 1,
    found = -1;
  while (low <= high) {
    const middle = (low + high) >> 1;
    if (values[middle] <= time) {
      found = middle;
      low = middle + 1;
    } else high = middle - 1;
  }
  return found;
}

class SongEvents {
  // pairs: [[time, strength], ...] sorted by time
  constructor(pairs) {
    this.length = pairs.length;
    this.time = new Float64Array(pairs.length);
    this.strength = new Float32Array(pairs.length);
    pairs.forEach(([time, strength], index) => {
      this.time[index] = time;
      this.strength[index] = strength;
    });
  }
  last(time) {
    return lastIndexAtOrBefore(this.time, time, this.length);
  }
  // Seconds since the last event at or before `time` (Infinity when none).
  since(time) {
    const index = this.last(time);
    return index < 0 ? Infinity : time - this.time[index];
  }
  // Seconds until the first event after `time` (Infinity when none).
  until(time) {
    const index = this.last(time) + 1;
    return index >= this.length ? Infinity : this.time[index] - time;
  }
  // Strongest impulse at `time` from events in the last `window` seconds: strength * decay.
  impulse(time, decay, minimumStrength = 0) {
    let index = this.last(time),
      value = 0;
    while (index >= 0) {
      const age = time - this.time[index];
      if (age > decay * 6) break;
      if (this.strength[index] >= minimumStrength) value = Math.max(value, this.strength[index] * Math.exp(-age / decay));
      index--;
    }
    return value;
  }
}

class SongNotes {
  // rows: [[start, end, pitch, strength], ...] sorted by start
  constructor(rows) {
    this.length = rows.length;
    this.start = new Float64Array(rows.length);
    this.end = new Float64Array(rows.length);
    this.pitch = new Float32Array(rows.length);
    this.strength = new Float32Array(rows.length);
    rows.forEach(([start, end, pitch, strength], index) => {
      this.start[index] = start;
      this.end[index] = end;
      this.pitch[index] = pitch;
      this.strength[index] = strength;
    });
  }
  last(time) {
    return lastIndexAtOrBefore(this.start, time, this.length);
  }
  // The note sounding at `time`, or -1.
  active(time) {
    const index = this.last(time);
    return index >= 0 && time < this.end[index] ? index : -1;
  }
}

class SongModel {
  constructor(track, performance) {
    const visual = performance.visual || {};
    const offset = visual.grid_offset || 0;
    this.identifier = track.identifier;
    this.title = track.title;
    this.duration = performance.duration || track.duration;
    this.tempo = performance.tempo || 120;
    this.series = {};
    for (const [name, entry] of Object.entries(performance.series || {})) this.series[name] = decodeSongSeries(entry);
    this.frames = this.series.mix?.length || Math.ceil(this.duration * songSeriesRate) + 1;
    this.prefix = {};
    this.beats = Float64Array.from(visual.beats || performance.beats || []);
    this.downbeats = Float64Array.from(visual.downbeats || performance.downbeats || []);
    this.beatPeriod = this.beats.length > 1 ? (this.beats[this.beats.length - 1] - this.beats[0]) / (this.beats.length - 1) : 60 / this.tempo;
    this.barPeriod = this.beatPeriod * 4;
    const kicks = visual.kick || (performance.kicks || []).map((kick) => [kick.time, kick.strength]);
    this.kicks = new SongEvents(kicks);
    this.snares = new SongEvents(visual.snare || (performance.claps || []).map((clap) => [clap.time, clap.strength]));
    this.hats = new SongEvents(visual.hat || []);
    this.stabs = new SongEvents(visual.stab || []);
    this.bassNotes = new SongNotes(visual.bass_notes || []);
    this.vocalNotes = new SongNotes(visual.vocal_notes || []);
    this.chords = (visual.chords || []).map(([start, end, root, minor, confidence]) => ({ start, end, root, minor, confidence }));
    this.chordStarts = Float64Array.from(this.chords.map((chord) => chord.start));
    const sections = performance.sections || {};
    this.drops = (visual.drops || (sections.drops || []).map((drop) => ({ time: drop.time, gap_start: drop.gap_start, strength: drop.strength })))
      .map((drop) => ({ time: drop.time, gapStart: drop.gap_start, strength: drop.strength }));
    this.builds = (sections.builds || []).map((build) => {
      const drop = this.drops.find((entry) => Math.abs(entry.gapStart - (build.end + offset)) < 0.3 || Math.abs(entry.time - (build.end + offset)) < 0.3);
      return { start: build.start + offset, end: drop ? drop.gapStart : build.end + offset };
    });
    for (const drop of this.drops)
      drop.build = this.builds.find((entry) => entry.end >= drop.gapStart - 0.3 && entry.end <= drop.time + 0.1) || null;
    this.breakdowns = (sections.breakdowns || []).map((part) => ({ start: part.start + offset, end: part.end + offset }));
    const anchor = visual.anchor || performance.anchor || { kind: "none", moments: [] };
    this.anchor = { kind: anchor.kind, word: anchor.word, moments: anchor.moments.map((moment) => ({ start: moment.start, end: moment.end })) };
    // A key-word anchor takes its moments from the revised lyrics when they found the word
    // (Desire's "desire" is sung twelve times, not the eleven the first transcription heard).
    if (this.anchor.kind === "word") {
      const keyed = (visual.lyrics || []).filter((word) => word.key);
      if (keyed.length >= this.anchor.moments.length - 1)
        this.anchor.moments = keyed.map((word) => ({ start: word.start, end: Math.max(word.end, word.start + 0.25) }));
    }
    this.anchorStarts = Float64Array.from(this.anchor.moments.map((moment) => moment.start));
    // The main drop: the strongest, and of equals the later (the song's last word on it).
    this.mainDrop = -1;
    this.drops.forEach((drop, index) => {
      if (this.mainDrop < 0 || drop.strength >= this.drops[this.mainDrop].strength - 0.02) this.mainDrop = index;
    });
    this.peaks = (visual.peaks || []).map((peak) => ({ start: peak.start, end: peak.end, kind: peak.kind }));
    this.scenes = this.buildScenes(visual.scenes || []);
    this.sceneStarts = Float64Array.from(this.scenes.map((scene) => scene.start));
    this.lyrics = this.buildLyrics(visual.lyrics || []);
    this.dropState = { phase: 0, index: -1, progress: 0, since: Infinity, until: Infinity, drop: null, build: null };
  }

  buildScenes(rows) {
    if (!rows.length) rows = [{ start: 0, end: this.duration, kind: "drive", energy: 0.8, vocals: 0 }];
    const counts = {};
    const energies = rows.map((row) => row.energy);
    const low = Math.min(...energies),
      high = Math.max(...energies);
    return rows.map((row, index) => {
      counts[row.kind] = (counts[row.kind] || 0) + 1;
      return {
        start: row.start,
        end: row.end,
        kind: row.kind,
        energy: row.energy,
        intensity: high > low ? (row.energy - low) / (high - low) : 1,
        vocals: row.vocals,
        index,
        kindIndex: counts[row.kind] - 1,
      };
    });
  }

  buildLyrics(rows) {
    const words = rows.map((row, index) => ({
      text: row.text,
      start: row.start,
      end: row.end,
      probability: row.probability,
      votes: row.votes || 0,
      line: row.line,
      key: Boolean(row.key),
      index,
    }));
    const lines = [];
    for (const word of words) {
      if (!lines.length || lines[lines.length - 1].number !== word.line)
        lines.push({ number: word.line, words: [], start: word.start, end: word.end });
      const line = lines[lines.length - 1];
      line.words.push(word);
      line.end = word.end;
    }
    return { words, lines, wordStarts: Float64Array.from(words.map((word) => word.start)), lineStarts: Float64Array.from(lines.map((line) => line.start)) };
  }

  // ---- continuous series (100 per second) ----

  value(name, time) {
    const values = this.series[name];
    if (!values) return 0;
    const position = time * songSeriesRate;
    const index = Math.floor(position);
    if (index < 0) return values[0];
    if (index >= values.length - 1) return values[values.length - 1];
    const fraction = position - index;
    return values[index] * (1 - fraction) + values[index + 1] * fraction;
  }

  // Mean of a series over [start, end], from prefix sums built on first use.
  mean(name, start, end) {
    const values = this.series[name];
    if (!values) return 0;
    let prefix = this.prefix[name];
    if (!prefix) {
      prefix = this.prefix[name] = new Float64Array(values.length + 1);
      for (let index = 0; index < values.length; index++) prefix[index + 1] = prefix[index] + values[index];
    }
    const first = Math.max(0, Math.min(values.length, Math.floor(start * songSeriesRate)));
    const last = Math.max(first + 1, Math.min(values.length, Math.ceil(end * songSeriesRate)));
    return (prefix[last] - prefix[Math.min(first, last - 1)]) / Math.max(1, last - first);
  }

  chroma(time, into) {
    for (let index = 0; index < 12; index++) into[index] = this.value(`pitch_class_${index}`, time);
    return into;
  }

  // ---- grid ----

  beatIndex(time) {
    const index = lastIndexAtOrBefore(this.beats, time);
    if (index >= 0) return index;
    return Math.floor((time - (this.beats[0] || 0)) / this.beatPeriod);
  }

  beatTime(index) {
    const count = this.beats.length;
    if (!count) return index * this.beatPeriod;
    if (index < 0) return this.beats[0] + index * this.beatPeriod;
    if (index >= count) return this.beats[count - 1] + (index - count + 1) * this.beatPeriod;
    return this.beats[index];
  }

  // Beats since the first beat, fractional: 12.25 is a quarter past beat 12.
  beatPosition(time) {
    const index = this.beatIndex(time);
    const start = this.beatTime(index),
      end = this.beatTime(index + 1);
    return index + (time - start) / Math.max(1e-6, end - start);
  }

  barIndex(time) {
    const index = lastIndexAtOrBefore(this.downbeats, time);
    if (index >= 0) return index;
    return Math.floor((time - (this.downbeats[0] || 0)) / this.barPeriod);
  }

  barTime(index) {
    const count = this.downbeats.length;
    if (!count) return index * this.barPeriod;
    if (index < 0) return this.downbeats[0] + index * this.barPeriod;
    if (index >= count) return this.downbeats[count - 1] + (index - count + 1) * this.barPeriod;
    return this.downbeats[index];
  }

  barPosition(time) {
    const index = this.barIndex(time);
    const start = this.barTime(index),
      end = this.barTime(index + 1);
    return index + (time - start) / Math.max(1e-6, end - start);
  }

  // ---- structure ----

  sceneIndex(time) {
    return Math.max(0, lastIndexAtOrBefore(this.sceneStarts, time));
  }

  scene(time) {
    return this.scenes[this.sceneIndex(time)];
  }

  chordIndex(time) {
    return lastIndexAtOrBefore(this.chordStarts, time);
  }

  // Where `time` sits against the drops: phase 0 = nothing near, 1 = in a build (progress
  // 0..1), 2 = in the gap (progress 0..1), 3 = after a drop (since = seconds since it).
  // Always reuses one object.
  dropContext(time) {
    const state = this.dropState;
    state.phase = 0;
    state.index = -1;
    state.progress = 0;
    state.drop = null;
    state.build = null;
    state.since = Infinity;
    state.until = Infinity;
    for (let index = 0; index < this.drops.length; index++) {
      const drop = this.drops[index];
      if (time >= drop.time) {
        state.since = time - drop.time;
        state.index = index;
        state.drop = drop;
        state.phase = 3;
        continue;
      }
      state.until = drop.time - time;
      if (time >= drop.gapStart && drop.gapStart < drop.time) {
        state.phase = 2;
        state.index = index;
        state.drop = drop;
        state.progress = (time - drop.gapStart) / (drop.time - drop.gapStart);
        return state;
      }
      const build = drop.build;
      if (build && time >= build.start) {
        state.phase = 1;
        state.index = index;
        state.drop = drop;
        state.build = build;
        state.progress = Math.min(1, (time - build.start) / Math.max(0.1, build.end - build.start));
        return state;
      }
      return state;
    }
    return state;
  }

  // Index of the anchor moment containing `time` (or -1), for the key word or lead-in. A
  // moment ends where the next thing (the drop, for a lead-in) begins, so the end is open.
  anchorAt(time) {
    const index = lastIndexAtOrBefore(this.anchorStarts, time);
    return index >= 0 && time < this.anchor.moments[index].end ? index : -1;
  }

  // The named peak containing `time` (chord passages, words), or null.
  peakAt(time) {
    for (const peak of this.peaks) if (time >= peak.start && time < peak.end) return peak;
    return null;
  }

  // ---- words ----

  wordIndex(time) {
    return lastIndexAtOrBefore(this.lyrics.wordStarts, time);
  }

  lineIndex(time) {
    return lastIndexAtOrBefore(this.lyrics.lineStarts, time);
  }
}

// Fetches and decodes a track's analysis once per track; later calls share the promise.
const songModelCache = new Map();

function loadSongModel(track) {
  if (!track?.performance_url) return Promise.resolve(null);
  if (!songModelCache.has(track.identifier)) {
    songModelCache.set(
      track.identifier,
      fetch(track.performance_url)
        .then((response) => {
          if (!response.ok) throw Error("Performance unavailable");
          return response.json();
        })
        .then((performance) => new SongModel(track, performance))
        .catch((error) => {
          songModelCache.delete(track.identifier);
          throw error;
        }),
    );
  }
  return songModelCache.get(track.identifier);
}
