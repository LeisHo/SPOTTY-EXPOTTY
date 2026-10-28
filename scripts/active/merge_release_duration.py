"""Add release date (rd, as written in the CSV: YYYY, YYYY-MM or YYYY-MM-DD) and duration (du, ms) to data/processed/timeline.json, in place.

Matched by Spotify track id from the Exportify CSVs. build_timeline.py now writes both itself; use this to add them to an
existing timeline.json without a rebuild. Idempotent. Usage: py -I merge_release_duration.py
"""
import csv, glob, json, os, sys

sys.stdout.reconfigure(encoding="utf-8")
ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
PATH = os.path.join(ROOT, "data", "processed", "timeline.json")
BASE = os.path.join(ROOT, "data", "Exportify Export", "Tingo Tango")

rd, du = {}, {}
for f in glob.glob(os.path.join(BASE, "*.csv")):
    with open(f, encoding="utf-8-sig", newline="") as fh:
        for r in csv.DictReader(fh):
            tid = r["Track URI"].split(":")[-1]
            if (r.get("Release Date") or "").strip():
                rd[tid] = r["Release Date"].strip()
            try:
                ms = int(float(r.get("Duration (ms)")))
                if ms > 0:
                    du[tid] = ms
            except (TypeError, ValueError):
                pass

with open(PATH, encoding="utf-8") as fh:
    data = json.load(fh)
a = b = 0
for s in data["songs"]:
    if s["id"] in rd: s["rd"] = rd[s["id"]]; a += 1
    else: s.pop("rd", None)
    if s["id"] in du: s["du"] = du[s["id"]]; b += 1
    else: s.pop("du", None)
with open(PATH, "w", encoding="utf-8") as fh:
    json.dump(data, fh, ensure_ascii=False, separators=(",", ":"))
print(f"release date set on {a}, duration on {b} of {len(data['songs'])} songs")
