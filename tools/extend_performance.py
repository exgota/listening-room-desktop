#!/usr/bin/env python3
"""Extend each performance.json with a `visual` block for the visualizers.

    python3 tools/extend_performance.py                 # every song in library/
    python3 tools/extend_performance.py 4048d4a6dce4... # one song
    python3 tools/extend_performance.py --light         # rewrite only visual.lyrics and visual.peaks

Reads the committed stems (never separates again) and the existing analysis, then adds one
top-level object, `visual`, leaving every existing field as it was:

  grid_offset   seconds added to the tracked grid so beats sit on the drum transients
  beats, downbeats  the corrected grid
  drops         [{time, gap_start, strength}] on the corrected downbeat
  peaks         [{start, end, kind}] hand-named peaks from the brief (chord passages, words)
  kick          [[time, strength]]   the drum stem's low attacks (from `kicks`, corrected)
  snare         [[time, strength]]   backbeat clap/snare attacks (NMF of the drum stem)
  hat           [[time, strength]]   hi-hat attacks (NMF of the drum stem)
  stab          [[time, strength]]   attacks of the other stem (chords, synths)
  bass_notes    [[start, end, midi, strength]]  bass stem notes (pYIN pitch, onsets)
  vocal_notes   [[start, end, midi, level]]     sung notes from the CREPE pitch series
  chords        [[start, end, root, minor, confidence]]  triads per beat, merged
  scenes        [{start, end, kind, energy, vocals}]  intro/verse/groove/break/build/gap/drop/outro
  lyrics        [{text, start, end, probability, line, key}]  revised words (tools/lyrics)
  anchor        the song's anchor with times on the corrected grid

Everything is plain JSON numbers rounded to milliseconds. Dependencies: numpy, scipy,
librosa, soundfile, scikit-learn (NMF); ffmpeg on PATH to decode the stems.
"""

import argparse
import base64
import json
import pathlib
import subprocess
import sys

import librosa
import numpy as np
import scipy.signal

ROOT = pathlib.Path(__file__).resolve().parents[1]
LIBRARY = ROOT / "library"
LYRICS = ROOT / "tools" / "lyrics" / "revised"
SR = 24000  # 240-sample hops are exactly 10 ms, matching the 100 fps series
RATE = 100


def report(message):
    print(message, file=sys.stderr, flush=True)


def decode(path, rate=SR):
    raw = subprocess.run(["ffmpeg", "-nostdin", "-v", "error", "-i", str(path), "-ac", "1", "-ar", str(rate),
                          "-f", "f32le", "-"], check=True, capture_output=True).stdout
    return np.frombuffer(raw, dtype=np.float32).astype(np.float64)


def series(document, name):
    entry = document["series"][name]
    raw = np.frombuffer(base64.b64decode(entry["data"]), dtype=np.uint8).astype(np.float64)
    return entry["lower"] + raw / 255 * (entry["upper"] - entry["lower"])


def r3(value):
    return round(float(value), 3)


# ---------------------------------------------------------------- grid

def level_ms(signal):
    """Level in decibels in exact 1 ms steps."""
    hop = SR // 1000
    power = signal[: len(signal) // hop * hop].reshape(-1, hop) ** 2
    return 10 * np.log10(np.convolve(power.mean(axis=1), np.ones(3) / 3, "same") + 1e-12)


def retime(level, time, before=0.04, after=0.04, span=4):
    """The steepest rise of a 1 ms level within [time - before, time + after], and its size in dB."""
    first, last = int(round((time - before) * 1000)), int(round((time + after) * 1000))
    if first < 0 or last + span >= len(level):
        return time, 0.0
    segment = level[first:last + span]
    rise = segment[span:] - segment[:-span]
    index = int(np.argmax(rise))
    return (first + index + span // 2) / 1000, float(rise[index])


def grid_offset(drums, kicks, beats):
    """Shift of the beat grid that puts it on the kick transients.

    The first analysis snapped most kicks to its grid, so each kick's own transient (the
    steepest 4 ms rise of the drum stem's level near it, below 150 Hz and full band) minus
    its nearest beat measures the grid's error; the median of the two bands is used.
    """
    low = scipy.signal.sosfiltfilt(scipy.signal.butter(4, 150, btype="lowpass", fs=SR, output="sos"), drums)
    beats = np.asarray(beats)
    medians = []
    for signal in (low, drums):
        level = level_ms(signal)
        offsets = []
        for kick in kicks:
            if kick["strength"] < 0.4:
                continue
            time, size = retime(level, kick["time"], 0.07, 0.07)
            if size > 3:
                offsets.append(time - beats[np.argmin(np.abs(beats - time))])
        medians.append(np.median(offsets) if offsets else 0.0)
    return float(np.mean(medians))


def refine_arrival(low_level, time, window=0.06):
    """Where drums and bass arrive: the steepest rise of their low band within ±window."""
    moved, size = retime(low_level, time, window, window, span=6)
    return moved if size > 6 else time


# ---------------------------------------------------------------- drums

def drum_parts(drums, kicks):
    """NMF of the drum stem into kick-like, snare-like and hat-like activations."""
    from sklearn.exceptions import ConvergenceWarning
    import warnings
    warnings.filterwarnings("ignore", category=ConvergenceWarning)
    hop = SR // RATE  # exactly 10 ms
    spectrum = np.abs(librosa.stft(drums, n_fft=1024, hop_length=hop))
    mel = librosa.feature.melspectrogram(S=spectrum ** 2, sr=SR, n_mels=64, fmax=11025) ** 0.5
    components, activations = librosa.decompose.decompose(mel, n_components=8, sort=True, max_iter=400,
                                                          random_state=0)
    frequencies = librosa.mel_frequencies(n_mels=64, fmax=11025)
    centroid = (components * frequencies[:, None]).sum(0) / (components.sum(0) + 1e-9)
    frames = activations.shape[1]
    kick_train = np.zeros(frames)
    for kick in kicks:
        index = int(round(kick["time"] * RATE))
        if 0 <= index < frames:
            kick_train[max(0, index - 1):index + 2] = 1
    kinds = []
    for component in range(activations.shape[0]):
        activation = activations[component]
        attack = np.maximum(0, np.diff(activation, prepend=activation[0]))
        on_kicks = attack[kick_train > 0].sum() / (attack.sum() + 1e-9)
        if centroid[component] < 260 or (centroid[component] < 700 and on_kicks > 0.55):
            kinds.append("kick")
        elif centroid[component] < 2600:
            kinds.append("snare")
        else:
            kinds.append("hat")
    parts = {}
    for kind in ("snare", "hat"):
        chosen = [index for index, name in enumerate(kinds) if name == kind]
        if not chosen:
            parts[kind] = np.zeros(frames)
            continue
        weights = components[:, chosen].sum(axis=0)
        activation = (activations[chosen] * weights[:, None]).sum(axis=0)
        parts[kind] = activation / (np.percentile(activation, 99.5) + 1e-9)
    return parts, [(round(float(c)), k) for c, k in zip(centroid, kinds)]


def attacks(activation, minimum_gap, floor, kicks=None, kick_mask=0.0):
    """Peaks in the rise of an activation: [[time, strength]]."""
    smooth = np.convolve(activation, np.ones(2) / 2, "same")
    rise = np.maximum(0, np.diff(smooth, prepend=smooth[0]))
    rise = np.convolve(rise, np.ones(3), "same")
    peaks, properties = scipy.signal.find_peaks(rise, distance=max(1, int(minimum_gap * RATE)), height=floor)
    scale = np.percentile(properties["peak_heights"], 95) if len(peaks) else 1
    events = []
    kick_times = np.array([kick["time"] for kick in kicks]) if kicks else np.array([])
    for peak, height in zip(peaks, properties["peak_heights"]):
        time = peak / RATE
        strength = min(1.0, height / scale)
        if kick_mask and len(kick_times) and np.min(np.abs(kick_times - time)) < 0.03:
            strength *= kick_mask
        if strength >= 0.12:
            events.append([r3(time), round(float(strength), 3)])
    return events


# ---------------------------------------------------------------- pitch

def bass_notes(bass, level):
    rate = 4000
    signal = librosa.resample(bass, orig_sr=SR, target_sr=rate)
    f0, voiced, probability = librosa.pyin(signal, fmin=30, fmax=400, sr=rate, frame_length=1024, hop_length=40,
                                           fill_na=0.0)
    count = len(level)
    midi = np.zeros(count)
    usable = min(count, len(f0))
    pitched = np.where((f0[:usable] > 0) & (probability[:usable] > 0.2), librosa.hz_to_midi(np.maximum(f0[:usable], 1)), 0)
    midi[:usable] = pitched
    onsets = librosa.onset.onset_detect(y=bass, sr=SR, hop_length=SR // RATE, backtrack=True, units="frames",
                                        delta=0.06, wait=6)
    onsets = sorted(set(int(o) for o in onsets if o < count))
    # Split also where the pitch jumps by a semitone or more for 40 ms.
    rounded = np.where(midi > 0, np.round(midi), 0)
    for index in range(4, count - 4):
        if rounded[index] > 0 and rounded[index - 1] > 0 and abs(rounded[index] - rounded[index - 1]) >= 1:
            if np.all(rounded[index:index + 4] == rounded[index]):
                onsets.append(index)
    onsets = sorted(set(onsets))
    notes = []
    for position, start in enumerate(onsets):
        end = onsets[position + 1] if position + 1 < len(onsets) else count
        body = level[start:end]
        if len(body) < 4 or body.max() < 0.25:
            continue
        audible = np.nonzero(body > max(0.2, body.max() * 0.45))[0]
        stop = start + (audible[-1] + 1 if len(audible) else len(body))
        pitches = midi[start:stop]
        pitches = pitches[pitches > 0]
        if len(pitches) < 3:
            continue
        notes.append([r3(start / RATE), r3(stop / RATE), round(float(np.median(pitches)), 2),
                      round(float(body.max()), 3)])
    return notes


def vocal_notes(pitch, vocal):
    notes = []
    count = len(pitch)
    index = 0
    while index < count:
        if pitch[index] <= 0:
            index += 1
            continue
        start = index
        values = [pitch[index]]
        index += 1
        while index < count and pitch[index] > 0:
            reference = np.median(values[-8:])
            if abs(pitch[index] - reference) > 0.8:
                if index + 3 < count and all(abs(pitch[index + k] - reference) > 0.8 for k in range(4)):
                    break
            values.append(pitch[index])
            index += 1
        if index - start >= 6:
            notes.append([r3(start / RATE), r3(index / RATE), round(float(np.median(values)), 2),
                          round(float(vocal[start:index].mean()), 3)])
    return notes


NOTE_TEMPLATES = []
for root in range(12):
    for minor in (0, 1):
        template = np.zeros(12)
        template[[root, (root + 3 + (1 - minor)) % 12, (root + 7) % 12]] = [1.0, 0.8, 0.8]
        NOTE_TEMPLATES.append((root, minor, template / np.linalg.norm(template)))


def chords(document, beats, bass_list, duration):
    chroma = np.stack([series(document, f"pitch_class_{index}") for index in range(12)])
    other = series(document, "other")
    edges = list(beats) + [duration]
    rows, quiet = [], []
    for index in range(len(beats)):
        first, last = int(edges[index] * RATE), max(int(edges[index] * RATE) + 1, int(edges[index + 1] * RATE))
        vector = chroma[:, first:last].mean(axis=1)
        for note in bass_list:
            overlap = min(note[1], edges[index + 1]) - max(note[0], edges[index])
            if overlap > 0:
                vector[int(round(note[2])) % 12] += 0.35 * overlap / (edges[index + 1] - edges[index])
        rows.append(vector / (np.linalg.norm(vector) + 1e-9))
        quiet.append(other[first:last].mean() < 0.15)
    scores = np.array([[template @ row for _, _, template in NOTE_TEMPLATES] for row in rows])
    # Viterbi with a switching penalty so chords hold across beats.
    count, states = scores.shape
    penalty = 0.12
    total = scores[0].copy()
    back = np.zeros((count, states), dtype=int)
    for index in range(1, count):
        stay = total
        switch = total.max() - penalty
        choose_switch = switch > stay
        back[index] = np.where(choose_switch, int(total.argmax()), np.arange(states))
        total = np.where(choose_switch, switch, stay) + scores[index]
    path = np.zeros(count, dtype=int)
    path[-1] = int(total.argmax())
    for index in range(count - 1, 0, -1):
        path[index - 1] = back[index, path[index]]
    segments = []
    for index, state in enumerate(path):
        root, minor, _ = NOTE_TEMPLATES[state]
        start, end = edges[index], edges[index + 1]
        confidence = float(scores[index, state]) if not quiet[index] else 0.0
        if segments and segments[-1][2] == root and segments[-1][3] == minor:
            segments[-1][1] = r3(end)
            segments[-1][4] = max(segments[-1][4], round(confidence, 3))
        else:
            segments.append([r3(start), r3(end), root, minor, round(confidence, 3)])
    return segments


# ---------------------------------------------------------------- structure

def scenes(document, drops, snare, duration, offset=0.0):
    """One label per stretch of bars: what the band is doing there.

    Each bar is classed by its stem levels (break: drums out; full: drums and bass in;
    otherwise groove), listed builds and the gaps before drops override, and a run of one
    class is split at four-bar boundaries where the texture (stem levels, hats, backbeat,
    singing) changes. Kinds: intro, verse, groove, break, build, gap, drop, drive, outro.
    """
    bars = [{**bar, "start": bar["start"] + offset, "end": bar["end"] + offset} for bar in document["bars"]]
    sections = {**document["sections"], "builds": [{**build, "start": build["start"] + offset, "end": build["end"] + offset}
                                                   for build in document["sections"]["builds"]]}
    mix, vocal, hats = series(document, "mix"), series(document, "vocal"), series(document, "hats")
    snare_times = np.array([event[0] for event in snare if event[1] > 0.5])
    features, kinds = [], []
    for bar in bars:
        first, last = int(bar["start"] * RATE), max(int(bar["start"] * RATE) + 1, int(bar["end"] * RATE))
        backbeat = np.sum((snare_times >= bar["start"]) & (snare_times < bar["end"])) / 2
        singing = float((vocal[first:last] > 0.35).mean())
        features.append(np.array([np.clip(bar["drums"], -40, 0) / 40, np.clip(bar["bass"], -40, 0) / 40,
                                  np.clip(bar["other"], -40, 0) / 40, hats[first:last].mean(),
                                  min(1.0, backbeat), singing]))
        if bar["drums"] < -22:
            kinds.append("break")
        elif bar["bass"] > -9 and bar["drums"] > -9:
            kinds.append("full")
        else:
            kinds.append("groove")
    for build in sections["builds"]:
        for index, bar in enumerate(bars):
            if bar["start"] >= build["start"] - 0.05 and bar["end"] <= build["end"] + 0.3:
                kinds[index] = "build"
    # Smooth single-bar flips (fills, one-bar dropouts) into the surrounding class.
    for index in range(1, len(kinds) - 1):
        if kinds[index - 1] == kinds[index + 1] != kinds[index] and kinds[index] != "build":
            kinds[index] = kinds[index - 1]
    runs = []
    for index, kind in enumerate(kinds):
        if runs and runs[-1][2] == kind:
            runs[-1][1] = index + 1
        else:
            runs.append([index, index + 1, kind])
    pieces = []
    for first, last, kind in runs:
        cut = first
        for boundary in range(first + 4, last - 3, 4):
            before = np.mean(features[max(cut, boundary - 4):boundary], axis=0)
            after = np.mean(features[boundary:boundary + 4], axis=0)
            if np.abs(before - after).sum() > 0.55:
                pieces.append([cut, boundary, kind])
                cut = boundary
        pieces.append([cut, last, kind])
    result = [{"start": bars[first]["start"], "end": bars[last - 1]["end"], "kind": kind,
               "singing": float(np.mean([features[index][5] for index in range(first, last)]))}
              for first, last, kind in pieces]
    # Gaps cut the runs at exact times.
    for drop in drops:
        if drop["gap_start"] >= drop["time"] - 0.05:
            continue
        split = []
        for piece in result:
            if piece["start"] < drop["time"] and piece["end"] > drop["gap_start"]:
                if piece["start"] < drop["gap_start"]:
                    split.append({**piece, "end": drop["gap_start"]})
                split.append({**piece, "start": max(drop["gap_start"], piece["start"]),
                              "end": min(drop["time"], piece["end"]), "kind": "gap"})
                if piece["end"] > drop["time"]:
                    split.append({**piece, "start": drop["time"]})
            else:
                split.append(piece)
        result = split
    # Runs that begin at a drop move their start onto the exact drop time.
    for drop in drops:
        for piece in result:
            if abs(piece["start"] - drop["time"]) < 0.3 and piece["kind"] != "gap":
                piece["start"] = drop["time"]
                if piece["kind"] in ("full", "groove"):
                    piece["kind"] = "drop"
            if abs(piece["end"] - drop["time"]) < 0.3:
                piece["end"] = drop["time"]
    first_full = next((piece["start"] for piece in result if piece["kind"] in ("full", "drop")), duration)
    last_full = max((piece["end"] for piece in result if piece["kind"] in ("full", "drop")), default=0)
    for piece in result:
        kind = piece["kind"]
        if kind == "full":
            kind = "drive"
        elif kind in ("groove", "break") and piece["end"] <= first_full + 0.05 and piece["start"] < 1:
            kind = "intro"
        elif kind in ("groove", "break") and piece["start"] >= last_full - 0.05:
            kind = "outro"
        elif kind == "groove" and piece["singing"] > 0.4:
            kind = "verse"
        piece["kind"] = kind
        first, last = int(piece["start"] * RATE), int(piece["end"] * RATE)
        piece["energy"] = round(float(mix[first:last].mean()), 3) if last > first else 0.0
        piece["vocals"] = round(piece.pop("singing"), 3)
        piece["start"], piece["end"] = r3(piece["start"]), r3(piece["end"])
    result = [piece for piece in result if piece["end"] - piece["start"] > 0.05]
    result[0]["start"] = 0.0
    result[-1]["end"] = r3(duration)
    return result


# ---------------------------------------------------------------- peaks

# The moments that must land hardest, from the brief (its own listening plus this analysis),
# on the original grid. Drops and gaps are already in `drops`; these add what the analysis
# cannot name: the chord passages of NBLY and the word that straddles Desire's main drop.
PEAKS = {
    "5ff86d6cd02ebd7308e03df8": [  # NBLY
        {"start": 140.0, "end": 145.0, "kind": "chords"},
        {"start": 248.0, "end": 259.0, "kind": "chords"},
    ],
    "1d589940ca458d793a3fad8a": [  # Desire: "Is it desire?" runs into the drop
        {"start": 167.44, "end": 168.1, "kind": "word"},
    ],
    "f127a026dc751f1528bfb95d": [],  # The Fate of Ophelia: its drops and breakdowns
    "8eee874c702a10807f79706c": [],  # Outside: the one build and drop
    "4048d4a6dce44c151690b2b1": [],  # American Boy: a groove, no peak beyond its drop
}


# ---------------------------------------------------------------- lyrics

def lyrics_for(identifier):
    path = LYRICS / f"{identifier}.json"
    if not path.exists():
        return None
    return json.loads(path.read_text())


# ---------------------------------------------------------------- main

def extend(identifier, light=False):
    folder = LIBRARY / identifier
    path = folder / "performance.json"
    document = json.loads(path.read_text())
    visual = document.get("visual", {}) if light else {}
    lyrics = lyrics_for(identifier)
    if lyrics is not None:
        visual["lyrics"] = lyrics
    if light:
        offset = visual.get("grid_offset", 0.0)
        visual["peaks"] = [{**peak, "start": r3(peak["start"] + offset), "end": r3(peak["end"] + offset)}
                           for peak in PEAKS.get(identifier, [])]
        document["visual"] = visual
        path.write_text(json.dumps(document, separators=(",", ":")))
        report(f"{identifier}: lyrics {len(lyrics or [])}, peaks {len(visual['peaks'])}")
        return
    report(f"{identifier}: decoding stems")
    stems = {stem: decode(folder / "stems" / f"{stem}.m4a") for stem in ("drums", "bass", "other", "vocals")}
    duration = document["duration"]
    count = int(np.ceil(duration * RATE)) + 1

    offset = grid_offset(stems["drums"], document["kicks"], document["beats"])
    if abs(offset) < 0.006:
        offset = 0.0
    report(f"  grid offset {offset * 1000:+.0f} ms")
    beats = [r3(time + offset) for time in document["beats"]]
    downbeats = [r3(time + offset) for time in document["downbeats"]]
    low_level = level_ms(scipy.signal.sosfiltfilt(scipy.signal.butter(4, 160, btype="lowpass", fs=SR, output="sos"),
                                                  stems["drums"] + stems["bass"]))
    # Drops sit on the corrected downbeat: at every listed drop the corrected grid lines up
    # with the arrival of drums and bass (checked in 1 ms waveform views); a search for the
    # steepest rise nearby can jump to a fill or a later hit, so it only confirms.
    drops = []
    for drop in document["sections"]["drops"]:
        time = drop["time"] + offset
        gap_start = drop["gap_start"] + offset if drop["gap_start"] < drop["time"] - 0.05 else time
        drops.append({"time": r3(time), "gap_start": r3(gap_start), "strength": drop["strength"],
                      "listed": drop["time"], "arrival": r3(refine_arrival(low_level, time, 0.03))})
    report(f"  drops {[(d['listed'], d['time'], d['arrival']) for d in drops]}")

    # Kicks and backbeats land on eighth notes; snapping them to the corrected grid removes the
    # first analysis's 10 ms steps and the lag of its attack measure. Hats and bass keep their
    # own timing, which carries the swing.
    eighths = np.sort(np.concatenate([np.asarray(beats), (np.asarray(beats[:-1]) + np.asarray(beats[1:])) / 2]))

    def snap(time, reach):
        nearest = eighths[np.argmin(np.abs(eighths - time))]
        return float(nearest) if abs(nearest - time) <= reach else time

    kicks = []
    for kick in document["kicks"]:
        on_grid = abs(kick["time"] - min(document["beats"], key=lambda beat: abs(beat - kick["time"]))) < 0.001
        kicks.append({"time": snap(kick["time"] + (offset if on_grid else 0), 0.045), "strength": kick["strength"]})
    parts, labels = drum_parts(stems["drums"], kicks)
    report(f"  drum components {labels}")
    snare = attacks(parts["snare"][:count], 0.09, 0.08, kicks, kick_mask=0.6)
    hat = attacks(parts["hat"][:count], 0.05, 0.06)
    band = lambda low, high: level_ms(scipy.signal.sosfiltfilt(
        scipy.signal.butter(4, [low, high] if high else low, btype="bandpass" if high else "highpass", fs=SR,
                            output="sos"), stems["drums"]))
    snare_level, hat_level = band(900, 5000), band(6000, None)
    snare = [[r3(snap(retime(snare_level, time, 0.025, 0.025)[0], 0.035)), strength] for time, strength in snare]
    hat = [[r3(retime(hat_level, time, 0.02, 0.02)[0]), strength] for time, strength in hat]
    other_attack = series(document, "other_attack")
    stab_peaks, stab_props = scipy.signal.find_peaks(other_attack, distance=8, height=0.3, prominence=0.15)
    stab = [[r3(peak / RATE), round(float(height), 3)] for peak, height in zip(stab_peaks, stab_props["peak_heights"])]

    report("  bass notes")
    bass_level = series(document, "bass")
    bass_list = bass_notes(stems["bass"], bass_level)
    bass_attack = level_ms(stems["bass"])
    for note in bass_list:
        moved, size = retime(bass_attack, note[0], 0.02, 0.02)
        if size > 3 and moved < note[1] - 0.03:
            note[0] = r3(moved)
    report(f"    {len(bass_list)} notes")
    pitch, vocal = series(document, "pitch"), series(document, "vocal")
    voice_list = vocal_notes(pitch, vocal)
    chord_list = chords(document, beats, bass_list, duration)
    scene_list = scenes(document, drops, snare, duration, offset)
    anchor = document["anchor"]
    visual.update({
        "version": 1,
        "grid_offset": r3(offset),
        "beats": beats,
        "downbeats": downbeats,
        "drops": [{key: value for key, value in drop.items() if key not in ("listed", "arrival")} for drop in drops],
        "kick": [[r3(k["time"]), round(k["strength"], 3)] for k in kicks],
        "snare": snare,
        "hat": hat,
        "stab": stab,
        "bass_notes": bass_list,
        "vocal_notes": voice_list,
        "chords": chord_list,
        "scenes": scene_list,
        "peaks": [{**peak, "start": r3(peak["start"] + offset), "end": r3(peak["end"] + offset)}
                  for peak in PEAKS.get(identifier, [])],
        "anchor": {"kind": anchor["kind"], "word": anchor["word"],
                   "moments": [{"start": r3(m["start"] + (offset if anchor["kind"] == "lead_in" else 0)),
                                "end": r3(m["end"] + (offset if anchor["kind"] == "lead_in" else 0))}
                               for m in anchor["moments"]]},
    })
    document["visual"] = visual
    path.write_text(json.dumps(document, separators=(",", ":")))
    report(f"  wrote visual: {len(snare)} snares, {len(hat)} hats, {len(stab)} stabs, {len(voice_list)} sung notes, "
           f"{len(chord_list)} chords, {len(scene_list)} scenes")


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("identifiers", nargs="*")
    parser.add_argument("--light", action="store_true")
    arguments = parser.parse_args()
    identifiers = arguments.identifiers or sorted(path.name for path in LIBRARY.iterdir() if (path / "performance.json").exists())
    for identifier in identifiers:
        extend(identifier, arguments.light)


if __name__ == "__main__":
    main()
