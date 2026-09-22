---
status: accepted, CI deferred
---
# Every change is made in a worktree and merged through a green pipeline

> **Deferred in part, on the owner's call.** The worktree-and-branch half stands
> and is in force. The pipeline half does not exist yet: `.gitlab-ci.yml` was
> written and then held back, so the gate is `npm run gate` run by whoever
> merges — the same four checks a pipeline would run. Nothing below is wrong
> about what was decided; it describes the end state, and the CI half of it has
> not been built. Kept rather than rewritten, because the record of what was
> believed and why is the point.

Work happens in a git worktree on its own branch, is tested there, is rebased on `main`, and reaches `main` only through a merge request whose pipeline has passed. This replaces "commit every change, never push", which had `main` as the place work was done, checked by whoever remembered to.

What it came from, all of it hit in practice: several sessions shared one checkout and one index, so a bare `git commit` swept another session's unfinished work into an unrelated commit and a line-number lookup straddled a commit and returned the wrong lines; the running viewer imports the checkout's files, so under `node --watch` every server edit restarted it and killed the owner's local terminals; and `apps/web/dist` is gitignored, so the UI the viewer served went stale without anyone noticing. A worktree has its own index and its own files, and a merge request is a point where what was verified is written down and a machine checks it again.

## Considered options
- Keep committing to `main` and never push — rejected: nothing runs the tests but the author, `main` is whatever was last committed, and there is no record of what was checked.
- Branches without worktrees — rejected: a branch still shares the working tree and index, which is the actual hazard.
- GitHub Actions for CI — not possible: the remote is GitLab, which does not run GitHub Actions workflow files. CI would be `.gitlab-ci.yml`, a thin wrapper over the npm scripts so the logic is portable. The shape it should take is recorded in WORKFLOW.md rather than lost.
- Gate merges by convention only — accepted for now, and doubly so while there is no pipeline: nothing but this document and `npm run gate` stops a red merge. GitLab's "pipelines must succeed" setting is off as well. Both are the owner's call.

## Consequences
- Pushing a **feature branch** is now allowed; pushing `main` directly is not. The rule "never push" is superseded.
- Tests must exist for what the pipeline runs, and a bug fix starts with a test that fails on the old code. Test work has its own worktree and branch.
- Local `main` was ahead of `origin/main`; that one-time approved push has happened.
- Until CI exists, `npm run gate` is the single command that means "green", so local and CI cannot drift apart by being spelled differently.
- Merging a change restarts the viewer under `node --watch`; the owner is told, and `npm run build` is re-run in the main checkout.
- See [WORKFLOW.md](../WORKFLOW.md) for the steps.
