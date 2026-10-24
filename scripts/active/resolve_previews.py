"""Resolve a 30s preview clip for every unique track in the Tingo Tango CSVs.

Deezer by ISRC first (exact match), then iTunes by title+artist for misses.
Resumable: results are cached in the output JSON and skipped on re-run.
Usage: py -I resolve_previews.py <out.json>
"""
import csv, glob, json, os, re, sys, threading, time, urllib.parse, urllib.request
from concurrent.futures import ThreadPoolExecutor

sys.stdout.reconfigure(encoding="utf-8")
BASE = r"J:\CLAUDE\PROJECTS\SPOTTY EXPOTTY\data\Exportify Export\Tingo Tango"
OUT = [a for a in sys.argv[1:] if not a.startswith("--")][0]
DEEZER_PER_SEC = 5
ITUNES_GAP_SEC = 3.2

songs = {}
for f in glob.glob(BASE + r"\*.csv"):
    with open(f, encoding="utf-8-sig", newline="") as fh:
        for r in csv.DictReader(fh):
            songs.setdefault(r["Track URI"], r)

cache = {}
if os.path.exists(OUT):
    with open(OUT, encoding="utf-8") as fh:
        cache = json.load(fh)
lock = threading.Lock()


def save():
    with lock:
        snap = dict(cache)  # one C-level copy; safe while worker threads add keys
        tmp = OUT + ".tmp"
        with open(tmp, "w", encoding="utf-8") as fh:
            json.dump(snap, fh, ensure_ascii=False)
        os.replace(tmp, OUT)


def get(url):
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req, timeout=20) as resp:
        return json.loads(resp.read().decode("utf-8"))


def norm(s):
    return re.sub(r"[^a-z0-9]+", " ", s.lower()).strip()


rate_lock = threading.Lock()
next_slot = [0.0]


def dz_wait():
    with rate_lock:
        now = time.time()
        t = max(now, next_slot[0])
        next_slot[0] = t + 1.0 / DEEZER_PER_SEC
    if t > now:
        time.sleep(t - now)


def deezer(uri):
    r = songs[uri]
    for attempt in range(4):
        dz_wait()
        try:
            j = get("https://api.deezer.com/track/isrc:" + urllib.parse.quote(r["ISRC"]))
            if j.get("error", {}).get("code") == 4:  # quota
                time.sleep(5 * (attempt + 1))
                continue
            if j.get("preview"):
                return {"src": "deezer", "preview": j["preview"], "id": j.get("id"),
                        "title": j.get("title"), "artist": j.get("artist", {}).get("name")}
            return None
        except Exception:
            time.sleep(2 * (attempt + 1))
    return "error"


def itunes(uri):
    r = songs[uri]
    q = urllib.parse.urlencode({"term": r["Track Name"] + " " + r["Artist Name(s)"].split(",")[0],
                                "entity": "song", "limit": 5})
    try:
        j = get("https://itunes.apple.com/search?" + q)
    except Exception:
        return "error"
    want = norm(r["Track Name"])
    for x in j.get("results", []):
        if x.get("previewUrl") and (want in norm(x.get("trackName", "")) or norm(x.get("trackName", "")) in want):
            return {"src": "itunes", "preview": x["previewUrl"], "title": x.get("trackName"),
                    "artist": x.get("artistName"), "loose": True}
    return None


todo = [u for u in songs if u not in cache]
print(f"unique tracks {len(songs)}, cached {len(cache)}, to do {len(todo)}", flush=True)
misses = []
done = [0]


def work(uri):
    res = deezer(uri) if songs[uri]["ISRC"] else None
    if res == "error":
        return
    if res is None:
        misses.append(uri)
    else:
        cache[uri] = res
    done[0] += 1
    if done[0] % 200 == 0:
        save()
        print(f"deezer pass {done[0]}/{len(todo)}  misses so far {len(misses)}", flush=True)


with ThreadPoolExecutor(4) as ex:
    list(ex.map(work, todo))
save()
print(f"deezer pass done. hits {sum(1 for v in cache.values() if v['src']=='deezer')}, misses {len(misses)}", flush=True)
if "--no-itunes" in sys.argv:
    for uri in misses:
        cache[uri] = {"src": None, "preview": None}
    save()
    hit = sum(1 for v in cache.values() if v.get("preview"))
    print(f"ALL DONE (deezer only). total tracks {len(songs)}, with preview {hit}, without {len(songs)-hit}, uncached {len(songs)-len(cache)}", flush=True)
    sys.exit(0)

for n, uri in enumerate(misses, 1):
    res = itunes(uri)
    if res != "error":
        cache[uri] = res if res else {"src": None, "preview": None}
    time.sleep(ITUNES_GAP_SEC)
    if n % 50 == 0:
        save()
        print(f"itunes pass {n}/{len(misses)}", flush=True)
save()
hit = sum(1 for v in cache.values() if v.get("preview"))
print(f"ALL DONE. total tracks {len(songs)}, with preview {hit}, without {len(songs)-hit}, uncached {len(songs)-len(cache)}", flush=True)
