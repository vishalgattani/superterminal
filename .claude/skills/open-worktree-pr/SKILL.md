---
name: open-worktree-pr
description: Start a change in this repo the way docs/WORKFLOW.md requires — a fresh git worktree on its own branch, cut from main — and open a draft pull request once the gate is green. Use whenever starting new work in superterminal, or when asked to "start a worktree" or "open a PR" for a change here.
---

# Open a worktree and a pull request

This repo never commits to `main` directly and never edits the shared
main checkout (see `docs/WORKFLOW.md` and
`docs/adr/0010-work-in-worktrees-and-merge-through-a-green-pipeline.md`).
Every change gets its own worktree, its own branch, and reaches `main`
only through a pull request whose `build` check is green.

## Steps

1. **Fetch and branch.**

   ```bash
   git fetch origin
   git worktree add ../csv-<slug> -b <type>/<slug> main
   cd ../csv-<slug>
   npm ci   # never cp -Rc from the main checkout: it restarts the running viewer (#59)
   ```

   `<type>` is one of `feat`, `fix`, `refactor`, `test`, `docs`, `chore`.
   Tests for someone else's change get their own `test/<slug>` branch, not
   folded into the feature branch.

2. **Change it, test it.** Run `npm test`, `npm run test:api`, `npm run
   build` from inside the worktree, never against the main checkout's
   running viewer. CI runs Node 22; check with `npx --yes -p node@22 --
   npm test` if local Node is newer.

3. **Commit.** Small, ordinary commits with a message that says *why*.
   End each one authored by an AI agent with a `Co-Authored-By` trailer
   naming the model.

4. **Rebase on `main`, retest.**

   ```bash
   git fetch origin
   git rebase origin/main
   npm run gate
   ```

   Never merge `main` into the branch. Resolve conflicts by reading both
   sides, never by taking one wholesale.

5. **Push and open a draft PR.**

   ```bash
   git push -u origin <type>/<slug>
   gh pr create --draft --fill --base main
   ```

   The description says what changed, why, how it was tested (commands
   and counts, not "tests pass"), and what wasn't tested.

6. **Confirm green, then hand off.** `gh pr checks --watch` until the
   `build` check passes on the current head. Do not `gh pr merge` — that
   button is the repo owner's, always.

7. **Clean up** once merged: `git worktree remove ../csv-<slug>`, `git
   branch -d <type>/<slug>`, `git worktree prune`.

See `docs/WORKFLOW.md` for the full rationale and the "why not the main
checkout" section if tempted to skip the worktree.
