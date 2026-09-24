#!/usr/bin/env python3
"""Merge three transcriptions of each vocal stem into revised, onset-snapped lyrics.

    python3 tools/lyrics/merge.py <transcripts-dir>

For each song, `<transcripts-dir>/<name>.turbo.json` (large-v3-turbo) is the primary
transcript; `<name>.large.json` (large-v3) and the original `words` in performance.json
(medium.en) vote. A word counts as confirmed when another model heard the same word within
0.35 s. Words sung over a silent vocal stem (hallucinations such as "Thank you.") are
dropped. Word starts move onto the nearest vocal onset within 0.15 s. Corrections that were
checked by hand live in `corrections.json` beside this file ({song: [[start, old, new]]},
where `new` may be "" to delete). Writes `revised/<identifier>.json` and a readable
`revised/<name>.txt`.
"""

import base64
import json
import pathlib
import re
import subprocess
import sys

import librosa
import numpy as np

HERE = pathlib.Path(__file__).resolve().parent
LIBRARY = HERE.parents[1] / "library"
SONGS = {
    "nbly": "5ff86d6cd02ebd7308e03df8",
    "desire": "1d589940ca458d793a3fad8a",
    "ophelia": "f127a026dc751f1528bfb95d",
    "outside": "8eee874c702a10807f79706c",
    "americanboy": "4048d4a6dce44c151690b2b1",
}
SR = 24000


def normal(text):
    return re.sub(r"[^a-z0-9']", "", text.lower())


def series(document, name):
    entry = document["series"][name]
    raw = np.frombuffer(base64.b64decode(entry["data"]), dtype=np.uint8).astype(np.float64)
    return entry["lower"] + raw / 255 * (entry["upper"] - entry["lower"])


def vocal_onsets(identifier):
    raw = subprocess.run(["ffmpeg", "-nostdin", "-v", "error", "-i", str(LIBRARY / identifier / "stems" / "vocals.m4a"),
                          "-ac", "1", "-ar", str(SR), "-f", "f32le", "-"], check=True, capture_output=True).stdout
    vocals = np.frombuffer(raw, dtype=np.float32).astype(np.float64)
    return librosa.onset.onset_detect(y=vocals, sr=SR, hop_length=SR // 100, backtrack=True, units="time", delta=0.04,
                                      wait=5)


def confirmed(word, others):
    key = normal(word["word"])
    middle = (word["start"] + word["end"]) / 2
    votes = 0
    for other in others:
        if any(normal(candidate["word"]) == key and abs((candidate["start"] + candidate["end"]) / 2 - middle) < 0.35
               for candidate in other):
            votes += 1
    return votes


def merge(name, directory, corrections):
    identifier = SONGS[name]
    document = json.loads((LIBRARY / identifier / "performance.json").read_text())
    vocal = series(document, "vocal")
    primary = json.loads((directory / f"{name}.turbo.json").read_text())
    large = json.loads((directory / f"{name}.large.json").read_text())
    original = document["words"]
    onsets = vocal_onsets(identifier)
    words = []
    for word in primary:
        text = word["word"].strip()
        if not normal(text):
            continue
        first, last = int(word["start"] * 100), max(int(word["start"] * 100) + 1, int(word["end"] * 100))
        if vocal[first:last].max() < 0.2:
            continue  # sung over a silent stem: a hallucination
        votes = confirmed(word, (large, original))
        words.append({"text": text, "start": word["start"], "end": word["end"],
                      "probability": round(min(1.0, word["probability"] * (0.6 + 0.2 * votes)), 3), "votes": votes})
    for start, old, new in corrections.get(name, []):
        match = min(words, key=lambda entry: abs(entry["start"] - start) + (0 if normal(entry["text"]) == normal(old) else 5))
        if abs(match["start"] - start) > 0.6 or normal(match["text"]) != normal(old):
            print(f"  correction not found: {name} {start} {old!r}", file=sys.stderr)
            continue
        if new == "":
            words.remove(match)
        else:
            match["text"], match["votes"], match["probability"] = new, 3, 1.0
    # Snap starts to vocal onsets and keep the order.
    for index, word in enumerate(words):
        nearby = onsets[np.abs(onsets - word["start"]) < 0.15]
        if len(nearby):
            snapped = float(nearby[np.argmin(np.abs(nearby - word["start"]))])
            previous = words[index - 1]["start"] + 0.06 if index else 0
            if snapped > previous and snapped < word["end"] - 0.05:
                word["start"] = snapped
    for index, word in enumerate(words[:-1]):
        word["end"] = min(word["end"], words[index + 1]["start"])
        word["end"] = max(word["end"], word["start"] + 0.08)
    # Drop unconfirmed words far from any confirmed word (isolated hallucinations).
    sure = np.array([word["start"] for word in words if word["votes"]])
    words = [word for word in words if word["votes"] or (len(sure) and np.min(np.abs(sure - word["start"])) < 4)]
    # Lines: break at long gaps, sentence punctuation, commas after three words, or a capital
    # after three words; then split any line longer than seven words at its widest gap.
    lines, current = [], []
    for index, word in enumerate(words):
        if current:
            previous = current[-1]
            gap = word["start"] - previous["end"]
            capital = word["text"][:1].isupper() and word["text"] != "I" and not word["text"].startswith("I'")
            if gap > 0.45 or re.search(r"[.?!]$", previous["text"]) or \
                    (re.search(r",$", previous["text"]) and len(current) >= 3) or (capital and len(current) >= 3):
                lines.append(current)
                current = []
        current.append(word)
    if current:
        lines.append(current)
    def split(line):
        if len(line) <= 7:
            return [line]
        gaps = [(line[index]["start"] - line[index - 1]["end"] + (0.3 if re.search(r"[,;]$", line[index - 1]["text"]) else 0), index)
                for index in range(2, len(line) - 1)]
        _, cut = max(gaps)
        return split(line[:cut]) + split(line[cut:])
    lines = [part for line in lines for part in split(line)]
    for number, line in enumerate(lines):
        for word in line:
            word["line"] = number
    anchor = document["anchor"]
    key = normal(anchor["word"]) if anchor["kind"] == "word" else None
    revised = [{"text": word["text"], "start": round(word["start"], 3), "end": round(word["end"], 3),
                "probability": word["probability"], "votes": word["votes"], "line": word["line"],
                **({"key": True} if key and normal(word["text"]).rstrip("s") == key.rstrip("s") else {})}
               for word in words]
    output = HERE / "revised"
    output.mkdir(exist_ok=True)
    (output / f"{identifier}.json").write_text(json.dumps(revised, separators=(",", ":")))
    lines = {}
    for word in revised:
        lines.setdefault(word["line"], []).append(word)
    with open(output / f"{name}.txt", "w") as handle:
        for number, entries in lines.items():
            stamp = entries[0]["start"]
            text = " ".join(entry["text"] if entry["votes"] else f"({entry['text']})" for entry in entries)
            handle.write(f"{int(stamp // 60)}:{stamp % 60:05.2f}  {text}\n")
    print(f"{name}: {len(revised)} words, {sum(1 for w in revised if w['votes'])} confirmed, "
          f"{sum(1 for w in revised if w.get('key'))} anchor words", file=sys.stderr)


def main():
    directory = pathlib.Path(sys.argv[1])
    corrections_path = HERE / "corrections.json"
    corrections = json.loads(corrections_path.read_text()) if corrections_path.exists() else {}
    for name in (sys.argv[2:] or SONGS):
        merge(name, directory, corrections)


if __name__ == "__main__":
    main()
