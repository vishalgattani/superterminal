# Invariants

Break these and things fail in ways that look like something else.

1. **A session is identified by `(host, sessionId)`, never by path.** Two
   terminals in the same folder are different sessions. Matching Claude
   sessions to terminals by cwd was a real bug: two terminals in `~/vault`
   both showed the same session id and cost.
2. **`info.tmuxSession` is stored, never derived.** It is minted as
   `cv-${sessionId.slice(0,8)}`, but a terminal re-adopted after a restart has
   a *new* uuid and an *old* tmux name. Deriving it makes every re-adopted node
   show no Claude and no cost.
3. **Links are a capability, not decoration.** `POST /api/sessions/:id/input`
   refuses unless a link exists from the named source, in that direction. Gate
   any new way of writing into a session the same way.
4. **Raw bytes to the browser, decoded text only on a side tap.** The pty
   stream is forwarded untouched. The cost scraper reads a decoded copy via
   `ptys.onOutput`, which must never sit between the pty and the socket.
5. **Nothing may signal the viewer's own process tree.** `OWN_PIDS` is computed
   at boot by walking this process's ancestry. The viewer is usually started
   from inside a Claude session, which appears as a live agent like any other;
   stopping it would kill the viewer.
6. **Spawning a terminal is not starting Claude.** Verify against
   `claude agents --json` rather than assuming, or you report "7 spawned, 0
   failed" while a repo sits at a trust prompt.
7. **A page must not save views while its picture of the sessions is stale.**
   When the server restarts, every session vanishes and returns (fire ones under
   new ids). A page that reacts by dropping them from their views and then
   autosaves writes that loss to disk. Each server start has a `bootId`; a
   changed one stops saving until the saved copy has been loaded again, and
   nothing is ever saved before the first load.

