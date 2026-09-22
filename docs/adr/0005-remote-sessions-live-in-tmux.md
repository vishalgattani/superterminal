---
status: accepted
---
# Remote sessions live in tmux, so they outlive the connection, the tab and the viewer

Every remote session is `tmux new-session -A -s cv-<id>` over `ssh -t`. `-A` attaches if the session exists and creates it otherwise, which makes one command serve as both the create path and the reattach path. The connection is disposable; the session is not.

## Considered options
- A bare `ssh` with the process attached to the connection — rejected: a dropped link, a closed tab or a viewer restart would kill live work.
- `screen`, or a custom supervisor — rejected: tmux 3.2a is already installed on the box and the owner already knows it.

## Consequences
- The tmux session name is **stored, not derived**. It is minted from the terminal id, but a terminal re-adopted after a restart has a new uuid and an old tmux name; deriving it shows no Claude and no cost. See [../INVARIANTS.md](../INVARIANTS.md).
- `reconcile.ts` can re-adopt sessions at boot by listing tmux on the remote host.
- Attaching to a session someone else created uses `tmux attach -t`, not `-A`: `-A` would silently create an empty shell if the name were wrong.
- The tmux session execs a **login** shell, because `claude` is not on PATH for a non-interactive one. See [../FIRE.md](../FIRE.md).
