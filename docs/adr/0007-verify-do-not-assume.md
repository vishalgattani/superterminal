---
status: accepted
---
# Verify, do not assume

Every operation that could plausibly half-succeed checks its own result rather than reporting success on the absence of an error. Deploy checks that Claude actually started; reattach checks the tmux session is the same one; the smoke test checks that a bad `Origin` is refused rather than that a good one is accepted.

The concrete failure this came from: spawning a terminal is not starting Claude. Seven of eight repos pre-approve permissions, so the eighth sits at a one-time trust prompt and **waits** — and a deploy that counted spawns reported "7 spawned, 0 failed" over a graph with a dead node in it.

## Considered options
- Trust the exit code — rejected: `ssh` exiting 0 means the transport worked, not that the remote command did what was wanted.
- Verify by hand after each deploy — rejected: it is exactly the check that gets skipped when it matters.

## Consequences
- `runRemote()` never throws, and distinguishes transport failure (ssh exited 255, or was killed) from the remote command saying no, because a caller has to tell those apart.
- Deploy reports name the nodes that did not get a Claude, rather than a count.
- The smoke test asserts on refusals, not just successes.
