# SPOTTY EXPOTTY — <one-line tagline>

<1-3 sentence description: what this project is, what it does. If it's a
prototype/research project rather than a production app, say so plainly here
(see DOGGO's README for an example: "This is not a production app.").>

See `docs/PROJECT_SUMMARY.txt` for the current state (objective, scope,
current state, recent decisions, known limitations, next action — the part
that changes often) and `docs/PROJECT_PROGRESS.md` for what's being worked
on right now. This README stays a short pointer, not a duplicate of either —
don't let real content drift into this file instead of those.

## How to run it

<Exact steps to run/use the project. No build step? Say so. Needs a server,
an API key, a specific Python/Node version? State it here precisely — this
is the one doc a new person (or a fresh AI chat) needs to get the thing
running without guessing.>

## Project structure

```
SPOTTY EXPOTTY/
├── src/                     <what actually ships — see docs/CODE_SUMMARY.txt>
├── data/
│   ├── raw/                 <scraped/dumped/regenerable inputs — gitignored>
│   └── processed/           <data the app actually reads>
├── docs/                    <README (pointer only — this file), PROJECT_SUMMARY.txt,
│                             CODE_SUMMARY.txt, PROJECT_PROGRESS.md, CHANGELOG.txt,
│                             and any HANDOFF doc(s)>
├── scripts/
│   ├── active/               <scripts still run regularly>
│   └── archive/               <one-off scripts that already did their job>
├── logs/                    <log entries from tests, audits, queries, etc>
├── results/                 <raw results of tests/runs>
└── tests/                   <if a real test suite exists>
```

<Adjust this tree to the project's actual layout — this is the standard
skeleton (CLAUDE.md §11), not every project needs every folder. A project
small enough to justify a single-file architecture can skip most of this
and say so explicitly in its own CLAUDE.md instead.>

## Known limitations

See `docs/PROJECT_SUMMARY.txt`'s Known Limitations section for the current,
maintained list — not duplicated here to avoid drift between two copies of
the same information.

## Roadmap

No formal roadmap is tracked separately. See `docs/PROJECT_PROGRESS.md` for
what's currently being worked on and what's next, and `docs/CHANGELOG.txt`
for the full history of what's been built.
