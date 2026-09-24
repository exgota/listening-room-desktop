"""Fine view of every drop: waveforms of mix, drums, bass in a 400 ms window at 1 ms, grid and candidates."""
import sys, json, subprocess, numpy as np
import matplotlib; matplotlib.use("Agg"); import matplotlib.pyplot as plt
from perf import SONGS, LIB, mmss
SR = 24000
def decode(path, start, dur):
    raw = subprocess.run(["ffmpeg", "-nostdin", "-v", "error", "-ss", f"{start:.3f}", "-t", f"{dur:.3f}", "-i", str(path), "-ac", "1", "-ar", str(SR), "-f", "f32le", "-"], check=True, capture_output=True).stdout
    return np.frombuffer(raw, dtype=np.float32)
rows = []
for name, ident in SONGS.items():
    p = json.loads((LIB / ident / "performance.json").read_text())
    for d in p["visual"]["drops"]:
        rows.append((name, ident, p, d))
fig, axes = plt.subplots(len(rows), 1, figsize=(19.2, 1.9 * len(rows)))
fig.subplots_adjust(left=0.02, right=0.995, top=0.99, bottom=0.02, hspace=0.45)
for ax, (name, ident, p, d) in zip(axes, rows):
    v = p["visual"]
    t0 = d["time"] - 0.25; dur = 0.45
    for stem, col, off in (("playback", "#000", 2.2), ("stems/drums", "#27f", 1.1), ("stems/bass", "#e22", 0.0)):
        path = LIB / ident / (stem + ".m4a")
        x = decode(path, t0, dur)
        x = x / (np.abs(x).max() + 1e-9)
        ax.plot(t0 + np.arange(len(x)) / SR, off + 0.5 * x, color=col, lw=0.3)
    for b in v["beats"]:
        if t0 <= b <= t0 + dur: ax.axvline(b, color="#999", lw=1, ls=":")
    for k, s in v["kick"]:
        if t0 <= k <= t0 + dur: ax.axvline(k, ymin=0, ymax=0.1, color="#27f", lw=3)
    ax.axvline(d["time"], color="#0c0", lw=1.5)
    ax.set_xlim(t0, t0 + dur); ax.set_yticks([])
    ax.set_xticks(np.arange(np.ceil(t0 * 50) / 50, t0 + dur, 0.02)); ax.tick_params(labelsize=6, pad=1)
    ax.set_title(f"{name} refined drop {d['time']:.3f} ({mmss(d['time'])}); dotted = corrected beats; blue ticks = kicks", fontsize=8, loc="left", pad=2)
fig.savefig(sys.argv[1], dpi=100)
