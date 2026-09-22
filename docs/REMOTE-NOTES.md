# Notes from running against a real remote box

Generalized from real use, with anything specific to one particular machine
(its hostname, when it was checked, its repo names and permission counts)
left out. If you point this at your own remote, these are the surprises
worth knowing before you do:

- **`claude` is usually not on PATH for a non-interactive shell.** ssh runs a
  non-login, non-interactive shell by default, and `claude` typically lives
  somewhere like `~/.local/bin/claude` that only a login shell's profile puts
  on PATH. Remote commands should use the absolute path rather than a bare
  `claude`, which otherwise fails silently. The tmux session this project
  spawns execs a **login** shell for the same reason.
- **A project's `.claude/settings.local.json` pre-approving permissions
  matters.** Without it, Claude Code shows a one-time prompt per
  configuration and **waits** for it — which is why a freshly deployed
  terminal can report "up" with no Claude actually doing anything in it.
- **Transcripts nest subagents under the session that spawned them:**
  `~/.claude/projects/<slug>/<uuid>.jsonl` is a session's own transcript, and
  `<uuid>/subagents/agent-*.jsonl` are its subagents'. Counting every
  `*.jsonl` file under a project as "a session" overcounts significantly,
  since it also counts every subagent transcript as if it were its own
  session.
- **Reverse tunnels work when `AllowTcpForwarding` is unset** (its default is
  `yes`), which is the path a webhook or a callback from the remote box back
  to the machine running this would take, if you need one.
- **If you swap between multiple Claude settings profiles by hand** (say, a
  direct-API one and a Vertex one), they can differ in things like
  `permissions.defaultMode` (`auto` vs `acceptEdits`) and `tui`. A tool like
  this one should only ever read such profiles, never write or switch them.
