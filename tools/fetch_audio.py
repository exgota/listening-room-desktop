#!/usr/bin/env python3
"""Downloads each song's mix from the published Listening room into library/<id>/playback.m4a.

The light copy of this folder ships without audio. Run this once, then separate
stems with tools/prepare_performance.py if stems are needed:

    python3 tools/fetch_audio.py
"""

import pathlib
import subprocess

ROOT = pathlib.Path(__file__).resolve().parent.parent
PUBLISHED = "https://listening-room.exgota.chatgpt.site"

for folder in sorted((ROOT / "library").iterdir()):
    target = folder / "playback.m4a"
    if target.exists():
        continue
    # The site refuses Python's default user agent, so curl does the transfer.
    subprocess.run(["curl", "-sfL", f"{PUBLISHED}/stream/{folder.name}", "-o", str(target)], check=True)
    print(folder.name, target.stat().st_size // 1_000_000, "MB")
