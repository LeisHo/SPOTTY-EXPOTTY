# SPOTTY EXPOTTY — Project Conventions

An HTML project to visualize, analyze and interpret the owner's personal
Spotify playlists, which are kept as a chronological music diary (see
Vocabulary). Long-form docs live in `docs/` (`PROJECT_SUMMARY.txt`,
`CODE_SUMMARY.txt`, `PROJECT_PROGRESS.md`, `CHANGELOG.txt`, `HANDOFF.md`) —
this file is only a map and a list of gotchas.

Built on the workspace-standard HTML scaffold: the dev panel (§12) and the
vendored UI Layout Engine (§13). `src/devpanel/devPanel.js` and
`src/style.css` are verbatim template copies plus this project's own
`renderSpottyDevControls()` (search "SPOTTY EXPOTTY's own settings" in
devPanel.js). Everything under `src/app/`, `src/app.css`, `src/main.js` is
project-authored.

## File map

- `index.html` — page shell; loads `src/main.js` (module) and the dev panel script.
- `src/main.js` — boot: registers `#appStage` with the UI engine, loads the timeline data, wires wheel / touch-drag / arrow-key scrubbing.
- `src/app/settings.js` — reads live dev-panel control values by id (`setting('sliderFoo')`), resolving Mobile/Landscape twins; defaults when no panel is built.
- `src/app/clipPlayer.js` — rolling pool of preloaded 30 s Deezer preview clips; random-start playback; fetches fresh URLs from `/api/preview`.
- `src/app/handoff.js` — Spotify iFrame API embed; plays the real song when scrubbing stops.
- `src/app/timeline.js` — canvas timeline (weekly add-count histogram, one row per playlist, playhead); drag to seek.
- `src/app.css` — app styles (kept apart from the template's `style.css`).
- `api/preview.js` — Vercel function: Deezer track ids → fresh preview URLs. `scripts/active/serve.py` has a local stand-in for the same route.
- `api/save-settings.js`, `vercel.json` — scaffold's optional git-tracked dev-panel settings upgrade (§12l); unused until its env vars are set.
- `lib/ui-engine/` — vendored UI Layout Engine; don't edit, re-vendor from `HTML UI ENGINE/`.
- `scripts/active/resolve_previews.py` — one-off, resumable: looks up Deezer preview ids for every song (Deezer by ISRC, optional iTunes fallback).
- `scripts/active/build_timeline.py` — builds `data/processed/timeline.json` from the CSVs plus the lookup output.
- `data/processed/timeline.json` — what the app loads: every playlist-add event sorted by `Added At`, with Deezer id (`d`, 0 = no clip). Regenerate with `build_timeline.py`; don't hand-edit.
- `data/Exportify Export/` — the source CSVs; read-only inputs.

## Untouchable systems

None formally designated yet. Don't hand-edit `lib/ui-engine/` or the template-derived parts of `src/devpanel/devPanel.js`.

## Vocabulary

Source: owner's own account of how the playlists are made (2026-10-23).

- **Diary playlists** — each playlist is a chronological list of songs that
  caught the owner at that point in time (new songs, familiar songs, or songs
  already in an earlier playlist). No genre separation. Cap ~150 songs with a
  tolerance of ~15; usually 3 playlists per year.
- **Age naming** — playlists are named `<age>.<0|1|2>`, e.g. `25.0` is the
  first playlist made at age 25. Each age uses a different language for the
  name, so file names differ by age (e.g. "Treinta" = 30 in Spanish,
  "Vingt-Huit" = 28 in French, "Tiga Puluh Dua" = 32 in Indonesian,
  "Trideset Tri" = 33 in Serbian/Croatian). Identify the other languages
  from the CSV file names themselves; don't guess.
- **Short playlists** — a playlist shorter than ~150 usually means a birthday
  fell mid-list and the owner moved to the next age's set.
- **Early outliers** — "Junior", "Senior", "Super Senior" are college years;
  between those sets sits one standalone summer playlist.
- **Data** — `data/Exportify Export/Tingo Tango/*.csv` holds the diary
  playlists (Exportify CSVs: track/album/artist, release date, `Added At`,
  genres, label, and audio features such as danceability, energy, valence,
  tempo, key, mode). Other CSVs directly in `data/Exportify Export/` are
  other (non-diary) playlists.

## Known gotchas

- **Deezer preview links expire in ~15 minutes** (measured 14.98 min) and Deezer's API sends no CORS header. Never save preview URLs to a file; save Deezer track ids and resolve fresh URLs through `/api/preview`.
- **Don't cache failed lookups.** A Deezer quota error once got cached as "no clip" for 10 minutes, so most songs went silent while scrubbing fast. Only real URLs are cached; a null is retried after 20 s.
- **Deezer allows ~50 lookups / 5 s per IP; bursts return error code 4.** The proxy (serve.py and api/preview.js) rate-limits to 8/s and retries code 4; the client requests one song at a time, nearest the playhead first, and caps preload-ahead at 16. Running `resolve_previews.py` at the same time shares the limit and makes live lookups fail.
- **Never seek into an unbuffered part of a clip.** `canplay` fires after only a few seconds are buffered; seeking to a random 2-22 s offset then stalls while the browser re-fetches, which sounds like "loading". `clipPlayer.js` starts only after >=2 s are buffered and picks the offset inside the buffered range.
- **Measure latency with a listener on the audio element itself.** The clips are detached `Audio()` objects, so a document-level `playing` listener never sees them, and counting `play()` calls over-reports (it hid the stall above).
- **Unlock sound on the first click/key anywhere**, not only the overlay button: at narrow widths the dev panel covered the button and sound never unlocked. The overlay is `position: fixed` above the panel with only the button clickable. The listeners attach after the data finishes loading, so a click in the first moment after load is ignored.
- **Spotify's iFrame API replaces the element you give it** with its iframe. Pass it an inner placeholder inside a wrapper, or the wrapper's styles vanish.
- **Test pointer interactions with real `pointerdown` + `click`, not a bare `.click()`** (§12 undo lesson); a bare click skips the pointerdown path.
- **Don't kill the dev server with a command-line pattern** matching `serve.py`: it also matches your own shell wrapper. Use the PID from `netstat -ano | grep :8000`.
- **Playback needs one click** before browsers allow audio; the "Click to enable sound" overlay exists for this.
- **`Junior.csv` has a song `Added At` 2026-11-10 (after the data's export date)** and `Treinta.Cero_(2).csv` looks like a copy of `Treinta._Cero`; both are reported, not investigated.

## Deliberate architecture exceptions

- The app's inner layout is plain CSS (`src/app.css`), not `createUIElement()`; only `#appStage` is registered with the UI engine. There's no real cross-viewport positioning complexity yet (§13's "when it doesn't fit" clause). Revisit if the visualization grows panels/overlays that need responsive anchoring.
- The scaffold's "Component Gallery" demo group is still in `devPanel.js` (copied with the template); it is reference-only and can be removed.
