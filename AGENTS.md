# AGENTS.md

Instructions for AI coding agents (Claude Code, and any other agent
harness) working in this repository. `CLAUDE.md` at the repo root is a
symlink to this file, so Claude Code reads exactly what every other
agent reads — one file, not two to keep in sync.

## What this is

**superterminal**: a low-latency browser terminal for running and
watching Claude Code sessions, locally and on remote hosts over SSH.
Remote sessions live in tmux, so they outlive the connection, the
browser tab, and the server itself. See [README.md](README.md) for the
full feature set and how to run it.

## Commands

```bash
npm install               # workspace install; postinstall fixes node-pty's spawn-helper bit
npm run dev                # server under node --watch + Vite on :5173, hot reload
npm run viewer              # builds the UI, serves it on :8788, prints the token URL
npm run typecheck           # tsc --noEmit across packages/shared, apps/server, apps/web
npm test                    # unit tests (scripts/tests/*.test.mjs), no server needed
npm run test:api            # API tests against a throwaway server + stub ssh/tmux/claude rig
npm run build                # builds apps/web/dist
npm run gate                 # typecheck && test && test:api && build — the merge gate
```

There is no lint step yet (no ESLint config exists in this repo) — see
`docs/plan/add-lint-job.md` if present locally (that directory is
gitignored, so it may not be).

## Layout

- `packages/shared` — wire-protocol types shared by server and web
  (`@cv/shared`).
- `apps/server` — Fastify + node-pty backend (`@cv/server`): opens and
  tracks ptys, the terminal WebSocket, the HTTP API, remote-host and
  "fire" EC2-instance management.
- `apps/web` — React + Vite + React Flow frontend (`@cv/web`): the
  session graph UI.
- `scripts/` — standalone dev/ops scripts; `scripts/tests/` is the test
  suite, `scripts/tests/rig/` holds fake `ssh`/`tmux`/`claude`
  executables the API tests run against.
- `docs/` — architecture, invariants, traps, rules, and one
  Architecture Decision Record per file under `docs/adr/`. Read
  `docs/DEV.md` before touching server or web internals, and
  `docs/RULES.md` for rules the owner has already settled — they are
  not preferences to re-litigate.

## Workflow

Changes are made in a git worktree, on its own branch, and reach `main`
only through a pull request whose `build` GitHub Actions check is
green — never a local fast-forward merge. Full steps, including the
worktree layout and rebase discipline: [docs/WORKFLOW.md](docs/WORKFLOW.md).
Why: [docs/adr/0010](docs/adr/0010-work-in-worktrees-and-merge-through-a-green-pipeline.md)
and [docs/adr/0011](docs/adr/0011-github-actions-ci-and-merging-through-pull-requests.md).

- A change has tests, or says why it cannot.
- `npm run gate` must pass on the rebased branch head before opening a
  pull request.
- Commit messages say *why*, not just what; end each commit an AI agent
  authored with a `Co-Authored-By` trailer naming the model.
- `config.env` is gitignored and holds real host/credential data —
  never commit it, and keep its values out of commit messages and pull
  request descriptions.

## Conventions worth knowing before editing

- No comments that restate what the code does; a comment is for a
  non-obvious *why* (a constraint, an invariant, a workaround).
- Don't add abstractions, error handling, or config for cases that
  cannot happen here — this is a small, opinionated codebase, not a
  library.
- `apps/web/dist` is gitignored build output; never hand-edit or
  commit it.
- `docs/plan/` is gitignored, local-only scratch — a plan worth keeping
  graduates into a numbered ADR under `docs/adr/` instead.
