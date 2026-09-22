---
name: babysit-ci
description: Watch a pull request's CI in this repo after pushing, fix red checks with fixup commits, then collapse them with an autosquash rebase and mark the PR ready for review. Use after pushing to a PR branch here, or when asked to "babysit the PR", "watch CI", or "get this PR green".
---

# Babysit a pull request's CI

Extends `docs/WORKFLOW.md` §5–6 with the iteration loop for getting a
pushed branch to a clean, green, reviewable state — without hand-editing
history mid-flight.

## Loop

After every push to the PR's branch:

```bash
gh pr checks <n> --watch
```

- **All green** → done iterating, go to "Finish" below.
- **Red** → read the actual failure, don't guess:

  ```bash
  gh run view <run-id> --log-failed
  ```

  Fix it, then commit the fix as a **fixup commit** against the specific
  commit that introduced the problem:

  ```bash
  git commit --fixup <sha>
  git push
  ```

  Do not amend, do not force-push mid-loop, do not squash by hand — fixup
  commits keep every push independently re-checkable. Repeat until green.

- **Failure not caused by this change** → say so in a PR comment with
  evidence (link the failing run, note it also fails on `main`), rather
  than reworking unrelated code to silence it.

## Finish: rebase, autosquash, mark ready

```bash
git fetch origin
git rebase --autosquash origin/main   # or the stacked base branch, if this PR is stacked
npm run gate                          # re-run after any rebase that pulled anything in
git push --force-with-lease           # your own branch only, never main
gh pr checks <n> --watch              # confirm green again on the rebased head
gh pr ready <n>
```

`--autosquash` collapses every `fixup!` commit into the commit it
targets, so the merged history reads as if it had been written clean —
the fixup churn was for CI iteration, not for the reviewer.

**Never `gh pr merge`.** That is always the repo owner's call.
