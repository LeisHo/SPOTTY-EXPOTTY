# SPOTTY EXPOTTY — Project Progress

**This is a live document, not a log.** It holds only the current picture —
what's being worked on right now, what's recently done, and what's next. It
does **not** accumulate a running history of every past session; that
history already lives in `CHANGELOG.txt` (the append-only, authoritative
record — see CLAUDE.md §4a/§4). When something here is finished and no
longer relevant to understand what's current, remove it from this file
rather than leaving it to pile up. Rewrite the sections below in place at
each real update — don't append a new dated block underneath the old one.

This doc functionally doubles as a handoff document (CLAUDE.md §4c): a
brand-new AI chat with no prior context should be able to read this file
alone and know exactly where the project currently stands, and pick up the
work seamlessly from there.

--------------------------------------------------------------------------------

## Currently working on

Nothing in progress — see What's next.

## Recently completed

- Scaffolded the project and pushed it to GitHub (LeisHo/SPOTTY-EXPOTTY).
- Measured preview-clip coverage, link expiry and playback latency.
- Built the scrub player: timeline, clip pool, Spotify handoff, preview proxy, data file.
- 2026-10-24 round: wheel-scrub / click-jump / drag-zoom input, last-song-before-playhead rule, 4 timeline visual styles + album-cover colour modes, bar width + zoom limits, title link, loop fix, all elements on the UI Layout Engine with its Inspector, Component Gallery removed.

## What's next

1. Owner tries it locally (`py scripts/active/serve.py 8000`) and tunes the dev-panel settings (scrub per notch, zoom speed, timeline style, album colour mode, layout via the Inspector).
2. Test on a real phone and on Vercel (the preview proxy, touch scrub/pinch and the Vercel save are untested there).
3. Decide the next visualization/analysis (audio-feature trends over time, artists/genres, repeats across playlists, release year vs added date).
4. Optional: iTunes fallback for the 837 songs with no Deezer clip (loose matches; ~1 h at its rate limit).

## Open questions / blockers

- Which visualization/analysis to build next (owner's call).
- Item 12 of the owner's 2026-10-24 first message was cut off and never received.
- The album-cover colour data (`data/processed/cover-colors.json`) must be produced by `build_cover_colors.py` (slow: Spotify oEmbed rate-limits) and merged with `merge_cover_colors.py` after every `build_timeline.py`.
