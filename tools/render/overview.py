"""Per-song overview: mel spectrogram, stem levels, events and sections, 60 s per row."""
import sys, pathlib
import numpy as np, librosa, soundfile
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from perf import load, SONGS, mmss

name, wavdir, out = sys.argv[1], pathlib.Path(sys.argv[2]), sys.argv[3]
row_seconds = float(sys.argv[4]) if len(sys.argv) > 4 else 60
p = load(name)
S = p["_series"]
y, sr = soundfile.read(wavdir / p["_id"] / "mix.wav")
mel = librosa.power_to_db(librosa.feature.melspectrogram(y=y, sr=sr, n_mels=64, hop_length=441, fmax=11000), ref=np.max)
dur = p["duration"]
rows = int(np.ceil(dur / row_seconds))
fig, axes = plt.subplots(rows * 3, 1, figsize=(19.2, rows * 3.0), gridspec_kw={"height_ratios": [1.2, 1.0, 0.5] * rows})
fig.subplots_adjust(left=0.02, right=0.995, top=0.99, bottom=0.01, hspace=0.05)
sec = p["sections"]
for r in range(rows):
    t0, t1 = r * row_seconds, min(dur, (r + 1) * row_seconds)
    a_sp, a_st, a_ev = axes[r * 3], axes[r * 3 + 1], axes[r * 3 + 2]
    f0, f1 = int(t0 * 50), int(t1 * 50)
    a_sp.imshow(mel[:, f0:f1], aspect="auto", origin="lower", extent=[t0, t1, 0, 64], cmap="magma", vmin=-70, vmax=0)
    a_sp.set_xlim(t0, t0 + row_seconds); a_sp.set_yticks([]); a_sp.set_xticks([])
    a_sp.text(t0 + 0.3, 58, mmss(t0), color="white", fontsize=9, va="top")
    tt = np.arange(len(S["vocal"])) / 100
    m = (tt >= t0) & (tt < t1)
    for key, col, off in [("vocal", "#e23", 3), ("bass", "#27f", 2), ("other", "#2a2", 1), ("hats", "#aa0", 0)]:
        a_st.fill_between(tt[m], off, off + 0.9 * S[key][m], color=col, lw=0)
    pitch = S["pitch"][m]
    pm = pitch > 0
    a_st.scatter(tt[m][pm], 3 + (pitch[pm] - 45) / 40, s=0.3, c="k")
    a_st.set_xlim(t0, t0 + row_seconds); a_st.set_ylim(0, 4); a_st.set_yticks([]); a_st.set_xticks([])
    for b in p["beats"]:
        if t0 <= b < t1: a_ev.axvline(b, 0.0, 0.15, color="#999", lw=0.5)
    for b in p["downbeats"]:
        if t0 <= b < t1: a_ev.axvline(b, 0.0, 0.3, color="#000", lw=0.8)
    for k in p["kicks"]:
        if t0 <= k["time"] < t1: a_ev.plot([k["time"]] * 2, [0.35, 0.35 + 0.3 * k["strength"]], color="#27f", lw=1)
    for k in p["claps"]:
        if t0 <= k["time"] < t1: a_ev.plot([k["time"]] * 2, [0.68, 0.68 + 0.3 * k["strength"]], color="#e80", lw=1)
    for bd in sec["breakdowns"]:
        a_sp.axvspan(bd["start"], bd["end"], ymin=0.93, ymax=1, color="#0cf", alpha=0.9)
    for bd in sec["builds"]:
        a_sp.axvspan(bd["start"], bd["end"], ymin=0.93, ymax=1, color="#f0c", alpha=0.9)
    for d in sec["drops"]:
        for ax in (a_sp, a_st, a_ev): ax.axvline(d["time"], color="#0f0", lw=2)
        a_sp.axvspan(d["gap_start"], d["time"], color="#0f0", alpha=0.25)
    for d in sec.get("reentries", []):
        for ax in (a_sp,): ax.axvline(d["time"], color="#ff0", lw=1.5, ls="--")
    for w in p["words"]:
        if t0 <= w["start"] < t1:
            a_st.text(w["start"], 3.95, w["word"], fontsize=6, rotation=90, va="top",
                      color="k" if w["probability"] >= 0.5 else "#aaa")
    for mo in p["anchor"]["moments"]:
        a_st.axvspan(mo["start"], mo["end"], color="#f0c", alpha=0.35)
    a_ev.set_xlim(t0, t0 + row_seconds); a_ev.set_ylim(0, 1); a_ev.set_yticks([])
    a_ev.set_xticks(np.arange(np.ceil(t0 / 5) * 5, t1, 5)); a_ev.tick_params(labelsize=7, pad=1)
fig.savefig(out, dpi=100)
