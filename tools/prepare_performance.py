# /// script
# requires-python = ">=3.11,<3.13"
# dependencies = [
#   "torch",
#   "torchaudio",
#   "demucs",
#   "soundfile",
#   "librosa",
#   "numpy",
#   "scipy",
#   "torchcrepe",
#   "openai-whisper",
#   "beat_this @ https://github.com/CPJKU/beat_this/archive/main.zip",
# ]
# ///
"""Prepare a recording for the stem performance.

Separates the recording into vocals, drums, bass and other with Demucs, finds
beats and downbeats, the vocal pitch, the sung words, kick and clap attacks,
per-stem levels, pitch classes and the song's structure, then writes one JSON
document the page reads, plus an AAC copy of each stem for solo playback.

    uv run prepare_performance.py recordings/desire.mp3 --name desire
"""

import argparse
import base64
import json
import subprocess
import sys
from pathlib import Path

import librosa
import numpy as np
import scipy.signal
import soundfile

RATE = 100  # feature frames per second
STEMS = ("vocals", "drums", "bass", "other")
DIRECTORY = Path(__file__).resolve().parent


def report(message):
    print(message, file=sys.stderr, flush=True)


def separate(source, work):
    target = work / "htdemucs_ft" / source.stem
    if not all((target / f"{stem}.wav").exists() for stem in STEMS):
        report("Separating stems")
        subprocess.run([sys.executable, "-m", "demucs", "-n", "htdemucs_ft", "-d", "mps", "-o", str(work), str(source)],
                       check=True)
    return {stem: target / f"{stem}.wav" for stem in STEMS}


def load_mono(path, sample_rate=44100):
    audio, rate = soundfile.read(path, dtype="float32", always_2d=True)
    mono = audio.mean(axis=1)
    if rate != sample_rate:
        mono = librosa.resample(mono, orig_sr=rate, target_sr=sample_rate)
    return mono


def frame_count(duration):
    return int(np.ceil(duration * RATE)) + 1


def fit_length(values, count):
    values = np.asarray(values, dtype=np.float64)
    if len(values) >= count:
        return values[:count]
    return np.concatenate([values, np.full(count - len(values), values[-1] if len(values) else 0)])


def level_decibels(signal, sample_rate, count, window=2048):
    hop = sample_rate // RATE
    rms = librosa.feature.rms(y=signal, frame_length=window, hop_length=hop, center=True)[0]
    return fit_length(20 * np.log10(rms + 1e-9), count)


def band_signal(signal, sample_rate, low=None, high=None, order=4):
    if low and high:
        sos = scipy.signal.butter(order, [low, high], btype="bandpass", fs=sample_rate, output="sos")
    elif high:
        sos = scipy.signal.butter(order, high, btype="lowpass", fs=sample_rate, output="sos")
    else:
        sos = scipy.signal.butter(order, low, btype="highpass", fs=sample_rate, output="sos")
    return scipy.signal.sosfiltfilt(sos, signal).astype(np.float32)


def normalize_decibels(values, span=36.0):
    """Map decibels to 0..1 against the song's own loud level."""
    ceiling = np.percentile(values, 98)
    return np.clip((values - (ceiling - span)) / span, 0, 1)


def pick_attacks(signal, sample_rate, count, minimum_gap, beats, window=1024):
    """Attacks in a band-limited stem: level rises of at least 6 dB within 50 ms, strength 0 to 1."""
    level = level_decibels(signal, sample_rate, count, window=window)
    loud = np.percentile(level, 98)
    look_back = int(0.05 * RATE)
    rise = np.array([level[index] - level[max(0, index - look_back):index].min() if index else 0
                     for index in range(count)])
    peaks, _ = scipy.signal.find_peaks(rise, distance=max(1, int(minimum_gap * RATE)), height=6)
    attacks = []
    for peak in peaks:
        # The attack peaks within 60 ms; loudness there decides the strength.
        after = level[peak:peak + int(0.06 * RATE) + 1].max()
        value = np.clip((after - (loud - 24)) / 24, 0, 1) * min(1.0, rise[peak] / 18)
        if value < 0.08:
            continue
        time = peak / RATE
        # Snap to a tracked beat within 35 ms; separation and windowing smear attacks slightly.
        nearest = beats[np.argmin(np.abs(beats - time))] if len(beats) else time
        attacks.append({"time": round(float(nearest if abs(nearest - time) < 0.035 else time), 3),
                        "strength": round(float(value), 3)})
    return attacks


def vocal_pitch(vocals, sample_rate, count, vocal_level):
    import torch
    import torchcrepe
    audio = librosa.resample(vocals, orig_sr=sample_rate, target_sr=16000)
    tensor = torch.tensor(audio)[None]
    report("Tracking vocal pitch")
    frequency, periodicity = torchcrepe.predict(tensor, 16000, hop_length=160, fmin=65, fmax=1000, model="full",
                                                return_periodicity=True, batch_size=2048, device="mps")
    frequency = fit_length(frequency[0].cpu().numpy(), count)
    periodicity = fit_length(torchcrepe.filter.median(periodicity, 5)[0].cpu().numpy(), count)
    midi = 69 + 12 * np.log2(np.maximum(frequency, 1) / 440)
    voiced = (periodicity > 0.45) & (vocal_level > np.percentile(vocal_level, 98) - 30)
    midi = scipy.signal.medfilt(np.where(voiced, midi, 0), 5)
    return midi, voiced & (midi > 0)


def transcribe(vocals_path):
    import whisper
    report("Transcribing vocals")
    model = whisper.load_model("medium.en", device="cpu")
    result = model.transcribe(str(vocals_path), word_timestamps=True, language="en",
                              condition_on_previous_text=False)
    return [{"word": word["word"].strip(), "start": round(word["start"], 3), "end": round(word["end"], 3),
             "probability": round(word["probability"], 3)}
            for segment in result["segments"] for word in segment.get("words", [])]


def pitch_classes(other, sample_rate, count):
    hop = 512
    chroma = librosa.feature.chroma_cqt(y=librosa.effects.harmonic(other, margin=2.0), sr=sample_rate, hop_length=hop)
    times = np.arange(chroma.shape[1]) * hop / sample_rate
    grid = np.arange(count) / RATE
    return np.stack([np.interp(grid, times, row) for row in chroma])


def bar_levels(stem_levels, downbeats, duration):
    """Each bar's mean power per stem, in decibels below that stem's loud bars."""
    edges = list(downbeats) + [duration]
    raw = {}
    for stem, levels in stem_levels.items():
        power = 10 ** (levels / 10)
        raw[stem] = np.array([10 * np.log10(np.mean(power[int(start * RATE):max(int(start * RATE) + 1, int(edges[index + 1] * RATE))]) + 1e-12)
                              for index, start in enumerate(downbeats)])
        raw[stem] -= np.percentile(raw[stem], 95)
    return [{"start": round(float(start), 3), "end": round(float(edges[index + 1]), 3),
             **{stem: round(float(values[index]), 1) for stem, values in raw.items()}}
            for index, start in enumerate(downbeats)]


def regular_grid(beats, downbeats, duration):
    """A constant-tempo beat grid fitted to the tracked beats, with the downbeat phase most tracked downbeats agree on.

    Dance music keeps one tempo, but the tracker wobbles and adds stray beats in
    sections without drums. Stray beats closer than 0.6 of a period are dropped, beat
    indices are unwrapped interval by interval (so a slightly wrong first guess of the
    period cannot alias), and a robust line gives the period and phase. When fewer
    than 60 percent of tracked beats sit within 40 ms of the grid, the song is taken
    to change tempo and the tracked beats are kept as they are.
    """
    intervals = np.diff(beats)
    period = np.median(intervals[(intervals > 0.25) & (intervals < 1.0)])
    kept = [beats[0]]
    for time in beats[1:]:
        if time - kept[-1] >= 0.6 * period:
            kept.append(time)
    kept = np.asarray(kept)
    index = np.concatenate([[0], np.cumsum(np.maximum(1, np.round(np.diff(kept) / period)))])
    inside = np.ones(len(kept), bool)
    for _ in range(4):
        period, intercept = np.polyfit(index[inside], kept[inside], 1)
        residual = kept - (intercept + period * index)
        inside = np.abs(residual - np.median(residual[inside])) < 0.06
    if np.mean(np.abs(residual) < 0.04) < 0.6:
        return beats, downbeats, float(60 / np.median(intervals)), False
    first = intercept - np.floor(intercept / period) * period
    grid = np.arange(first, duration, period)
    phase = np.bincount(np.round((downbeats - first) / period).astype(int) % 4, minlength=4).argmax()
    return grid, grid[phase::4], float(60 / period), True


def structure(bars, beats, downbeats, stem_levels, kick_level):
    """Drops, the gaps before them, builds, re-entries and breakdowns.

    A drop is a downbeat where the low end (bass plus kick) arrives in full after a
    hole: `hole` is how far the two bars from the downbeat sit above the quietest of
    the four beats before it, and `lead` is how far they sit above the eight bars
    before. Scores of 0.6 and up are drops; 0.42 to 0.6 are re-entries after a short
    break. Strength scales each song's drops against its own biggest, from 0.5 to 1.
    Levels are decibels against each stem's loud level.
    """
    def relative(values):
        return values - np.percentile(values, 95)

    low = relative(10 * np.log10(10 ** (stem_levels["bass"] / 10) + 10 ** (kick_level / 10)))
    # The instruments without the voice: in a gap the beat and the synths fall away, often under a sung line.
    instruments = relative(10 * np.log10(sum(10 ** (stem_levels[stem] / 10) for stem in ("drums", "bass", "other"))))
    bass = relative(stem_levels["bass"])
    drums = relative(stem_levels["drums"])

    def mean_level(values, start, end):
        first = int(start * RATE)
        return float(10 * np.log10(np.mean(10 ** (values[first:max(first + 1, int(end * RATE))] / 10)) + 1e-12))

    period = float(np.median(np.diff(beats)))
    bar_length = 4 * period
    beat_low = np.array([mean_level(low, time, time + period) for time in beats])
    beat_instruments = np.array([mean_level(instruments, time, time + period) for time in beats])
    candidates = []
    for bar_index, time in enumerate(downbeats):
        if time < 4 * bar_length:
            continue
        arrival = mean_level(low, time, time + 2 * bar_length)
        beat_index = int(np.argmin(np.abs(beats - time)))
        if beat_index < 4:
            continue
        hole = arrival - beat_low[beat_index - 4:beat_index].min()
        lead = arrival - mean_level(low, time - 8 * bar_length, time - period / 2)
        full = mean_level(bass, time, time + bar_length) > -8 and mean_level(drums, time, time + bar_length) > -8
        score = 0.45 * np.clip(hole / 24, 0, 1) + 0.55 * np.clip(lead / 12, 0, 1)
        if full and score >= 0.42:
            candidates.append({"time": float(time), "bar": bar_index, "score": float(score), "arrival": arrival,
                               "beat": beat_index})
    # Keep the strongest candidate within any four bars.
    chosen = []
    for candidate in sorted(candidates, key=lambda entry: -entry["score"]):
        if all(abs(candidate["time"] - other["time"]) > 4 * bar_length - 0.05 for other in chosen):
            chosen.append(candidate)
    chosen.sort(key=lambda entry: entry["time"])
    strongest = max([entry["score"] for entry in chosen if entry["score"] >= 0.6], default=1.0)

    drops, reentries, builds = [], [], []
    for entry in chosen:
        if entry["score"] < 0.6:
            reentries.append({"time": round(entry["time"], 3), "bar": entry["bar"],
                              "strength": round(0.5 * entry["score"] / 0.6, 3)})
            continue
        # The gap: the run of beats just before the drop where the instruments fall
        # at least 6 dB below the bars before it, up to two bars long. The run may end
        # one beat early, since a fill or riser often plays into the drop.
        reference = np.median(beat_instruments[max(0, entry["beat"] - 16):max(1, entry["beat"] - 4)])
        quiet = lambda index: index >= 0 and beat_instruments[index] < reference - 6
        end = entry["beat"] - 1 if quiet(entry["beat"] - 1) else entry["beat"] - 2
        gap_beat = end + 1
        while gap_beat > entry["beat"] - 8 and quiet(gap_beat - 1):
            gap_beat -= 1
        gap_start = float(beats[gap_beat]) if gap_beat <= end else entry["time"]
        drops.append({"time": round(entry["time"], 3), "bar": entry["bar"],
                      "strength": round(0.5 + 0.5 * entry["score"] / strongest, 3), "gap_start": round(gap_start, 3)})
        # The build: bars before the gap where drums play and the bass is held back.
        arrival_bass = mean_level(bass, entry["time"], entry["time"] + bar_length)
        start_bar = entry["bar"]
        while start_bar > 0 and entry["bar"] - start_bar < 16:
            bar = bars[start_bar - 1]
            held_back = mean_level(bass, bar["start"], bar["end"]) < arrival_bass - 6
            playing = mean_level(drums, bar["start"], bar["end"]) > -25
            if bar["start"] >= gap_start - 0.05 or (held_back and playing):
                start_bar -= 1
            else:
                break
        build_start = bars[start_bar]["start"]
        if gap_start - build_start >= 2 * bar_length - 0.05:
            builds.append({"start": round(build_start, 3), "end": round(gap_start, 3), "drop": entry["bar"]})

    breakdowns = []
    for index, bar in enumerate(bars):
        if bar["drums"] < -30 and max(bar["vocals"], bar["other"]) > -12:
            if breakdowns and breakdowns[-1]["end_bar"] == index - 1:
                breakdowns[-1].update(end=bar["end"], end_bar=index)
            else:
                breakdowns.append({"start": bar["start"], "end": bar["end"], "start_bar": index, "end_bar": index})
    breakdowns = [entry for entry in breakdowns if entry["end_bar"] - entry["start_bar"] >= 1]
    return {"drops": drops, "builds": builds, "breakdowns": breakdowns, "reentries": reentries}


STOP_WORDS = set("""a an and are as at be been but by can could did do does don't for from had has have he her here
him his how i i'd i'll i'm i've if in is it it's its just me my no not now of oh on or our out she so than that
the their them then there they this to too up us was we were what when where who why will with would ya yeah you
you'd you'll you're you've your ooh ah uh hey na la da mm hmm whoa yo come get got go gonna wanna let like know say
said one all some more ever never still way thing things""".split())


def anchor_moments(words, sections, beats):
    """The song's anchor: the sung word its drops hang on, or the lead-in to each drop.

    A candidate word is a content word sung at least three times. Each occurrence
    scores 4 when it ends in the last two seconds before a drop, 1 when it is held
    for half a second or more, and 0.5 when it lands within 120 ms of a beat. The
    best word needs a drop-side occurrence or a score of 8. Without one, the anchor
    is the gap before each drop, or the last beat before it when there is no gap.
    Without drops there is no anchor. Returns {kind, word, moments: [{start, end}]}.
    """
    drops = [drop["time"] for drop in sections.get("drops", [])]
    beats = np.asarray(beats)
    occurrences = {}
    for word in words:
        text = "".join(character for character in word["word"].lower() if character.isalpha() or character == "'")
        if len(text) < 3 or text in STOP_WORDS or word.get("probability", 1) < 0.4:
            continue
        occurrences.setdefault(text, []).append(word)
    best = None
    for text, found in occurrences.items():
        if len(found) < 3:
            continue
        score, beside_drop = 0.0, False
        for word in found:
            if any(0 <= drop - word["end"] <= 2.0 for drop in drops):
                score += 4
                beside_drop = True
            if word["end"] - word["start"] >= 0.5:
                score += 1
            if len(beats) and np.min(np.abs(beats - word["start"])) <= 0.12:
                score += 0.5
        if (beside_drop or score >= 8) and (best is None or score > best[0]):
            best = (score, text, found)
    if best:
        return {"kind": "word", "word": best[1],
                "moments": [{"start": word["start"], "end": word["end"]} for word in best[2]]}
    if drops:
        moments = []
        for drop in sections["drops"]:
            start = drop["gap_start"] if drop["gap_start"] < drop["time"] - 0.05 else \
                float(beats[beats < drop["time"] - 0.05][-1]) if np.any(beats < drop["time"] - 0.05) else drop["time"] - 0.5
            moments.append({"start": round(start, 3), "end": round(drop["time"], 3)})
        return {"kind": "lead_in", "word": None, "moments": moments}
    return {"kind": "none", "word": None, "moments": []}


def encode_series(values, lower, upper):
    """Quantize to one byte per frame; the page maps bytes back to lower..upper."""
    scaled = np.clip((np.asarray(values) - lower) / (upper - lower), 0, 1)
    data = np.round(scaled * 255).astype(np.uint8)
    return {"lower": lower, "upper": upper, "data": base64.b64encode(data.tobytes()).decode("ascii")}


def encode_stem(path, destination):
    subprocess.run(["ffmpeg", "-nostdin", "-v", "error", "-y", "-i", str(path), "-c:a", "aac", "-b:a", "192k",
                    "-ar", "44100", "-movflags", "+faststart", str(destination)], check=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("source", type=Path)
    parser.add_argument("--name", required=True)
    parser.add_argument("--work", type=Path, default=DIRECTORY / "work")
    parser.add_argument("--transcribe", action="store_true", help="transcribe again even when words exist")
    parser.add_argument("--output", type=Path, help="directory for performance.json (default performances/NAME)")
    parser.add_argument("--no-stems", action="store_true", help="skip the AAC stem copies")
    parser.add_argument("--refresh", action="store_true",
                        help="recompute the anchor in an existing performance.json without running the models")
    arguments = parser.parse_args()
    if arguments.refresh:
        path = (arguments.output or DIRECTORY / "performances" / arguments.name) / "performance.json"
        document = json.loads(path.read_text())
        document["anchor"] = anchor_moments(document["words"], document["sections"], document["beats"])
        path.write_text(json.dumps(document, separators=(",", ":")))
        report(f"Anchor {document['anchor']['kind']} {document['anchor']['word'] or ''} "
               f"({len(document['anchor']['moments'])} moments)")
        return
    source = arguments.source.resolve()
    output = arguments.output or DIRECTORY / "performances" / arguments.name
    output.mkdir(parents=True, exist_ok=True)
    stem_paths = separate(source, arguments.work)

    report("Tracking beats")
    from beat_this.inference import File2Beats
    beats, downbeats = File2Beats(checkpoint_path="final0", device="mps", dbn=False)(str(source))
    beats, downbeats = np.asarray(beats), np.asarray(downbeats)

    sample_rate = 44100
    stems = {stem: load_mono(path, sample_rate) for stem, path in stem_paths.items()}
    mix = load_mono(source, sample_rate)
    duration = len(mix) / sample_rate
    count = frame_count(duration)
    beats, downbeats, tempo, regular = regular_grid(beats, downbeats, duration)
    report(f"Tempo {tempo:.2f}, {'regular grid' if regular else 'tracked beats'}")
    levels = {stem: level_decibels(signal, sample_rate, count) for stem, signal in stems.items()}

    report("Measuring drums")
    drums = stems["drums"]
    kicks = pick_attacks(band_signal(drums, sample_rate, high=140), sample_rate, count, 0.2, beats)
    claps = pick_attacks(band_signal(drums, sample_rate, low=1200, high=4000), sample_rate, count, 0.3, beats, 512)
    hats = normalize_decibels(level_decibels(band_signal(drums, sample_rate, low=7000), sample_rate, count, 512), 30)

    report("Measuring bass, vocals and other")
    bass = normalize_decibels(level_decibels(stems["bass"], sample_rate, count, 1024), 30)
    vocal_level = levels["vocals"]
    vocal = normalize_decibels(vocal_level, 36)
    midi, voiced = vocal_pitch(stems["vocals"], sample_rate, count, vocal_level)
    other = normalize_decibels(levels["other"], 30)
    other_attack = librosa.onset.onset_strength(y=stems["other"], sr=sample_rate, hop_length=sample_rate // RATE)
    other_attack = fit_length(other_attack / np.percentile(other_attack, 99), count)
    chroma = pitch_classes(stems["other"], sample_rate, count)
    mix_level = normalize_decibels(level_decibels(mix, sample_rate, count), 36)

    bars = bar_levels(levels, downbeats, duration)
    sections = structure(bars, beats, downbeats, levels,
                         level_decibels(band_signal(drums, sample_rate, high=140), sample_rate, count, 1024))
    previous = output / "performance.json"
    words = json.loads(previous.read_text())["words"] if previous.exists() and not arguments.transcribe else \
        transcribe(stem_paths["vocals"])

    voiced_midi = midi[voiced]
    document = {
        "version": 1,
        "name": arguments.name,
        "duration": round(duration, 4),
        "rate": RATE,
        "tempo": round(tempo, 3),
        "beat_grid": "regular" if regular else "tracked",
        "beats": [round(float(value), 3) for value in beats],
        "downbeats": [round(float(value), 3) for value in downbeats],
        "bars": bars,
        "sections": sections,
        "words": words,
        "anchor": anchor_moments(words, sections, beats),
        "kicks": kicks,
        "claps": claps,
        "vocal_range": [round(float(np.percentile(voiced_midi, 5)), 2), round(float(np.median(voiced_midi)), 2),
                        round(float(np.percentile(voiced_midi, 95)), 2)] if len(voiced_midi) else [60, 64, 68],
        "series": {
            "bass": encode_series(bass, 0, 1),
            "vocal": encode_series(vocal, 0, 1),
            "pitch": encode_series(np.where(voiced, midi, 0), 0, 96),
            "hats": encode_series(hats, 0, 1),
            "other": encode_series(other, 0, 1),
            "other_attack": encode_series(np.clip(other_attack, 0, 1), 0, 1),
            "mix": encode_series(mix_level, 0, 1),
            **{f"pitch_class_{index}": encode_series(chroma[index], 0, 1) for index in range(12)},
        },
    }
    (output / "performance.json").write_text(json.dumps(document, separators=(",", ":")))
    if not arguments.no_stems:
        report("Encoding stems")
        for stem, path in stem_paths.items():
            encode_stem(path, output / f"{stem}.m4a")
    report(f"Wrote {output / 'performance.json'}")


if __name__ == "__main__":
    main()
