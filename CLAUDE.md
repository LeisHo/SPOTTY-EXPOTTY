# SPOTTY EXPOTTY — Project Conventions

<One or two sentences: what this project is, in plain terms. Long-form docs
live in `docs/` (`PROJECT_SUMMARY.txt`, `CODE_SUMMARY.txt`,
`PROJECT_PROGRESS.md`, `CHANGELOG.txt`, `HANDOFF.md`) — this file is only a
map and a list of gotchas, per the workspace `CLAUDE.md` §11's own
instruction for what a new project's `CLAUDE.md` should cover. Keep it
short; link to `docs/` for anything long-form rather than restating it here.>

<If this project is built on the workspace-standard HTML scaffold (dev
panel §12 + UI Layout Engine §13), say so here and name which files are
verbatim template copies vs. project-authored — see LENTICULOSO/CLAUDE.md
for a worked example of this note. If it deliberately skips one or both
(no real layout complexity, a single-file exception, etc.), state that
explicitly instead, per §12/§13's own "when it doesn't fit" clause — don't
leave the omission unexplained.>

## File map

<What's in `src/` vs `scripts/active` vs `scripts/archive` vs `data/raw`,
and what's load-bearing vs safe-to-ignore. One bullet per real top-level
file/folder that isn't self-explanatory:>

- `<path>` — <what it is, what depends on it.>

## Untouchable systems

<Subsystems that must not be touched incidentally. Won't exist yet for a
brand-new project — state "None yet" and add entries as they're identified,
rather than leaving this section absent.>

## Vocabulary

<Project-specific vocabulary, opaque identifiers, or domain jargon, defined
once here rather than re-explained every time it comes up.>

## Known gotchas

<Real bugs already hit and fixed, so a later session doesn't rediscover
them. State "None yet" for a brand-new project.>

## Deliberate architecture exceptions

<Any explicit exception to a workspace-wide default this project doesn't
follow, and why — e.g. "this file stays a single file on purpose" or "no
dev panel — no real layout complexity to manage." State the exception here
rather than deciding privately and leaving no record (per workspace
CLAUDE.md §11a).>
