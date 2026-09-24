"""Sync strip: the mix spectrogram of a window above the frames rendered at 10 fps, aligned.

    python3 strip.py --song nbly --center 138.154 --frames DIR --prefix nbly-rig --out /tmp/strips/nbly-drop1

Frames must exist for every 0.1 s from center-2 to center+2 (render.mjs --from --to --fps 10;
names <prefix>_<time>.png). Writes one 960 px image per second of the window
(<out>_1.png .. _4.png): spectrogram (0-8 kHz, log) with beats (grey), kicks (blue ticks),
snares (orange ticks) and drops/gaps (green) marked, and under it the ten frames of that second,
each in the column of time it starts.
"""
import argparse, json, pathlib, subprocess, sys
import numpy as np, librosa
from PIL import Image, ImageDraw, ImageFont
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from perf import SONGS, LIB

parser = argparse.ArgumentParser()
parser.add_argument("--song", required=True)
parser.add_argument("--center", type=float, required=True)
parser.add_argument("--frames", required=True)
parser.add_argument("--prefix", required=True)
parser.add_argument("--out", required=True)
parser.add_argument("--span", type=float, default=2.0)
arguments = parser.parse_args()
ident = SONGS.get(arguments.song, arguments.song)
performance = json.loads((LIB / ident / "performance.json").read_text())
visual = performance.get("visual", {})
start, end = arguments.center - arguments.span, arguments.center + arguments.span
sr = 24000
raw = subprocess.run(["ffmpeg", "-nostdin", "-v", "error", "-ss", f"{max(0, start):.3f}", "-t", f"{end - max(0, start):.3f}",
                      "-i", str(LIB / ident / "playback.m4a"), "-ac", "1", "-ar", str(sr), "-f", "f32le", "-"],
                     check=True, capture_output=True).stdout
audio = np.frombuffer(raw, dtype=np.float32)
hop = 60  # 2.5 ms columns
spectrum = librosa.amplitude_to_db(np.abs(librosa.stft(audio, n_fft=1024, hop_length=hop)), ref=np.max)
spectrum = spectrum[: int(8000 / (sr / 1024))][::-1]
try:
    font = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf", 11)
except OSError:
    font = ImageFont.load_default()
width, spec_h = 960, 200
seconds = int(round(end - start))
outputs = []
for second in range(seconds):
    s0 = start + second
    s1 = s0 + 1
    c0, c1 = int((s0 - max(0, start)) * sr / hop), int((s1 - max(0, start)) * sr / hop)
    block = spectrum[:, max(0, c0):max(c0 + 1, c1)]
    norm = np.clip((block + 70) / 70, 0, 1)
    rgb = (np.stack([norm ** 0.8, norm ** 2.2, norm ** 4 * 0.6 + norm * 0.2], axis=-1) * 255).astype(np.uint8)
    spec = Image.fromarray(rgb).resize((width, spec_h), Image.BILINEAR)
    frame_w = width // 10
    frame_h = round(frame_w * 9 / 16)
    image = Image.new("RGB", (width, spec_h + 16 + frame_h + 16), (25, 25, 25))
    image.paste(spec, (0, 16))
    draw = ImageDraw.Draw(image)
    x_of = lambda t: int((t - s0) / (s1 - s0) * width)
    for beat in visual.get("beats", performance["beats"]):
        if s0 <= beat < s1:
            draw.line([(x_of(beat), 16), (x_of(beat), 16 + spec_h)], fill=(150, 150, 150), width=1)
    for kick, strength in visual.get("kick", []):
        if s0 <= kick < s1:
            draw.line([(x_of(kick), 16 + spec_h - 18), (x_of(kick), 16 + spec_h)], fill=(60, 140, 255), width=3)
    for snare, strength in visual.get("snare", []):
        if s0 <= snare < s1 and strength > 0.4:
            draw.line([(x_of(snare), 16 + spec_h - 36), (x_of(snare), 16 + spec_h - 20)], fill=(255, 150, 40), width=3)
    for drop in visual.get("drops", []):
        for t, color in ((drop["gap_start"], (80, 255, 80)), (drop["time"], (0, 255, 0))):
            if s0 <= t < s1:
                draw.line([(x_of(t), 16), (x_of(t), 16 + spec_h + frame_h + 16)], fill=color, width=2)
    for tick in range(11):
        t = s0 + tick / 10
        draw.line([(x_of(t), 12), (x_of(t), 16)], fill=(220, 220, 220))
    draw.text((3, 1), f"{arguments.song}  {int(s0 // 60)}:{s0 % 60:06.3f} - {int(s1 // 60)}:{s1 % 60:06.3f}   (ticks 0.1 s; grey beats, blue kicks, orange snares, green gap/drop)", fill=(230, 230, 230), font=font)
    for index in range(10):
        t = round(s0 + index / 10, 3)
        name = f"{arguments.prefix}_{str(int(np.floor(t + 1e-9))).zfill(4)}{('%.3f' % (t % 1))[1:]}.png"
        path = pathlib.Path(arguments.frames) / name
        if path.exists():
            frame = Image.open(path).convert("RGB").resize((frame_w, frame_h), Image.LANCZOS)
            image.paste(frame, (index * frame_w, 16 + spec_h + 16))
        draw.text((index * frame_w + 2, 16 + spec_h + 2), f"{t % 60:05.2f}", fill=(230, 230, 230), font=font)
    name = f"{arguments.out}_{second + 1}.png"
    pathlib.Path(name).parent.mkdir(parents=True, exist_ok=True)
    image.save(name)
    outputs.append(name)
print("\n".join(outputs))
