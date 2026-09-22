---
status: accepted
---
# A connection is a capability; an arrangement is a convenience

A **link** between two sessions is enforced by the server: `POST /api/sessions/:id/input` refuses unless a link exists from the named source, in that direction. A **view** (its membership, layout and frames) is what the owner wants to see. Views and layouts are remembered so a reload does not lose them, but nothing depends on them, and a **preset** remains the portable, deployable form of a workflow.

This supersedes an earlier formulation, "an arrangement is disposable", which stopped being true when views were made to persist across a reload.

## Considered options
- Views enforced server-side like links — rejected: it makes the server interpret what a view *means*, which is the browser's job.
- Views kept purely in browser storage — rejected: a viewer restart lost them, and the owner reasonably expected them back.

## Consequences
- The server stores views as one opaque document and checks only its shape and size.
- Views are one shared copy: two tabs on the same viewer save over each other, last write wins.
- Persisting views created a new failure mode — a stale page autosaving a loss — handled by the `bootId` guard in [../INVARIANTS.md](../INVARIANTS.md).
