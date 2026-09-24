import sys, numpy as np
from perf import load, mmss
NOTES = "C C# D D# E F F# G G# A A# B".split()
p = load(sys.argv[1]); S = p["_series"]; per = int(sys.argv[2]) if len(sys.argv) > 2 else 4
bars = p["bars"]
chroma = np.stack([S[f"pitch_class_{i}"] for i in range(12)])
kt = np.array([k["time"] for k in p["kicks"]]); ks = np.array([k["strength"] for k in p["kicks"]])
ct = np.array([k["time"] for k in p["claps"]])
wt = np.array([w["start"] for w in p["words"] if w["probability"] >= 0.5])
sec = p["sections"]
def tag(t0, t1):
    tags = []
    for b in sec["builds"]:
        if b["start"] < t1 and b["end"] > t0: tags.append("BUILD")
    for b in sec["breakdowns"]:
        if b["start"] < t1 and b["end"] > t0: tags.append("BRKDN")
    for d in sec["drops"]:
        if t0 <= d["time"] < t1: tags.append(f"DROP@{mmss(d['time'])}")
    for d in sec.get("reentries", []):
        if t0 <= d["time"] < t1: tags.append(f"re@{mmss(d['time'])}")
    return " ".join(tags)
print(f"{'bar':>4} {'time':>8}  voc  drm  bas  oth | k/b  c/b  hat  mix | chord-ish          | words | tags")
for i in range(0, len(bars), per):
    grp = bars[i:i + per]
    t0, t1 = grp[0]["start"], grp[-1]["end"]
    f0, f1 = int(t0 * 100), int(t1 * 100)
    lv = {s: np.mean([b[s] for b in grp]) for s in ("vocals", "drums", "bass", "other")}
    nk = np.sum((kt >= t0) & (kt < t1)) / len(grp); nc = np.sum((ct >= t0) & (ct < t1)) / len(grp)
    hat = S["hats"][f0:f1].mean(); mix = S["mix"][f0:f1].mean()
    cm = chroma[:, f0:f1].mean(axis=1); top = np.argsort(-cm)[:3]
    ch = " ".join(f"{NOTES[j]}{cm[j]:.2f}" for j in top)
    nw = np.sum((wt >= t0) & (wt < t1))
    print(f"{i:>4} {mmss(t0):>8} {lv['vocals']:5.0f}{lv['drums']:5.0f}{lv['bass']:5.0f}{lv['other']:5.0f} | {nk:3.1f}  {nc:3.1f}  {hat:.2f} {mix:.2f} | {ch:18s} | {nw:3d}   | {tag(t0,t1)}")
