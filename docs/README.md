# docs

| | |
|---|---|
| [DEV.md](DEV.md) | Architecture, where each area lives, how to verify a change |
| [WORKFLOW.md](WORKFLOW.md) | Worktree, rebase, `npm run gate`, merge when green |
| [INVARIANTS.md](INVARIANTS.md) | Break these and things fail in ways that look like something else |
| [TRAPS.md](TRAPS.md) | Bugs already paid for, recorded so they are not reintroduced |
| [REMOTE-NOTES.md](REMOTE-NOTES.md) | Generalized facts about running against a real remote box |
| [RULES.md](RULES.md) | Rules the owner set, not preferences to re-litigate |
| [perf/](perf/) | Measurements, dated |

## Decisions

One decision per file, numbered, never renumbered. A decision that is reversed
gets `status: superseded by NNNN` in its frontmatter and stays where it is —
the record of what was believed, and why, is the point.

| | Decision |
|---|---|
| [0001](adr/0001-polling-is-the-floor-hooks-are-an-enhancement.md) | Polling is the floor; hooks are an enhancement nothing may depend on |
| [0002](adr/0002-profiles-are-observed-never-controlled.md) | Settings profiles are observed, never controlled |
| [0003](adr/0003-config-is-a-shell-sourceable-env-file.md) | Configuration is a shell-sourceable KEY=value file, not TOML |
| [0004](adr/0004-hosts-behind-an-interface-from-day-one.md) | The Host interface exists from day one; the pty layer never builds commands |
| [0005](adr/0005-remote-sessions-live-in-tmux.md) | Remote sessions live in tmux, so they outlive the connection |
| [0006](adr/0006-a-connection-is-a-capability-an-arrangement-is-a-convenience.md) | A connection is a capability; an arrangement is a convenience |
| [0007](adr/0007-verify-do-not-assume.md) | Verify, do not assume |
| [0008](adr/0008-typescript-end-to-end-not-go-or-rust.md) | TypeScript end to end — not Go, not Rust |
| [0009](adr/0009-prior-art-and-licences.md) | Prior art is borrowed from by licence, and recorded here |
| [0010](adr/0010-work-in-worktrees-and-merge-through-a-green-pipeline.md) | Every change is made in a worktree and merged through a green pipeline |
| [0011](adr/0011-github-actions-ci-and-merging-through-pull-requests.md) | CI is GitHub Actions, and `main` is merged into only through pull requests |

## Plan

`plan/` is gitignored, like `CLAUDE.md` — working drafts, local only, not
part of this checkout. A plan worth keeping graduates into a numbered
decision above instead.
