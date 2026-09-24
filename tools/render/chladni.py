"""Previews Chladni figures as the Plate visualizer draws them (nodal lines of two mixed
modes with a symmetry), one row per set, for choosing a song's figures.

    python3 tools/render/chladni.py out.png "label|n,m,s,second,n2,m2|n,m,..." "row 2|..."

A negative n draws m concentric rings (the key word's figure).
"""
import sys, numpy as np, matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
def field(x, y, n, m, s, second, n2, m2):
    a = np.pi
    if n < 0: return np.cos(m * a * np.hypot(x, y))
    f = np.cos(n*a*x)*np.cos(m*a*y) - s*np.cos(m*a*x)*np.cos(n*a*y)
    e = np.cos(n2*a*x)*np.cos(m2*a*y) - s*np.cos(m2*a*x)*np.cos(n2*a*y)
    return f + second * e
g = np.linspace(-0.5, 0.5, 300); X, Y = np.meshgrid(g, g)
rows = [r.split("|") for r in sys.argv[2:]]
cols = max(len(r) - 1 for r in rows)
fig, axes = plt.subplots(len(rows), cols, figsize=(cols * 1.25, len(rows) * 1.35), squeeze=False)
for r, row in enumerate(rows):
    for c in range(cols):
        ax = axes[r][c]; ax.set_xticks([]); ax.set_yticks([]); ax.set_aspect("equal")
        if c + 1 < len(row):
            n, m, s, sec, n2, m2 = map(float, row[c + 1].split(","))
            ax.contour(X, Y, field(X, Y, n, m, s, sec, n2, m2), levels=[0], colors="k", linewidths=1.4)
            ax.set_title(f"{row[0]} {row[c+1]}", fontsize=4.5)
plt.tight_layout(); plt.savefig(sys.argv[1], dpi=110)
