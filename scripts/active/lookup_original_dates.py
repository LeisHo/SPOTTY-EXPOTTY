"""One-off, resumable: looks up each song's earliest known release date on MusicBrainz (by ISRC) so the Song Date
filter can use the song's own date instead of its (possibly compilation) album's date.
Output: data/processed/original-dates.json = { trackId: "YYYY[-MM[-DD]]" or "" (looked up, nothing found) }.
MusicBrainz allows ~1 request/s: this runs ~1.1 s apart and retries 503s with a pause. Safe to stop and re-run (skips done ids).
Never run two copies at once."""
import csv, glob, json, os, sys, time, urllib.request, urllib.error
ROOT = 'J:/CLAUDE/PROJECTS/SPOTTY EXPOTTY/'
OUT = ROOT + 'data/processed/original-dates.json'
isrc = {}
for f in glob.glob(ROOT + 'data/Exportify Export/**/*.csv', recursive=True):
    for r in csv.DictReader(open(f, encoding='utf-8-sig')):
        if r.get('ISRC'): isrc[r['Track URI'].split(':')[-1]] = r['ISRC']
ids = sorted({s['id'] for s in json.load(open(ROOT + 'data/processed/timeline.json', encoding='utf-8'))['songs']} & set(isrc))
done = json.load(open(OUT, encoding='utf-8')) if os.path.exists(OUT) else {}
todo = [i for i in ids if i not in done]
print(f'{len(ids)} songs with an ISRC, {len(done)} done, {len(todo)} to do', flush=True)
def save(): json.dump(done, open(OUT + '.tmp', 'w', encoding='utf-8')); os.replace(OUT + '.tmp', OUT)
t0 = time.time(); n = 0; fails = 0
for i in todo:
    url = f'https://musicbrainz.org/ws/2/recording?query=isrc:{isrc[i]}&fmt=json&limit=25'
    for attempt in range(5):
        try:
            d = json.load(urllib.request.urlopen(urllib.request.Request(url, headers={'User-Agent': 'SpottyExpotty/1.0 (leis.l.ho@gmail.com)'}), timeout=25))
            ds = sorted(x['first-release-date'] for x in d.get('recordings', []) if x.get('first-release-date'))
            done[i] = ds[0] if ds else ''; fails = 0; break
        except urllib.error.HTTPError as e:
            time.sleep(10 if e.code in (429, 503) else 3)
        except Exception:
            time.sleep(5)
    else:
        fails += 1  # left undone: a re-run retries it
        if fails >= 20: print('20 failures in a row, stopping', flush=True); break
    n += 1
    if n % 50 == 0: save(); print(f'{n}/{len(todo)} {round(time.time() - t0)}s found {sum(1 for v in done.values() if v)}/{len(done)}', flush=True)
    time.sleep(1.1)
save(); print('finished', n, round(time.time() - t0), 's', flush=True)
