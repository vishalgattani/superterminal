---
status: accepted
---
# CI is GitHub Actions, and `main` is merged into only through pull requests

This repository's remote is `git@github.com:vishalgattani/superterminal.git`,
not GitLab. [ADR 0010](0010-work-in-worktrees-and-merge-through-a-green-pipeline.md)
was written against a GitLab remote and said so explicitly — that record
stands as-is, kept rather than rewritten, because it describes what was
believed at the time. This entry supersedes only the two things that were
tied to that assumption: which CI system runs, and how a branch reaches
`main`.

`.github/workflows/build.yml` runs two parallel jobs, `build` (`npm run
typecheck`, `npm run build`) and `test` (`npm test`, `npm run test:api`), on
every push to `main` and every pull request targeting it — the same four
checks `npm run gate` runs locally, so local and CI cannot drift apart by
being spelled differently. `main` is
merged into only through a pull request once that workflow is green; a local
`git merge --ff-only` into the main checkout is no longer the merge step.
Branch protection requiring the workflow to pass before merge is the next
step, on the owner's call, once the workflow itself has run a few times.

## Considered options
- Keep local `--ff-only` merges, add no CI — rejected: nothing but
  `npm run gate`, run by whoever merges, stops a red merge, and there is no
  independent check or record of what passed.
- GitLab CI (`.gitlab-ci.yml`) — not applicable: the remote is GitHub, which
  does not run GitLab CI config.
- Merge commits instead of PRs, gated by a status check pushed some other
  way — rejected: GitHub pull requests are the natural place to attach a
  required check and a review, and are what branch protection rules act on.

## Consequences
- `docs/WORKFLOW.md` §5–6 describe `gh pr create` and merging on GitHub
  instead of `glab mr create` and a local `--ff-only` merge.
- A worktree branch is still rebased on `main` before opening the pull
  request, and again if `main` moves before merging — only the merge
  mechanism changes, not the rebase discipline from ADR 0010.
- Once branch protection is turned on, `build` and `test` become required
  checks and a red pull request cannot be merged through the UI at all, not
  just by convention.
- `docs/adr/0010-*.md` is left as written; this entry is the one to read for
  the current state of CI and merging.
