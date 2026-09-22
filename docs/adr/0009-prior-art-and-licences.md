---
status: accepted
---
# Prior art is borrowed from by licence, and recorded here

Which projects may be borrowed from, and how, is a decision with legal consequences, so it is written down rather than remembered.

| Project | Licence | How it may be used |
|---|---|---|
| `doctly/switchboard` | MIT | Patterns may be borrowed |
| `craftzdog/tmux-claude-hatch` | MIT | Patterns may be borrowed; `claude agents --json` came from here |
| `sonnylazuardi/superterminal` | MIT | Patterns may be borrowed; this `docs/` layout came from here |
| `siteboon/claudecodeui` | AGPL | **Out.** Not borrowed from |
| `KyleAMathews/claude-code-ui` | **none** | Concepts only — no licence file means no grant |
| Terminal Graph | closed source | Documented concepts only |

## Considered options
- Track this in commit messages as things are borrowed — rejected: it answers "where did this come from" but not "may I borrow from this", which is the question that gets asked first.

## Consequences
- A new dependency or borrowed pattern adds a row here before the code lands.
- Absence of a licence file is treated as strictly as a hostile licence, because it is.
