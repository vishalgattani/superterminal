---
status: accepted
---
# The Host interface exists from day one; the pty layer never builds commands

A `Host` turns a `SpawnRequest` into a `SpawnPlan` (an argv, a cwd, an env). The local host runs a shell directly; the fire host wraps the same request in `ssh -t … tmux new-session -A`. The pty layer receives a finished plan and never assembles a command itself. This interface was written while only `local` existed, because adding a remote host had to be a new file rather than a refactor of the hot path.

## Considered options
- Build the argv in the pty manager, branch on host — rejected: the branch multiplies with every host, in the one file where a mistake costs every session.
- Add the interface later, when the second host arrives — rejected on the same reasoning as superterminal's [client/server split](https://github.com/sonnylazuardi/superterminal/blob/main/docs/adr/0002-client-server-from-day-one.md): retrofitting an ownership model rewrites the thing it owns.

## Consequences
- A new remote host is a new `Host` implementation plus a registry entry, with no change to `pty/manager.ts`.
- The registry reports *why* a host is unavailable, so "why can I not pick SSH" is answerable from the UI.
- This is what makes generalising the single hardcoded `fire` host into an N-host registry a config and type change rather than a rewrite.
