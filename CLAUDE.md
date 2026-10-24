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
- `src/main.js` — boot: registers `#appStage` with the UI engine, loads the timeline data, wires input (click-drag / one-finger drag = relative scrub; mouse wheel / two-finger pinch = zoom the timeline; arrow keys), the album-cover play button, and the title/artist/meta text.
- `src/app/title.mjs` — `cleanTitle()`: strips remaster/live/feat/year/etc. decoration from track names (only bracketed groups and trailing " - " segments containing a keyword or year). `.mjs` so plain `node` can test it.
- `src/app/settings.js` — reads live dev-panel control values by id (`setting('sliderFoo')`), resolving Mobile/Landscape twins; defaults when no panel is built.
- `src/app/clipPlayer.js` — rolling pool of preloaded 30 s Deezer preview clips; random-start playback; fetches fresh URLs from `/api/preview`.
- `src/app/handoff.js` — Spotify iFrame API embed used as an invisible player: plays the real song when scrubbing stops or the cover is clicked, pause/resume toggle, and restarts the track when it ends (loop).
- `src/app/timeline.js` — zoomable canvas timeline: x = date inside a movable view window (histogram of adds per ~3 px bar, one row per playlist, playhead, year/month/day/hour ticks). Uses "virtual time" (real time + 1 s per song index) so songs added in the same instant can still be scrubbed between.
- `src/app.css` — app styles (kept apart from the template's `style.css`).
- `api/preview.js` — Vercel function: Deezer track ids → fresh preview URLs. `scripts/active/serve.py` has a local stand-in for the same route.
- `api/save-settings.js`, `vercel.json` — the dev panel's GitHub-backed Save/Reset (§12l), live at https://spottypotty.vercel.app. Ported from HANDO's working `api/save-settings.js` (defaults repo `LeisHo/SPOTTY-EXPOTTY`, branch `main`; needs `GITHUB_TOKEN` and `DEV_PANEL_SAVE_SECRET` on Vercel). Commits `data/processed/dev-panel-settings.json`.
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
- **The invisible Spotify embed must stay on-screen to produce audio.** Parked at `left:-10000px` it never played (tested); it now sits bottom-left at 1% opacity, behind the page, click-through (`.spx-embed` in app.css). Don't use `display:none` or move it off-screen.
- **Drag scrubbing is relative, not absolute.** Mapping the cursor's x to a date made every click jump somewhere new (cold loads, "click wherever my cursor is"). Now a drag of dx px moves the playhead dx px along the current zoom scale; the wheel zooms instead of scrubbing. Don't reintroduce absolute-cursor seeking.
- **Dev-panel Save is single-tier GitHub, copied from HANDO / HANDY DANDIES.** `saveDevPanelSettings()` POSTs to `/api/save-settings` (gzip+base64) and shows an honest error if that fails; it does NOT fall back to localStorage. Boot and Reset GET the saved file back (boot retries only while the network fails). HANDO/HANDY DANDIES embed the save secret as a constant in `main.js`; this project does NOT (workspace §12l: never in committed/client code): the panel asks for it once per browser and keeps it in localStorage (`devPanelSaveSecret`). Locally, `serve.py` has no GitHub credentials, so Save fails with an error there; test Save on Vercel (`?dev=1`).
- **When asked to match how another project does something, read that project's real source** (HANDO's `api/save-settings.js` and devPanel.js had the defaults, gzip transport and large-file fallback that this project's scaffolded version lacked, and the missing repo default is why the first Vercel probe returned 503).
- **`Junior.csv` has a song `Added At` 2026-11-10 (after the data's export date)** and `Treinta.Cero_(2).csv` looks like a copy of `Treinta._Cero`; both are reported, not investigated.

## Deliberate architecture exceptions

- The app's inner layout is plain CSS (`src/app.css`), not `createUIElement()`; only `#appStage` is registered with the UI engine. There's no real cross-viewport positioning complexity yet (§13's "when it doesn't fit" clause). Revisit if the visualization grows panels/overlays that need responsive anchoring.
- The scaffold's "Component Gallery" demo group is still in `devPanel.js` (copied with the template); it is reference-only and can be removed.
