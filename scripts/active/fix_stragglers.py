"""Plan corrections for songs added to a playlist long after that playlist's active period.

Rule (documented, deterministic):
  * A playlist's CORE window is its densest 190-day window of add dates.
  * Its HOME window is the core extended by 45 days on each side (a playlist is normally
    still being added to for a few weeks around its core).
  * A song whose Added At is outside its own playlist's HOME window is a STRAGGLER.
  * A straggler belongs to the playlist whose HOME window contains its date (if several,
    the one whose core is closest; a date after every window - e.g. the future-dated song -
    goes to the latest playlist).
  * If the target playlist already contains that track (same Track URI), the straggler is
    simply REMOVED from the wrong playlist (action "remove-duplicate"); otherwise it is
    MOVED (action "move").
  * MMXIX / MMXX are year-long playlists by name (2019 / 2020), so their late-year songs
    are legitimate and are left alone; Treinta.Cero_(2) (every song stamped one day) is
    a copy and is left alone.

Writes data/processed/playlist-corrections.json (the plan build_timeline.py applies).
Usage: py -I fix_stragglers.py [--write]     (without --write: dry run, prints only)
"""
import csv, glob, json, os, sys
from datetime import datetime, timedelta

sys.stdout.reconfigure(encoding="utf-8")
ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
BASE = os.path.join(ROOT, "data", "Exportify Export", "Tingo Tango")
OUT = os.path.join(ROOT, "data", "processed", "playlist-corrections.json")
CORE_DAYS, TOL_DAYS = 190, 45
SKIP = {"MMXIX.csv", "MMXX.csv", "Treinta.Cero_(2).csv"}


def parse(s):
    return datetime.strptime(s[:19], "%Y-%m-%dT%H:%M:%S")


pl = {}  # file -> {rows, core_lo, core_hi}
for f in sorted(glob.glob(os.path.join(BASE, "*.csv"))):
    name = os.path.basename(f)
    with open(f, encoding="utf-8-sig", newline="") as fh:
        rows = [r for r in csv.DictReader(fh) if r.get("Added At")]
    ts = sorted(parse(r["Added At"]) for r in rows)
    n, j, best = len(ts), 0, (0, 0)
    for i in range(n):
        while (ts[i] - ts[j]).days > CORE_DAYS:
            j += 1
        if i - j + 1 > best[0]:
            best = (i - j + 1, j)
    lo, hi = ts[best[1]], ts[best[1] + best[0] - 1]
    pl[name] = {"rows": rows, "lo": lo, "hi": hi}

tol = timedelta(days=TOL_DAYS)
home = lambda p: (p["lo"] - tol, p["hi"] + tol)
targets = [k for k in pl if k not in SKIP]
moves = []
for name, p in pl.items():
    if name in SKIP:
        continue
    h_lo, h_hi = home(p)
    for r in p["rows"]:
        t = parse(r["Added At"])
        if h_lo <= t <= h_hi:
            continue
        core_c = [k for k in targets if k != name and pl[k]["lo"] <= t <= pl[k]["hi"]]
        home_c = [k for k in targets if k != name and home(pl[k])[0] <= t <= home(pl[k])[1]]
        if core_c:  # the date is inside this playlist's own densest window: most specific match
            dest = min(core_c, key=lambda k: abs((t - (pl[k]["lo"] + (pl[k]["hi"] - pl[k]["lo"]) / 2)).total_seconds()))
            why = "date falls inside this playlist's core window"
        elif home_c:  # only in the tolerance margin of some playlists: the one whose core edge is nearest
            dest = min(home_c, key=lambda k: min(abs((t - pl[k]["lo"]).total_seconds()), abs((t - pl[k]["hi"]).total_seconds())))
            why = "date falls in this playlist's home window (core +/- 45 days)"
        else:
            dest = max(targets, key=lambda k: pl[k]["hi"]) if t > max(pl[k]["hi"] for k in targets) else \
                min(targets, key=lambda k: min(abs((t - pl[k]["lo"]).total_seconds()), abs((t - pl[k]["hi"]).total_seconds())))
            why = "no window contains the date; nearest/latest playlist"
        has = any(x["Track URI"] == r["Track URI"] for x in pl[dest]["rows"])
        moves.append({
            "uri": r["Track URI"], "name": r["Track Name"], "artist": r["Artist Name(s)"],
            "addedAt": r["Added At"], "from": name, "to": dest,
            "action": "remove-duplicate" if has else "move", "why": why,
        })

by = {}
for m in moves:
    by.setdefault(m["from"], []).append(m)
print(f"{len(moves)} stragglers in {len(by)} playlists; "
      f"{sum(1 for m in moves if m['action'] == 'move')} moves, "
      f"{sum(1 for m in moves if m['action'] == 'remove-duplicate')} removals (already in target)\n")
for name in sorted(by, key=lambda k: pl[k]["lo"]):
    ms = by[name]
    dests = {}
    for m in ms:
        dests.setdefault(m["to"], [0, 0])[0 if m["action"] == "move" else 1] += 1
    print(f"{name}  core {pl[name]['lo']:%Y-%m-%d}..{pl[name]['hi']:%Y-%m-%d}  stragglers {len(ms)}")
    for d, (mv, rm) in dests.items():
        print(f"     -> {d}: {mv} moved, {rm} removed as duplicate")
    for m in ms[:3]:
        print(f"        {m['addedAt'][:10]}  {m['name'][:40]} - {m['artist'][:22]}")

if "--write" in sys.argv:
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w", encoding="utf-8") as fh:
        json.dump({"rule": __doc__.strip().split("\n\n")[1] if "\n\n" in __doc__ else "", "moves": moves}, fh, ensure_ascii=False, indent=1)
    print(f"\nwrote {OUT}")
