---
status: accepted
---
# Polling is the floor; hooks are an enhancement nothing may depend on

Session status is discovered by polling `claude agents --json` every 3 s, never by Claude Code hooks. The owner swaps `~/.claude/settings.json` between two profiles by hand, and a profile swap replaces the whole file: any hook the viewer installed would vanish with it, silently. So the viewer must be fully functional with zero hooks installed, and hooks may only ever buy sub-second latency and per-tool detail on top of a picture that is already correct.

## Considered options
- Hooks as the primary transport — rejected: a profile swap blinds the viewer, and the failure is invisible rather than loud.
- Hooks as an optional accelerator, polling retained underneath — the accepted position. Designed in [../plan/01-hooks.md](../plan/01-hooks.md); nothing is installed.

## Consequences
- Status is at worst 3 s stale, which is acceptable for "who needs me".
- Reverse tunnels from the fire box are proven to work, so the transport for hooks exists whenever it is wanted. See [0005](0005-remote-sessions-live-in-tmux.md).
- Auto-denied permissions under the `auto` profile stay invisible until someone looks, which is the main thing hooks would fix.
