"""Shared loader for performance.json: decodes the series into numpy arrays."""
import base64, json, pathlib
import numpy as np

ROOT = pathlib.Path(__file__).resolve().parents[2]
LIB = ROOT / "library"
SONGS = {
    "nbly": "5ff86d6cd02ebd7308e03df8",
    "desire": "1d589940ca458d793a3fad8a",
    "ophelia": "f127a026dc751f1528bfb95d",
    "outside": "8eee874c702a10807f79706c",
    "americanboy": "4048d4a6dce44c151690b2b1",
}


def load(name):
    ident = SONGS.get(name, name)
    p = json.loads((LIB / ident / "performance.json").read_text())
    series = {}
    for key, s in p["series"].items():
        raw = np.frombuffer(base64.b64decode(s["data"]), dtype=np.uint8).astype(np.float64)
        series[key] = s["lower"] + raw / 255 * (s["upper"] - s["lower"])
    p["_series"] = series
    p["_id"] = ident
    return p


def mmss(t):
    return f"{int(t // 60)}:{t % 60:05.2f}"
