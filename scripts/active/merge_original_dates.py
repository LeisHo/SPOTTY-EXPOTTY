"""Merges data/processed/original-dates.json (lookup_original_dates.py) into timeline.json as `od` (the song's own earliest known
release date, only where MusicBrainz found one EARLIER than the album's date `rd`). The app's Song Date filter uses od, then rd.
Idempotent. Re-run after build_timeline.py (a rebuild drops od)."""
import json
ROOT = 'J:/CLAUDE/PROJECTS/SPOTTY EXPOTTY/data/processed/'
tl = json.load(open(ROOT + 'timeline.json', encoding='utf-8'))
od = json.load(open(ROOT + 'original-dates.json', encoding='utf-8'))
def key(d):  # compare YYYY / YYYY-MM / YYYY-MM-DD as the first day of the period
    p = (d.split('-') + ['01', '01'])[:3]
    return (int(p[0]), int(p[1]), int(p[2]))
changed = 0
for s in tl['songs']:
    s.pop('od', None)
    m = od.get(s['id'])
    if m and key(m)[0] >= 1000 and (not s.get('rd') or key(s['rd'])[0] < 1000 or key(m) < key(s['rd'])):
        s['od'] = m; changed += 1
json.dump(tl, open(ROOT + 'timeline.json', 'w', encoding='utf-8'), ensure_ascii=False, separators=(',', ':'))
print('songs with an earlier original date:', changed, 'of', len(tl['songs']), '; looked up:', len(od), ', with a date:', sum(1 for v in od.values() if v))
