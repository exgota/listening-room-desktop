#!/usr/bin/env python3
"""The same server as ../../server.py, for testing: another port, another built page, and
optionally MP3 copies of the audio, because headless Chromium has no AAC decoder.

    python3 tools/render/test_server.py --port 8081 --page site/dist-dev/page.html --mp3

MP3 copies are made once with ffmpeg into tools/render/.cache/ (not committed).
"""
import argparse
import pathlib
import subprocess
import sys

HERE = pathlib.Path(__file__).resolve().parent
ROOT = HERE.parents[1]
sys.path.insert(0, str(ROOT))
import server  # noqa: E402

CACHE = HERE / ".cache"


def mp3_copy(source):
    CACHE.mkdir(exist_ok=True)
    target = CACHE / (source.parent.name + ".mp3" if source.name == "playback.m4a" else
                      f"{source.parent.parent.name}-{source.stem}.mp3")
    if not target.exists() or target.stat().st_mtime < source.stat().st_mtime:
        subprocess.run(["ffmpeg", "-nostdin", "-v", "error", "-y", "-i", str(source), "-c:a", "libmp3lame", "-b:a", "192k",
                        str(target)], check=True)
    return target


class Handler(server.Handler):
    mp3 = False

    def send_file(self, path, download_name=None):
        if self.mp3 and path.suffix == ".m4a":
            path = mp3_copy(path)
        return super().send_file(path, download_name)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--port", type=int, default=8081)
    parser.add_argument("--page", default=str(ROOT / "site" / "dist" / "page.html"))
    parser.add_argument("--mp3", action="store_true")
    arguments = parser.parse_args()
    server.PAGE = pathlib.Path(arguments.page).resolve()
    server.TYPES[".mp3"] = "audio/mpeg"
    Handler.mp3 = arguments.mp3
    with server.Server(("127.0.0.1", arguments.port), Handler) as httpd:
        print(f"http://127.0.0.1:{arguments.port}/ page={server.PAGE} mp3={arguments.mp3}", flush=True)
        httpd.serve_forever()
