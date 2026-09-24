#!/bin/sh
# Renders a full review set for one visualizer:
#   whole songs at 2 fps -> contact sheets (5 x 8 frames, 20 s per sheet)
#   every listed peak at 10 fps +-2 s -> spectrogram sync strips (one image per second)
#   stills: the first frame paused and playing, and each drop frame, at 960 px
# usage: [PORT=8081] sh review.sh <variant> <outdir> [scale] [pages] [songs...]
set -e
cd "$(dirname "$0")"
VARIANT=$1; OUT=$2; SCALE=${3:-0.5}; PAGES=${4:-1}; PORT=${PORT:-8080}
shift 4 2>/dev/null || shift $#
SONGS=${*:-"nbly desire ophelia outside americanboy"}
mkdir -p "$OUT/frames" "$OUT/sheets" "$OUT/strips" "$OUT/stills"
duration() { python3 -c "import json,sys; sys.path.insert(0,'.'); from perf import SONGS, LIB; print(json.load(open(LIB/SONGS['$1']/'performance.json'))['duration'])"; }
peaks() {
  case $1 in
    nbly) echo "138.126 142.5 250.5 256.5 276.252" ;;
    desire) echo "45.772 167.6 228.632" ;;
    ophelia) echo "36.501 94.681" ;;
    outside) echo "141.177" ;;
    americanboy) echo "48.808" ;;
  esac
}
for SONG in $SONGS; do
  D=$(duration $SONG)
  node render.mjs --port $PORT --song $SONG --variant $VARIANT --out "$OUT/frames/$SONG" --from 0 --to $D --fps 2 --scale $SCALE --pages $PAGES
  python3 sheet.py --out "$OUT/sheets/$SONG" --cols 5 --rows 8 "$OUT"/frames/$SONG/*.png > /dev/null
  node render.mjs --port $PORT --song $SONG --variant $VARIANT --out "$OUT/stills" --times 0 --scale 0.5 --paused --prefix "$SONG-paused"
  for P in $(peaks $SONG); do
    FROM=$(python3 -c "print(round($P-2,1))"); TO=$(python3 -c "print(round($P+2,1))")
    node render.mjs --port $PORT --song $SONG --variant $VARIANT --out "$OUT/strip-frames/$SONG-$P" --from $FROM --to $TO --fps 10 --scale 0.25 --pages $PAGES --prefix s
    python3 strip.py --song $SONG --center $(python3 -c "print(round($P,1))") --frames "$OUT/strip-frames/$SONG-$P" --prefix s --out "$OUT/strips/$SONG-$P" > /dev/null
    node render.mjs --port $PORT --song $SONG --variant $VARIANT --out "$OUT/stills" --times $P --scale 0.5 --prefix "$SONG-peak"
  done
done
echo "review set ready in $OUT"
ls "$OUT/sheets" | wc -l; ls "$OUT/strips" | wc -l; ls "$OUT/stills" | wc -l
