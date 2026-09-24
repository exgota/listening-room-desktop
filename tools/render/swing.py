"""Histogram of onset phase within the beat per drum band, to measure swing and the pocket."""
import sys, pathlib, numpy as np, librosa, soundfile, scipy.signal
from perf import load, mmss
name, wavdir = sys.argv[1], pathlib.Path(sys.argv[2])
p = load(name)
res = 24
for stem, bands in (("drums", {"kick": (None, 140), "snare": (1200, 4000), "hat": (7000, None)}), ("bass", {"bass": (None, 300)}), ("other", {"other": (None, None)}), ("vocals", {"vocals": (None, None)})):
    y, sr = soundfile.read(wavdir / p["_id"] / f"{stem}.wav")
    for bname, (lo, hi) in bands.items():
        x = y
        if lo and hi: x = scipy.signal.sosfiltfilt(scipy.signal.butter(4, [lo, hi], btype="bandpass", fs=sr, output="sos"), y)
        elif hi: x = scipy.signal.sosfiltfilt(scipy.signal.butter(4, hi, btype="lowpass", fs=sr, output="sos"), y)
        elif lo: x = scipy.signal.sosfiltfilt(scipy.signal.butter(4, lo, btype="highpass", fs=sr, output="sos"), y)
        on = librosa.onset.onset_detect(y=x, sr=sr, hop_length=128, units="time", backtrack=False, delta=0.1)
        beats = np.array(p["beats"])
        hist = np.zeros(res)
        for t in on:
            i = np.searchsorted(beats, t) - 1
            if i < 0 or i >= len(beats) - 1: continue
            ph = (t - beats[i]) / (beats[i + 1] - beats[i])
            hist[int(ph * res) % res] += 1
        hist /= hist.max() + 1e-9
        chars = " .:-=+*#%@"
        print(f"{bname:>7} n={len(on):5d} |" + "".join(chars[min(9, int(v * 10))] for v in hist) + "|  (24 bins per beat; 0=beat, 6=16th, 12=8th, 18=16th)")
