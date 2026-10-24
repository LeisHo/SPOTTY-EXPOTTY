"""Build data/processed/timeline.json from the Tingo Tango CSVs.

One entry per playlist-add event (6,345 rows), sorted by Added At. A song that
appears in several playlists appears several times (it was added several
times). Deezer track ids come from resolve_previews.py's output JSON, keyed by
Spotify track URI; `d` is 0 when no preview clip was found.

Usage: py -I build_timeline.py <preview-links.json>
"""
import csv, glob, json, os, re, sys

sys.stdout.reconfigure(encoding="utf-8")
ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
BASE = os.path.join(ROOT, "data", "Exportify Export", "Tingo Tango")
OUT = os.path.join(ROOT, "data", "processed", "timeline.json")

links = {}
if len(sys.argv) > 1 and os.path.exists(sys.argv[1]):
    with open(sys.argv[1], encoding="utf-8") as fh:
        links = json.load(fh)


def pretty(fname):
    s = os.path.splitext(fname)[0].replace("_", " ").strip()
    return re.sub(r"\s+\.", ".", re.sub(r"\.+$", "", s)).strip()


def num(x, nd=3):
    try:
        return round(float(x), nd)
    except (TypeError, ValueError):
        return None


rows, playlists = [], []
for f in sorted(glob.glob(os.path.join(BASE, "*.csv"))):
    pidx = len(playlists)
    n = 0
    with open(f, encoding="utf-8-sig", newline="") as fh:
        for r in csv.DictReader(fh):
            if not r.get("Added At"):
                continue
            uri = r["Track URI"]
            link = links.get(uri) or {}
            d = link.get("id") if link.get("src") == "deezer" else 0
            rows.append({
                "id": uri.split(":")[-1],
                "n": r["Track Name"],
                "a": r["Artist Name(s)"],
                "al": r["Album Name"],
                "ry": (r.get("Release Date") or "")[:4],
                "t": r["Added At"],
                "p": pidx,
                "d": d or 0,
                "v": num(r.get("Valence")),
                "e": num(r.get("Energy")),
                "dn": num(r.get("Danceability")),
            })
            n += 1
    playlists.append({"name": pretty(os.path.basename(f)), "file": os.path.basename(f), "count": n})

rows.sort(key=lambda s: s["t"])
os.makedirs(os.path.dirname(OUT), exist_ok=True)
with open(OUT, "w", encoding="utf-8") as fh:
    json.dump({"playlists": playlists, "songs": rows}, fh, ensure_ascii=False, separators=(",", ":"))
with_clip = sum(1 for s in rows if s["d"])
print(f"wrote {OUT}: {len(rows)} entries, {len(playlists)} playlists, {with_clip} with a Deezer clip id "
      f"({with_clip / len(rows):.1%}), {os.path.getsize(OUT):,} bytes")
