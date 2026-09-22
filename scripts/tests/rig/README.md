# The test rig

Stub executables that let the server's whole remote path run without touching
the fire box. `run-api.mjs` copies this folder to a temp directory, points
`PATH` at the copy's `bin/`, and starts the server against it — so the server
resolves `ssh`, `tmux` and `claude` to these instead of the real ones.

| stub | what it fakes |
|---|---|
| `bin/ssh` | ignores every option and runs the last argument locally, so remote commands land in the fake tmux. `touch <rig>/down` makes it fail like an unreachable host (exit 255) |
| `bin/tmux` | a session is a file holding its client's pid. Enough for `new-session -A`, `attach`, `list-sessions`, `list-panes` and `kill-session`, with tmux's own error text for a missing session. `list-panes` prints `panes.txt` (`<pid> <session>`), or `cwd-panes.txt` (`<session>\|<window_active>\|<pane_active>\|<path>`) when asked for `pane_current_path` |
| `bin/claude` | `agents --json` prints `agents.json`; anything else is `cat` |
| `bin/claude-fire` | the remote Claude path: reports no agents |

The stubs resolve their own directory, so nothing here hardcodes a path. The
copy is what runs, which means a test may write into it (`down`, `panes.txt`,
`agents.json`) without dirtying the repo, and two sessions on one checkout get
a rig each.
