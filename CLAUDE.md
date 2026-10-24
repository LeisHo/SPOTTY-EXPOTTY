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
- `src/main.js` — boot: registers EVERY on-screen element (title, artist, album line, cover, timeline, stage) with the UI Layout Engine, loads the timeline data, wires input (desktop: wheel = scrub, click on the timeline = jump, click-drag = zoom around the playhead; touch: one-finger drag = scrub, tap = jump, two-finger pinch = zoom; arrow keys), the album-cover play/pause button, the title link to Spotify, and the engine Inspector panel. Layout edits save with the dev panel's Sync as `extra.uiLayout`.
- `src/app/title.mjs` — `cleanTitle()`: strips remaster/live/feat/year/etc. decoration from track names (only bracketed groups and trailing " - " segments containing a keyword or year). `.mjs` so plain `node` can test it.
- `src/app/settings.js` — reads live dev-panel control values by id (`setting('sliderFoo')`), resolving Mobile/Landscape twins; defaults when no panel is built.
- `src/app/clipPlayer.js` — rolling pool of preloaded 30 s Deezer preview clips; random-start playback; fetches fresh URLs from `/api/preview`.
- `src/app/handoff.js` — Spotify iFrame API embed used as an invisible player: plays the real song when scrubbing stops or the cover is clicked, pause/resume toggle, and restarts the track when it ends (loop).
- `src/app/timeline.js` — zoomable canvas timeline: x = date inside a movable view window (bars sized by the Bar Width setting, one row per playlist, playhead, year/month/day/hour ticks), zoom limits from the Zoom Limits range bar, 5 visual styles (None / Glow Stems / Smooth Density / Feature Line / Mood Ribbon) and 4 album-cover colour modes. Uses "virtual time" (real time + 1 s per song index) so songs added in the same instant can still be scrubbed between. The current song is `floor(pos)`: the last song added at or before the playhead, so an empty stretch plays the most recent earlier song.
- `src/app.css` — app styles (kept apart from the template's `style.css`).
- `api/preview.js` — Vercel function: Deezer track ids → fresh preview URLs. `scripts/active/serve.py` has a local stand-in for the same route.
- `api/save-settings.js`, `vercel.json` — the dev panel's GitHub-backed Save/Reset (§12l), live at https://spottypotty.vercel.app. Ported from HANDO's working `api/save-settings.js` (defaults repo `LeisHo/SPOTTY-EXPOTTY`, branch `main`; needs `GITHUB_TOKEN` and `DEV_PANEL_SAVE_SECRET` on Vercel). Commits `data/processed/dev-panel-settings.json`.
- `lib/ui-engine/` — vendored UI Layout Engine; don't edit, re-vendor from `HTML UI ENGINE/`.
- `scripts/active/resolve_previews.py` — one-off, resumable: looks up Deezer preview ids for every song (Deezer by ISRC, optional iTunes fallback).
- `scripts/active/build_timeline.py` — builds `data/processed/timeline.json` from the CSVs plus the lookup output (or, to keep the Deezer ids without the raw lookup file, pass the existing `timeline.json` as its argument), then applies `data/processed/playlist-corrections.json`.
- `scripts/active/fix_stragglers.py` — plans the corrections: songs added to a playlist long after its active period are moved to the playlist active on their date, or dropped from the wrong playlist when the target already has them. `--write` saves `data/processed/playlist-corrections.json`; without it, a dry run. The source CSVs are never edited; delete the corrections file (or one entry) and rebuild to undo.
- `scripts/active/build_cover_colors.py` — one-off, resumable: Spotify oEmbed gives each album's cover URL (one track looked up per album), one 64 px image per unique cover is downloaded, Pillow computes average / vivid / top-3 palette colours. Output is `data/processed/cover-colors.json`.
- `scripts/active/merge_cover_colors.py` — adds `covers` + per-song `c` to `timeline.json` from `cover-colors.json`. Idempotent. **Re-run it after every `build_timeline.py`** (a rebuild drops the colours).
- `data/processed/timeline.json` — what the app loads: every playlist-add event sorted by `Added At`, with Deezer id (`d`, 0 = no clip) and cover-palette index (`c`). Regenerate with `build_timeline.py` then `merge_cover_colors.py`; don't hand-edit.
- `data/processed/cover-colors.json` — album cover colours keyed by track id (see above).
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
- **Input scheme (owner's choice, 2026-10-24): wheel = scrub, click on the timeline = jump, click-drag = zoom with the playhead as origin.** History: an earlier version made drag an absolute "seek to the cursor's date", which read as "click wherever my cursor is" and caused cold loads; it was then relative-drag-scrub with wheel-zoom, which the owner replaced with the scheme above. Touch is separate: one-finger drag scrubs relative to the current scale, tap jumps, pinch zooms. A wheel notch moves the playhead N px along the current zoom scale (`Wheel Scrub Per Notch`), so how many songs a notch skips depends on zoom and density.
- **CSS Anchor Positioning (the engine's `relative` mode) has two hard rules, both hit here:** the anchor target must come EARLIER in the DOM than the element anchored to it (the timeline's markup precedes the cover's), and both must share a containing block (title and timeline use `anchor` mode, not `fixed`, because the artist/meta/cover are `absolute`). Break either and the element silently lands at the top-left with only a console error for a missing target.
- **The embed never reports a pause at the end of a preview.** Measured with `window.__spxEvents`: the last update has `position == duration` (29,713 ms) and `isPaused: false`, then nothing. Looping therefore detects the end by position (plus an unrequested-pause fallback). The restart is sent 500 ms LATER as `seek(0)` + `play()` (re-measured: the same calls sent in the same instant as that last update were ignored; sent ~30 s later they worked), with a fallback that reloads the track if no update shows the position back near 0 after 2 s. Verified through the app's own cover button: end at 41.7 s, restart at 42.2 s, position 0 → 3.1 s. A "playing" flag stuck true is not evidence of playback.
- **The embedded player is silent while the Browser pane (or tab) is hidden.** No `playback_update` events arrive at all, so a loop/playback test run against a hidden pane proves nothing. Show the pane first (`show_pane` → preview) and check `document.hidden === false`.
- **The cover button calls `play()`, not `resume()`.** `resume()` does nothing on an embed that was loaded but never started or whose track ended.
- **Layout decoupling.** The album cover is `anchor`-positioned from the stage bottom (fixed offset 228 px; 178 px / 138 px on phone portrait / landscape), NOT `relative` to the timeline, and its width `clamp` has no ceiling (max 9999px). The cover is `z-index: 0`; title/artist/meta/timeline are `z-index: 2`. So a taller timeline never moves the cover, and a cover scaled up renders behind everything. In `timeline.js` only the bar band grows with the canvas height; the playlist rows (≤76 px) and axis (18 px) are pinned to the bottom. Timeline height is the dev slider (desktop base, applied with `updateElement`); phone heights are the engine's per-context overrides (150 / 110 px), editable in the Inspector.
- **Spotify oEmbed answers HTTP 429 to bursts** (30 of 30 serial lookups failed right after two copies of the cover job ran at 4-14 requests/s; plain 1 request/s was always fine, from curl and Python alike). `build_cover_colors.py` now runs ~2.5 requests/s on 3 workers, pauses every worker 60 s on a 429, retries 404/400 as "no cover" after at most 3 tries, and is resumable. Never run two copies at once, and don't crawl while testing the app's own cover fetch (a 429 reaches the browser as a CORS error because the error response has no CORS header).
- **Timeline colours/styles live in `timeline.js`'s `draw()`; settings come from the dev panel by id.** Style-specific controls are hidden/shown by `refreshSpottyModeVisibility()` (polls every 700 ms, also on input/change, so per-device twins created later are covered).
- **Dev-panel Save is single-tier GitHub, copied from HANDO / HANDY DANDIES.** `saveDevPanelSettings()` POSTs to `/api/save-settings` (gzip+base64) and shows an honest error if that fails; it does NOT fall back to localStorage. Boot and Reset GET the saved file back (boot retries only while the network fails). HANDO/HANDY DANDIES embed the save secret as a constant in `main.js`; this project does NOT (workspace §12l: never in committed/client code): the panel asks for it once per browser and keeps it in localStorage (`devPanelSaveSecret`). Locally, `serve.py` has no GitHub credentials, so Save fails with an error there; test Save on Vercel (`?dev=1`).
- **When asked to match how another project does something, read that project's real source** (HANDO's `api/save-settings.js` and devPanel.js had the defaults, gzip transport and large-file fallback that this project's scaffolded version lacked, and the missing repo default is why the first Vercel probe returned 503).
- **A playlist's first-to-last add date is not its active period.** A single song added years later to an old playlist stretched `Te Quiero` to 3,134 days; `Junior` had one dated 2026-11-10 (after today) making it 4,804 days. `fix_stragglers.py` handles these (15 songs: 11 moved, 4 removed because the right playlist already had them) and takes the spans over 190 days from 15 to 6. Rule: core = densest 190-day window; home = core +/- 45 days; a song outside its playlist's home window goes to the playlist whose core contains its date. `MMXIX`/`MMXX` (year-long playlists, songs from 3 accounts) and `Treinta.Cero_(2)` (every song stamped 2023-09-30, a copy) are deliberately skipped.
- `Treinta.Cero_(2).csv` looks like a copy of `Treinta._Cero` (all songs one date); reported, not investigated.

## Deliberate architecture exceptions

- Every on-screen element's position and size is owned by the UI Layout Engine (§13), including per-device overrides, edited through the engine's own Inspector (dev panel > UI Layout > Open UI Layout Inspector). Not engine-managed, deliberately: the transient "Click to enable sound" overlay and the debug pool overlay (they are not part of the real layout), and **text scale** (engine docs scope typography out), which has three `Text Scale (x)` dev sliders instead.
- The scaffold's "Component Gallery" demo groups were removed from `devPanel.js` (owner's request, 2026-10-24).
