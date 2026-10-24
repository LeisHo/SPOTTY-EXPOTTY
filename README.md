# SPOTTY EXPOTTY — visualizing a Spotify playlist diary

A single-user personal tool for exploring a Spotify playlist diary (about
6,300 song-add events across 42 playlists). Scroll or drag through a timeline
and the songs flash past as short preview clips; stop, and the real song plays
in Spotify's embedded player. This is a personal prototype, not a production
app.

See `docs/PROJECT_SUMMARY.txt` for the current state (objective, scope,
current state, recent decisions, known limitations, next action — the part
that changes often) and `docs/PROJECT_PROGRESS.md` for what's being worked
on right now. This README stays a short pointer, not a duplicate of either —
don't let real content drift into this file instead of those.

## How to run it

No build step. It needs the local server (plain `file://` can't load the
data file or the preview proxy). With Python 3 installed:

```bash
py scripts/active/serve.py 8000
```

Then open `http://localhost:8000/index.html`, click "Click to enable sound",
and scroll the mouse wheel to scrub (click the timeline to jump; click-drag to
zoom around the playhead; on touch, drag scrubs and pinch zooms; the album cover
plays/pauses the song and the title links to Spotify). Press `D` for the
dev panel. Its Save button commits to GitHub, so it only works on the Vercel
site (`https://spottypotty.vercel.app/?dev=1`), where the save secret is already built into the page (see CLAUDE.md for where it lives). Full Spotify playback needs you to be
logged in to Spotify in the same browser; otherwise the embed plays a
30-second preview. On Vercel, `api/preview.js` serves the same proxy route.

To rebuild the data file after changing the CSVs:

```bash
py -I scripts/active/resolve_previews.py <links.json> --no-itunes
py -I scripts/active/build_timeline.py <links.json>
py -I scripts/active/merge_cover_colors.py        # album cover colours (run after every build_timeline.py)
```

## Project structure

```
SPOTTY EXPOTTY/
├── index.html, src/         the app (src/app/ = project code; src/devpanel/ = dev panel)
├── api/                     Vercel functions (preview-link proxy, optional settings save)
├── lib/ui-engine/           vendored UI Layout Engine
├── data/
│   ├── Exportify Export/    source CSVs (read-only inputs)
│   └── processed/           timeline.json (what the app loads)
├── docs/                    PROJECT_SUMMARY, CODE_SUMMARY, PROJECT_PROGRESS, CHANGELOG, HANDOFF
└── scripts/active/          serve.py, resolve_previews.py, build_timeline.py
```

See `CLAUDE.md` for the per-file map.

## Known limitations

See `docs/PROJECT_SUMMARY.txt`'s Known Limitations section for the current,
maintained list — not duplicated here to avoid drift between two copies of
the same information.

## Roadmap

No formal roadmap is tracked separately. See `docs/PROJECT_PROGRESS.md` for
what's currently being worked on and what's next, and `docs/CHANGELOG.txt`
for the full history of what's been built.
