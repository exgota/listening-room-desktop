"""Fold drum-stem band onset envelopes onto the bar grid to read the groove pattern."""
import sys, pathlib, numpy as np, librosa, soundfile, scipy.signal
from perf import load, mmss
name, wavdir = sys.argv[1], pathlib.Path(sys.argv[2])
group = int(sys.argv[3]) if len(sys.argv) > 3 else 8
steps = int(sys.argv[4]) if len(sys.argv) > 4 else 16
p = load(name)
y, sr = soundfile.read(wavdir / p["_id"] / "drums.wav")
hop = 110  # 5 ms
def band(lo, hi):
    if lo and hi: sos = scipy.signal.butter(4, [lo, hi], btype="bandpass", fs=sr, output="sos")
    elif hi: sos = scipy.signal.butter(4, hi, btype="lowpass", fs=sr, output="sos")
    else: sos = scipy.signal.butter(4, lo, btype="highpass", fs=sr, output="sos")
    x = scipy.signal.sosfiltfilt(sos, y)
    env = librosa.feature.rms(y=x, frame_length=512, hop_length=hop)[0]
    db = 20 * np.log10(env + 1e-9)
    on = np.maximum(0, np.diff(db, prepend=db[0]))
    on = np.convolve(on, np.ones(3), "same")
    return on / (np.percentile(on, 99.5) + 1e-9)
bands = {"kick": band(None, 140), "snare": band(1200, 4000), "hat": band(7000, None)}
fps = sr / hop
db = np.array(p["downbeats"])
chars = " .:-=+*#%@"
for g in range(0, len(db) - 1, group):
    idx = list(range(g, min(g + group, len(db) - 1)))
    t0 = db[idx[0]]
    lines = []
    for bname, env in bands.items():
        acc = np.zeros(steps)
        for b in idx:
            a, e = db[b], db[b + 1]
            for s in range(steps):
                c = a + (e - a) * s / steps
                w = (e - a) / steps / 2
                f0, f1 = int((c - w * 0.5) * fps), int((c + w * 0.5) * fps) + 1
                seg = env[max(0,f0):min(len(env),f1)]; acc[s] += seg.max() if len(seg) else 0
        acc /= len(idx)
        lines.append(bname[0] + "|" + "".join(chars[min(9, int(v * 12))] for v in acc) + "|")
    print(f"{mmss(t0):>8} " + "  ".join(lines))
