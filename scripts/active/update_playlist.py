"""Replace one diary playlist's CSV with a newer Exportify export, keeping the old data format.

The newer Exportify export has no audio features / genres, so the playlist is MERGED, not overwritten:
every row already in the old CSV is kept exactly as it was; each track that is only in the new export is
appended in the old column layout, with its audio features from ReccoBeats (by Spotify track id; Spotify's own
audio-features endpoint is closed to new apps) and its Deezer id (by ISRC) resolved for the preview clip.

Usage: py -I update_playlist.py <new-export.csv> <old-playlist.csv> <deezer-ids-out.json>
  - rewrites <old-playlist.csv> in place (the previous version stays in git),
  - writes {"songs": [{"id", "d"}, ...]} (every Deezer id known: the current timeline.json's plus the new ones),
    which build_timeline.py takes as its argument so the existing clips are kept.
Then run, in this order: build_timeline.py <deezer-ids-out.json>, build_cover_colors.py data/processed/cover-colors.json,
merge_cover_colors.py, merge_original_dates.py, merge_itunes_previews.py.
"""
import csv, json, os, sys, time, urllib.request, urllib.parse

sys.stdout.reconfigure(encoding="utf-8")
NEW, OLD, OUT = sys.argv[1], sys.argv[2], sys.argv[3]
ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
TIMELINE = os.path.join(ROOT, "data", "processed", "timeline.json")


def get(url):
    req = urllib.request.Request(url, headers={"User-Agent": "spotty-expotty/1.0", "Accept": "application/json"})
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read().decode("utf-8"))


old_rows = list(csv.DictReader(open(OLD, encoding="utf-8-sig", newline="")))
fields = list(old_rows[0].keys())
new_rows = list(csv.DictReader(open(NEW, encoding="utf-8-sig", newline="")))
have = {r["Track URI"] for r in old_rows}
added = [r for r in new_rows if r["Track URI"] not in have]
print(f"old {len(old_rows)} rows, new export {len(new_rows)} rows, {len(added)} tracks to add")

# audio features (ReccoBeats), 20 ids per request
feat = {}
ids = [r["Track URI"].split(":")[-1] for r in added]
for i in range(0, len(ids), 20):
    chunk = ids[i:i + 20]
    try:
        for it in get("https://api.reccobeats.com/v1/audio-features?ids=" + ",".join(chunk)).get("content", []):
            feat[it["href"].rstrip("/").split("/")[-1]] = it
    except Exception as e:
        print("ReccoBeats failed for a batch:", e)
    time.sleep(0.5)
print(f"audio features found for {len(feat)} of {len(ids)}")

# Deezer id by ISRC
deezer = {}
for r in added:
    tid, isrc = r["Track URI"].split(":")[-1], (r.get("ISRC") or "").strip()
    deezer[tid] = 0
    if not isrc:
        continue
    for attempt in range(3):
        try:
            j = get("https://api.deezer.com/track/isrc:" + urllib.parse.quote(isrc))
            if isinstance(j, dict) and j.get("id") and not j.get("error"):
                deezer[tid] = j["id"]
            elif isinstance(j, dict) and j.get("error", {}).get("code") == 4:
                time.sleep(2); continue
            break
        except Exception as e:
            time.sleep(1)
    time.sleep(0.25)
print(f"Deezer ids found for {sum(1 for v in deezer.values() if v)} of {len(added)}")

for r in added:
    tid = r["Track URI"].split(":")[-1]
    f = feat.get(tid, {})
    row = {k: "" for k in fields}
    row.update({
        "Track URI": r["Track URI"], "ISRC": r.get("ISRC", ""), "Track Name": r["Track Name"], "Album Name": r["Album Name"],
        "Artist Name(s)": r["Artist Name(s)"], "Release Date": r.get("Album Release Date", ""), "Duration (ms)": r.get("Track Duration (ms)", ""),
        "Popularity": r.get("Popularity", ""), "Explicit": r.get("Explicit", ""), "Added By": r.get("Added By", ""), "Added At": r.get("Added At", ""),
        "Danceability": f.get("danceability", ""), "Energy": f.get("energy", ""), "Key": f.get("key", ""), "Loudness": f.get("loudness", ""), "Mode": f.get("mode", ""),
        "Speechiness": f.get("speechiness", ""), "Acousticness": f.get("acousticness", ""), "Instrumentalness": f.get("instrumentalness", ""),
        "Liveness": f.get("liveness", ""), "Valence": f.get("valence", ""), "Tempo": f.get("tempo", ""),
    })
    old_rows.append(row)

with open(OLD, "w", encoding="utf-8-sig", newline="") as fh:
    w = csv.DictWriter(fh, fieldnames=fields)
    w.writeheader()
    w.writerows(old_rows)

songs = json.load(open(TIMELINE, encoding="utf-8"))["songs"]
d_by = {s["id"]: s["d"] for s in songs}
d_by.update({k: v for k, v in deezer.items() if v})
json.dump({"songs": [{"id": k, "d": v} for k, v in d_by.items()]}, open(OUT, "w", encoding="utf-8"))
print("wrote", OLD, "-", len(old_rows), "rows;", OUT)
