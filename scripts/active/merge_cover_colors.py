"""Add album-cover colours to data/processed/timeline.json, in place.

Run AFTER build_timeline.py (and re-run it whenever timeline.json is regenerated, since that
overwrites these fields). Idempotent. Input is build_cover_colors.py's output JSON.

Adds to timeline.json:
  "covers": [[avg, vivid, p1, p2, p3], ...]   unique cover palettes, colours as #rrggbb
  songs[i]["c"]: index into "covers" (absent when the track has no cover)

Usage: py -I merge_cover_colors.py [cover-colors.json]   (default: data/processed/cover-colors.json)
"""
import json, os, sys

sys.stdout.reconfigure(encoding="utf-8")
ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
PATH = os.path.join(ROOT, "data", "processed", "timeline.json")

SRC = sys.argv[1] if len(sys.argv) > 1 else os.path.join(ROOT, "data", "processed", "cover-colors.json")
with open(SRC, encoding="utf-8") as fh:
    cc = json.load(fh)
with open(PATH, encoding="utf-8") as fh:
    data = json.load(fh)

index, covers = {}, []
with_cover = 0
for s in data["songs"]:
    s.pop("c", None)
    key = cc["tracks"].get(s["id"])
    pal = cc["images"].get(key) if key else None
    if not pal:
        continue
    t = tuple(pal)
    if t not in index:
        index[t] = len(covers)
        covers.append(list(pal))
    s["c"] = index[t]
    with_cover += 1
data["covers"] = covers

with open(PATH, "w", encoding="utf-8") as fh:
    json.dump(data, fh, ensure_ascii=False, separators=(",", ":"))
n = len(data["songs"])
print(f"{with_cover}/{n} timeline entries ({with_cover / n:.1%}) have cover colours; "
      f"{len(covers)} unique palettes; timeline.json is now {os.path.getsize(PATH):,} bytes")
