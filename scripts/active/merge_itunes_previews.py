"""Add iTunes preview links to data/processed/timeline.json, in place.

For songs with no Deezer clip (d == 0) that have an iTunes 30-second preview, sets
songs[i]["u"] to that preview's URL. The clip player uses "u" only when "d" is 0.
Run AFTER build_timeline.py (a rebuild drops these fields). Idempotent.

Input is data/processed/itunes-previews.json: { "<spotify track id>": "<itunes preview url>" }.
These URLs are static iTunes CDN links (no expiry token, unlike Deezer's); they are the
one exception to "never save preview URLs to a file" (see CLAUDE.md gotchas).

Usage: py -I merge_itunes_previews.py [itunes-previews.json]
"""
import json, os, sys

sys.stdout.reconfigure(encoding="utf-8")
ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
PATH = os.path.join(ROOT, "data", "processed", "timeline.json")
SRC = sys.argv[1] if len(sys.argv) > 1 else os.path.join(ROOT, "data", "processed", "itunes-previews.json")

with open(SRC, encoding="utf-8") as fh:
    links = json.load(fh)
with open(PATH, encoding="utf-8") as fh:
    data = json.load(fh)

added = 0
for s in data["songs"]:
    s.pop("u", None)
    if not s.get("d") and links.get(s["id"]):
        s["u"] = links[s["id"]]
        added += 1

with open(PATH, "w", encoding="utf-8") as fh:
    json.dump(data, fh, ensure_ascii=False, separators=(",", ":"))

total = len(data["songs"])
deezer = sum(1 for s in data["songs"] if s.get("d"))
print(f"iTunes preview links on {added} songs; {deezer} with a Deezer clip; {total - deezer - added} with no clip at all")
