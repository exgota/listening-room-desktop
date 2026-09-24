"""Close-up of each drop: mix spectrogram and stem envelopes at 1 ms, with grid and listed times."""
import sys, numpy as np, soundfile, librosa
import matplotlib; matplotlib.use("Agg"); import matplotlib.pyplot as plt
from perf import load, mmss
SCR = sys.argv[1]; out = sys.argv[2]
rows = []
for name in ["nbly", "desire", "ophelia", "outside", "americanboy"]:
    p = load(name)
    for d in p["sections"]["drops"]:
        rows.append((name, p, d))
fig, axes = plt.subplots(len(rows), 2, figsize=(19.2, 2.1 * len(rows)), gridspec_kw={"width_ratios": [1, 1]})
fig.subplots_adjust(left=0.03, right=0.995, top=0.995, bottom=0.01, hspace=0.35, wspace=0.05)
cache = {}
for r, (name, p, d) in enumerate(rows):
    if p["_id"] not in cache:
        cache[p["_id"]] = {s: soundfile.read(f"{SCR}/wav/{p['_id']}/{s}.wav")[0] for s in ("mix", "drums", "bass", "vocals")}
    W = cache[p["_id"]]; sr = 22050
    t0, t1 = d["time"] - 1.2, d["time"] + 0.6
    a, b = int(t0 * sr), int(t1 * sr)
    S = librosa.amplitude_to_db(np.abs(librosa.stft(W["mix"][a:b], n_fft=1024, hop_length=64)), ref=np.max)
    ax = axes[r, 0]
    ax.imshow(S[:200], aspect="auto", origin="lower", extent=[t0, t1, 0, 200], cmap="magma", vmin=-60, vmax=0)
    ax.set_title(f"{name} drop {mmss(d['time'])}  gap_start {mmss(d['gap_start'])}", fontsize=8, loc="left", pad=2)
    ax2 = axes[r, 1]
    hop = sr // 1000
    for s, col in (("drums", "#27f"), ("bass", "#e22"), ("vocals", "#2a2"), ("mix", "#000")):
        x = W[s][a:b]; e = x[: len(x) // hop * hop] ** 2
        e = 10 * np.log10(np.convolve(e.reshape(-1, hop).mean(1), np.ones(3) / 3, "same") + 1e-10)
        ax2.plot(t0 + np.arange(len(e)) / 1000, e, color=col, lw=0.7)
    ax2.set_ylim(-70, 0); ax2.set_xlim(t0, t1)
    for axx in (ax, ax2):
        for bt in p["beats"]:
            if t0 <= bt <= t1: axx.axvline(bt, color="#bbb" if axx is ax2 else "#fff", lw=0.5, alpha=0.6)
        for k in p["kicks"]:
            if t0 <= k["time"] <= t1: axx.axvline(k["time"], ymin=0, ymax=0.08, color="#0af", lw=2)
        axx.axvline(d["time"], color="#0f0", lw=1.2)
        axx.axvline(d["gap_start"], color="#0f0", lw=1.2, ls="--")
        axx.set_xticks(np.arange(np.ceil(t0 * 10) / 10, t1, 0.1)); axx.tick_params(labelsize=5, pad=1)
        axx.set_yticks([])
fig.savefig(out, dpi=100)
