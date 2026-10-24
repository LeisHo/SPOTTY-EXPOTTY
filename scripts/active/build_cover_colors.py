"""Extract album-cover colors for every unique track in data/processed/timeline.json.

1. Spotify oEmbed (browser-accessible, no key) gives each track's cover thumbnail URL.
2. One 64x64 image per unique cover (many tracks share an album cover) is downloaded.
3. Pillow computes per cover: average color, "vivid" dominant color (population x
   saturation weighted), and the top-3 palette colors by population.
Resumable: results are cached in the output JSON and skipped on re-run.

Usage: py -I build_cover_colors.py <out.json>
Output: {"tracks": {trackId: imageKey}, "images": {imageKey: [avg, vivid, p1, p2, p3]}}
        (colors as #rrggbb). build_timeline.py merges this into timeline.json.
"""
import colorsys, io, json, os, sys, threading, time, urllib.error, urllib.parse, urllib.request
from concurrent.futures import ThreadPoolExecutor
from PIL import Image

sys.stdout.reconfigure(encoding="utf-8")
ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
TIMELINE = os.path.join(ROOT, "data", "processed", "timeline.json")
OUT = sys.argv[1]
OEMBED_PER_SEC = 2.5  # oEmbed answers HTTP 429 to bursts: 1/s was always fine, 4-14/s got throttled
UA = {"User-Agent": "Mozilla/5.0"}

with open(TIMELINE, encoding="utf-8") as fh:
    _songs = json.load(fh)["songs"]
track_ids = sorted({s["id"] for s in _songs})
# Tracks on the same album (same album name + first artist) share a cover, so only ONE track per
# album is looked up and its cover is shared with the rest of that album (about 40 % fewer lookups).
album_of = {}
for s in _songs:
    album_of.setdefault(s["id"], (s["al"].strip().lower(), s["a"].split(",")[0].strip().lower()))
members = {}
for t in track_ids:
    members.setdefault(album_of[t], []).append(t)
reps = [ts[0] for ts in members.values()]
state = {"tracks": {}, "images": {}, "urls": {}}  # urls: imageKey -> 300px url
if os.path.exists(OUT):
    with open(OUT, encoding="utf-8") as fh:
        state.update(json.load(fh))
lock = threading.Lock()
rl = threading.Lock()
slot = [0.0]


def wait_slot():
    with rl:
        now = time.time()
        t = max(now, slot[0])
        slot[0] = t + 1.0 / OEMBED_PER_SEC
    if t > now:
        time.sleep(t - now)


def save():
    with lock:
        snap = {k: dict(v) for k, v in state.items()}
        tmp = OUT + ".tmp"
        with open(tmp, "w", encoding="utf-8") as fh:
            json.dump(snap, fh, separators=(",", ":"))
        os.replace(tmp, OUT)


def http(url, binary=False):
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=20) as r:
        data = r.read()
    return data if binary else json.loads(data.decode("utf-8"))


def image_key(url):  # the hash after the size code, e.g. ab67616d00001e02<hash>
    tail = url.rsplit("/", 1)[-1]
    return tail[16:] if len(tail) > 16 else tail


pause_until = [0.0]  # set when oEmbed answers 429: every worker waits it out


def lookup(tid):
    if tid in state["tracks"]:
        return
    fails = 0
    while True:
        while time.time() < pause_until[0]:
            time.sleep(1)
        wait_slot()
        try:
            j = http("https://open.spotify.com/oembed?url=" + urllib.parse.quote("https://open.spotify.com/track/" + tid, safe=""))
            url = j.get("thumbnail_url") or ""
            if url:
                k = image_key(url)
                state["tracks"][tid] = k
                state["urls"][k] = url
            else:
                state["tracks"][tid] = ""
            return
        except urllib.error.HTTPError as e:
            if e.code == 429:  # throttled: pause ALL workers for 60 s, then retry (not counted as a failure)
                pause_until[0] = time.time() + 60
                print("oembed 429: pausing 60 s", flush=True)
                continue
            fails += 1
            if e.code in (400, 404) or fails >= 3:  # track not found / persistent error: record "no cover" and move on
                state["tracks"][tid] = ""
                return
            time.sleep(1.5)
        except Exception:
            fails += 1
            if fails >= 3:  # network trouble: leave uncached so a re-run retries it
                return
            time.sleep(1.5)


def hexc(rgb):
    return "#%02x%02x%02x" % tuple(int(round(c)) for c in rgb)


def analyze(img):
    img = img.convert("RGB").resize((32, 32))
    px = list(img.getdata())
    avg = [sum(p[i] for p in px) / len(px) for i in range(3)]
    q = img.quantize(colors=6, method=Image.MEDIANCUT)
    pal = q.getpalette()[:18]
    counts = sorted(q.getcolors(), reverse=True)  # [(count, index)]
    cols = [(c, tuple(pal[i * 3:i * 3 + 3])) for c, i in counts]
    total = sum(c for c, _ in cols)

    def vivid_score(c, rgb):
        h, s, v = colorsys.rgb_to_hsv(*(x / 255 for x in rgb))
        return (c / total) ** 0.5 * s * (0.35 + v)

    vivid = max(cols, key=lambda cv: vivid_score(*cv))[1]
    top3 = [rgb for _, rgb in cols[:3]]
    while len(top3) < 3:
        top3.append(top3[-1])
    return [hexc(avg), hexc(vivid)] + [hexc(c) for c in top3]


def fetch_image(k):
    if k in state["images"] or not k:
        return
    url64 = state["urls"][k].replace("ab67616d00001e02", "ab67616d00004851")
    for attempt in range(3):
        try:
            data = http(url64, binary=True)
            state["images"][k] = analyze(Image.open(io.BytesIO(data)))
            return
        except Exception:
            time.sleep(1.0 * (attempt + 1))


todo = [t for t in reps if t not in state["tracks"] and not any(m in state["tracks"] and state["tracks"][m] for m in members[album_of[t]])]
print(f"unique tracks {len(track_ids)}, unique albums {len(reps)}, cached lookups {len(state['tracks'])}, to look up {len(todo)}", flush=True)
done = [0]


def look(t):
    lookup(t)
    done[0] += 1
    if done[0] % 100 == 0:
        save()
        print(f"oembed {done[0]}/{len(todo)}", flush=True)


with ThreadPoolExecutor(6) as ex:
    list(ex.map(look, todo))
# share each album's cover with every track on that album
for ts in members.values():
    k = next((state["tracks"][t] for t in ts if state["tracks"].get(t)), "")
    for t in ts:
        if not state["tracks"].get(t):
            state["tracks"][t] = k
save()
keys = sorted({k for k in state["tracks"].values() if k and k not in state["images"]})
print(f"lookups done; unique covers to download {len(keys)} (already analyzed {len(state['images'])})", flush=True)
n = [0]


def img(k):
    fetch_image(k)
    n[0] += 1
    if n[0] % 300 == 0:
        save()
        print(f"images {n[0]}/{len(keys)}", flush=True)


with ThreadPoolExecutor(8) as ex:
    list(ex.map(img, keys))
save()
missing_tracks = sum(1 for t in track_ids if not state["tracks"].get(t))
print(f"ALL DONE. tracks {len(track_ids)}, with cover {len(track_ids) - missing_tracks}, without {missing_tracks}, "
      f"unique covers analyzed {len(state['images'])}", flush=True)
