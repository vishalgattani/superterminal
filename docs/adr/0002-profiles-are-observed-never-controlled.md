---
status: accepted
---
# Settings profiles are observed, never controlled

The owner keeps two Claude Code settings profiles (one direct, one Vertex, differing in `permissions.defaultMode` and `tui`) and copies one into `~/.claude/settings.json` by hand. The viewer detects and displays which is active. It never writes that file, never switches profiles, and launch commands stay bare so a spawned session inherits whatever is current.

## Considered options
- A profile switcher in the UI — rejected: it makes the viewer own a file the owner owns, and a half-applied swap is worse than no swap.
- Passing per-session flags to override the profile — rejected: the session would then not match what the owner sees when they run `claude` by hand, which is the whole point of the display.

## Consequences
- The viewer reads `~/.claude/settings.json` and never opens it for writing. See [../RULES.md](../RULES.md).
- Adding hooks would mean editing that file, which is why [0001](0001-polling-is-the-floor-hooks-are-an-enhancement.md) keeps them optional.
