#!/usr/bin/env python3
"""Serves the desktop listening room locally from ./library, with no backend services.

    python3 server.py            # http://127.0.0.1:8080/
    python3 server.py --port 9000

Routes match the published site's read-only interface:
  /, /library, /track/<id>         the page (build it first: cd site && node build.mjs)
  /api/tracks                      the track list
  /audio/<id>, /stream/<id>        the song (the prepared AAC copy); ?download adds an attachment header
  /analysis/<id>                   40-band spectrum analysis at 20 frames per second
  /performance/<id>                stem performance analysis (performance.json)
  /stems/<id>/<stem>.m4a           separated stems: vocals, drums, bass, other
  /artwork/...                     icons
Uploads, edits and the multi-track zip are not part of this copy.
"""

import argparse
import html
import http.server
import json
import pathlib
import re
import socketserver

ROOT = pathlib.Path(__file__).resolve().parent
LIBRARY = ROOT / "library"
PAGE = ROOT / "site" / "dist" / "page.html"
ARTWORK = {
    "/artwork/cover-512.png": ROOT / "site" / "assets" / "cover-artwork-512.png",
    "/artwork/cover-1024.png": ROOT / "site" / "assets" / "cover-artwork-1024.png",
    "/artwork/home-screen-icon-180.png": ROOT / "site" / "assets" / "home-screen-icon-180.png",
}
TYPES = {".m4a": "audio/mp4", ".json": "application/json", ".png": "image/png"}


def records():
    entries = [json.loads(path.read_text()) for path in LIBRARY.glob("*/record.json")]
    return sorted(entries, key=lambda record: -(record.get("created_at") or 0))


def public(record):
    identifier = record["identifier"]
    return {
        **record,
        "url": f"/audio/{identifier}",
        "link": f"/track/{identifier}",
        "public_url": f"/track/{identifier}",
        "streaming": f"/api/stream/{identifier}",
        "playback_url": f"/stream/{identifier}",
        "analysis_url": f"/analysis/{identifier}",
        "performance_url": f"/performance/{identifier}",
        "stems": {stem: f"/stems/{identifier}/{stem}.m4a" for stem in ("vocals", "drums", "bass", "other")},
    }


class Handler(http.server.BaseHTTPRequestHandler):
    def send_bytes(self, body, content_type, status=200, extra=None):
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        for key, value in (extra or {}).items():
            self.send_header(key, value)
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(body)

    def send_file(self, path, download_name=None):
        size = path.stat().st_size
        start, end, status = 0, size - 1, 200
        requested = re.fullmatch(r"bytes=(\d*)-(\d*)", self.headers.get("Range", ""))
        if requested and any(requested.groups()):
            first, last = requested.groups()
            start = int(first) if first else max(0, size - int(last))
            end = min(int(last), size - 1) if first and last else size - 1
            status = 206
        self.send_response(status)
        self.send_header("Content-Type", TYPES.get(path.suffix, "application/octet-stream"))
        self.send_header("Content-Length", str(end - start + 1))
        self.send_header("Accept-Ranges", "bytes")
        if status == 206:
            self.send_header("Content-Range", f"bytes {start}-{end}/{size}")
        if download_name:
            self.send_header("Content-Disposition", f'attachment; filename="{download_name}"')
        self.end_headers()
        if self.command == "HEAD":
            return
        with path.open("rb") as stream:
            stream.seek(start)
            remaining = end - start + 1
            try:
                while remaining:
                    chunk = stream.read(min(65536, remaining))
                    if not chunk:
                        break
                    self.wfile.write(chunk)
                    remaining -= len(chunk)
            except (BrokenPipeError, ConnectionResetError):
                pass

    def do_HEAD(self):
        self.do_GET()

    def do_GET(self):
        path, _, query = self.path.partition("?")
        tracks = records()
        if path in ARTWORK:
            return self.send_file(ARTWORK[path])
        if path == "/api/tracks":
            return self.send_bytes(json.dumps([public(record) for record in tracks]).encode(), "application/json")
        stem = re.fullmatch(r"/stems/([a-f0-9]{24})/(vocals|drums|bass|other)\.m4a", path)
        if stem:
            return self.send_file(LIBRARY / stem[1] / "stems" / f"{stem[2]}.m4a")
        match = re.fullmatch(r"/(audio|stream|analysis|performance|api/stream|track)/([a-f0-9]{24})", path)
        record = next((entry for entry in tracks if match and entry["identifier"] == match[2]), None)
        if match and match[1] != "track":
            if not record:
                return self.send_bytes(b'{"error":"Not found"}', "application/json", 404)
            folder = LIBRARY / record["identifier"]
            if match[1] == "api/stream":
                return self.send_bytes(json.dumps({"url": f"/stream/{record['identifier']}"}).encode(), "application/json")
            if match[1] in ("audio", "stream"):
                name = re.sub(r"\.[^.]+$", ".m4a", record.get("name", "track.m4a"))
                return self.send_file(folder / "playback.m4a", name if "download" in query else None)
            return self.send_file(folder / f"{match[1]}.json")
        if path not in ("/", "/library") and not match:
            return self.send_bytes(b'{"error":"Not found"}', "application/json", 404)
        title = record["title"] if record else ("Library · Listening room" if path == "/library" else "Listening room")
        page = PAGE.read_text().replace("__PAGE_METADATA__", f"<title>{html.escape(title)}</title>")
        return self.send_bytes(page.encode(), "text/html; charset=utf-8", 404 if match and not record else 200)

    def log_message(self, format, *arguments):
        pass


class Server(socketserver.ThreadingMixIn, http.server.HTTPServer):
    daemon_threads = True


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--port", type=int, default=8080)
    arguments = parser.parse_args()
    with Server(("127.0.0.1", arguments.port), Handler) as server:
        print(f"http://127.0.0.1:{arguments.port}/", flush=True)
        server.serve_forever()
