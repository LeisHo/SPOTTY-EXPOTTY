"""Add tempo (BPM) to data/processed/timeline.json, in place.

Sets songs[i]["tp"] from the Exportify CSVs' Tempo column (matched by Spotify track id), rounded to 0.1.
build_timeline.py now writes "tp" itself; use this to add it to an existing timeline.json without a rebuild.
Idempotent. Usage: py -I merge_tempo.py
"""
import csv, glob, json, os, sys

sys.stdout.reconfigure(encoding="utf-8")
ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
PATH = os.path.join(ROOT, "data", "processed", "timeline.json")
BASE = os.path.join(ROOT, "data", "Exportify Export", "Tingo Tango")

tempo = {}
for f in glob.glob(os.path.join(BASE, "*.csv")):
    with open(f, encoding="utf-8-sig", newline="") as fh:
        for r in csv.DictReader(fh):
            try:
                tempo[r["Track URI"].split(":")[-1]] = round(float(r.get("Tempo")), 1)
            except (TypeError, ValueError):
                pass

with open(PATH, encoding="utf-8") as fh:
    data = json.load(fh)
added = 0
for s in data["songs"]:
    if s["id"] in tempo:
        s["tp"] = tempo[s["id"]]
        added += 1
    else:
        s.pop("tp", None)
with open(PATH, "w", encoding="utf-8") as fh:
    json.dump(data, fh, ensure_ascii=False, separators=(",", ":"))
print(f"tempo set on {added} of {len(data['songs'])} songs")
