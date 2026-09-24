"""Tile rendered frames into contact sheets (default 960 px wide, 4 columns) with time labels.

    python3 sheet.py --out /tmp/sheets/nbly-rig --cols 4 --rows 8 frames/nbly-rig_*.png

Writes <out>_01.png, <out>_02.png, ... and prints their paths.
"""
import argparse, re, pathlib
from PIL import Image, ImageDraw, ImageFont

parser = argparse.ArgumentParser()
parser.add_argument("frames", nargs="+")
parser.add_argument("--out", required=True)
parser.add_argument("--cols", type=int, default=4)
parser.add_argument("--rows", type=int, default=8)
parser.add_argument("--width", type=int, default=960)
arguments = parser.parse_args()

def stamp(path):
    match = re.search(r"_(\d+\.\d+)\.png$", path)
    return float(match.group(1)) if match else 0.0

frames = sorted(arguments.frames, key=stamp)
cell_w = arguments.width // arguments.cols
first = Image.open(frames[0])
cell_h = round(cell_w * first.height / first.width)
label_h = 14
try:
    font = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf", 11)
except OSError:
    font = ImageFont.load_default()
per_sheet = arguments.cols * arguments.rows
outputs = []
for sheet_index in range(0, len(frames), per_sheet):
    chunk = frames[sheet_index:sheet_index + per_sheet]
    rows = (len(chunk) + arguments.cols - 1) // arguments.cols
    sheet = Image.new("RGB", (arguments.width, rows * (cell_h + label_h)), (40, 40, 40))
    draw = ImageDraw.Draw(sheet)
    for index, path in enumerate(chunk):
        x, y = (index % arguments.cols) * cell_w, (index // arguments.cols) * (cell_h + label_h)
        image = Image.open(path).convert("RGB").resize((cell_w, cell_h), Image.LANCZOS)
        sheet.paste(image, (x, y + label_h))
        t = stamp(path)
        draw.text((x + 3, y + 1), f"{int(t // 60)}:{t % 60:06.3f}", fill=(230, 230, 230), font=font)
    name = f"{arguments.out}_{sheet_index // per_sheet + 1:02d}.png"
    pathlib.Path(name).parent.mkdir(parents=True, exist_ok=True)
    sheet.save(name)
    outputs.append(name)
print("\n".join(outputs))
