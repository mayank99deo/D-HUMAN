@AGENTS.md
@MEMORY.md

## Keeping the project memory

`MEMORY.md` is this project's memory and is loaded with this file.

- After every change, add an entry to its Log, newest first, under today's date.
- After every push, record the commit hash in that entry. A commit can't contain its own hash, so add it right after pushing; the edit goes out with the next commit.
- Commits that only update this memory (such as recording a hash) don't get their own log entry.
- Keep the Snapshot, Gotchas and Open items current. Edit them in place rather than appending contradictions.
- Never write secret values (API keys, the webhook URL or secret). Variable names only.

## The crew

Ten specialist agents live in `.claude/agents/` (product and engineering lead, chief of staff, staff engineer, systems and data engineer, AI efficiency lead, product designer, UX and retention designer, graphic designer, QA and security engineer, SEO lead). `docs/team/CREW.md` says who does what and how work flows. The main session orchestrates: agents can't start other agents, so dispatch them from the plan, then log their work here and commit only after Mayank agrees.
