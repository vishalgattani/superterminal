# Workflow

Every change is made in its own **git worktree**, on its own **branch**, and
reaches `main` only through a **pull request whose gate is green**. Why it is
this way: [ADR 0010](adr/0010-work-in-worktrees-and-merge-through-a-green-pipeline.md)
(worktrees and the gate) and [ADR 0011](adr/0011-github-actions-ci-and-merging-through-pull-requests.md)
(GitHub Actions and merging through pull requests, which supersedes ADR
0010's GitLab-specific parts).

> **CI runs on every pull request:** `.github/workflows/build.yml` runs the
> same checks as `npm run gate` (typecheck, lint, unit, api, build), split
> across three parallel jobs: `build` (typecheck, build), `lint`, and `test`
> (unit, api). Branch protection requiring them to pass is not turned on
> yet, but is coming soon — until then the discipline is the same either
> way: a red gate does not get merged.

```
fetch  →  worktree  →  change + test  →  rebase  →  npm run gate  →  merge  →  clean up
```

## 1. Start a worktree

```bash
git fetch origin
git worktree add ../csv-<slug> -b <type>/<slug> origin/main
cd ../csv-<slug>
cp -Rc ../superterminal/node_modules node_modules   # APFS clone; or `npm ci`
```

- **`<type>`** is one of `feat`, `fix`, `refactor`, `test`, `docs`, `chore`.
- **One worktree per branch**, named `../csv-<slug>` beside the main checkout.
- **Until the one-time bootstrap push (below), cut from local `main` and rebase on
  `main`, not `origin/main`.** The remote is behind, so `origin/main` misses work
  that is already on `main`.
- **Tests get their own worktree and branch** (`test/<slug>`), separate from the
  feature they cover. They are reviewed and merged on their own, and a feature is
  never checked only by tests written in the same breath as the code.
- Do not edit the main checkout. See [why](#why-not-the-main-checkout).

## 2. Change it, and test it

Run everything from inside the worktree:

```bash
npm test                 # unit tests: no server, no network
npm run test:api         # boots a throwaway server against the stub rig
npm run build            # the UI still builds
```

CI runs Node 22, and local may be newer. Check against it before pushing:

```bash
npx --yes -p node@22 -- npm test
npx --yes -p node@22 -- npm run test:api
```

- **A change has tests, or says why it cannot.** A bug fix starts with a test that
  fails on the old code. Confirm a new suite can fail by breaking the code it
  covers and watching it catch that, then restoring.
- **Never point a test at the owner's running viewer.** `test:api` uses a free
  port and a temp state directory. A scratch server for looking at the UI needs
  its own `CV_CONFIG` (with its own `CV_PORT`) and `CV_STATE_DIR`.
- `npm run smoke` needs **no browser tab open** on that server: a tab adopts the
  test's terminal and takes its output.
- Anything only the real fire box can show (tmux semantics, a real `claude`) is
  checked against **throwaway sessions** in `~/vault` and cleaned up afterwards,
  never against sessions that hold work. Say in the pull request what was and was not run
  against the real box.

## 3. Commit

Ordinary commits in the worktree, small and with a message that says *why*. End
each with the `Co-Authored-By` trailer for the model that wrote it.

## 4. Rebase on main, then test again

```bash
git fetch origin
git rebase origin/main
```

- **Always rebase; never merge `main` into the branch.** History stays linear and
  the pull request shows only this change.
- **Rebase again immediately before merging** if `main` moved, and **re-run the
  tests after every rebase that pulled anything in.** A green run before the
  rebase says nothing about the result after it.
- Resolve a conflict by reading both sides. Never take one wholesale to make it
  go away.
- After a rebase the branch needs `git push --force-with-lease`. Only ever on your
  own feature branch, never on `main`, never bare `--force`.

## 5. Open the pull request

```bash
git push -u origin <type>/<slug>          # a feature branch only, never main
gh pr create --fill --base main
```

The description says **what** changed, **why**, **how it was tested** (the
commands and the counts, not "tests pass"), what was *not* tested, and any
follow-up left open.

## 6. Merge when it is green

Merge only when **all** of these hold:

- the `build`, `lint`, and `test` GitHub Actions checks (typecheck, lint,
  unit, api, build — the same checks `npm run gate` runs, split across three
  parallel jobs) pass on the **current head** of the pull request, after the
  rebase and not before it;
- the branch is rebased on the current `main`;
- there are no unresolved review threads.

```bash
npm run gate                # typecheck, lint, unit, api, build; in the worktree, before pushing
git push --force-with-lease # after a rebase, onto your own branch only
gh pr checks                # wait for build, lint, and test to go green on GitHub
gh pr merge --squash --delete-branch
```

**`main` is merged into only through the pull request, never by a local
`git merge --ff-only` in the main checkout.** GitHub is where the checks run
and where the merge happens; the main checkout is not touched until you pull
the result of it. Branch protection requiring `build`, `lint`, and `test` to
pass before merge is not turned on yet — until then this is discipline, not
enforcement, so treat a red check exactly as if it blocked the merge button.

- **A feature and its tests are two branches, merged in that order.** The tests
  are written to fail on the old code, so merging them first would put a red
  `main` in between. Merge the feature's pull request, rebase the test branch
  onto the result, run the gate, then open and merge the tests' pull request.
- **The merge is what restarts the viewer**, once you pull it into the main
  checkout (see §7). It moves files the running viewer imports, so before
  pulling server code, look at what the viewer holds: local terminals die with
  the restart, remote ones re-adopt. Say what will happen and to what before
  doing it, not after.

See [ADR 0011](adr/0011-github-actions-ci-and-merging-through-pull-requests.md)
for why this replaced the local fast-forward merge.

If the gate (locally or in `build`, `lint`, or `test`) fails, fix it or say
why it is not this change's doing. **Never skip it, never merge red, never retry until it goes
green without reading why it failed.** A test that fails intermittently is a
bug in the test or the code, and gets fixed.

## 7. Clean up

```bash
git worktree remove ../csv-<slug>
git branch -d <type>/<slug>
git worktree prune
```

Then, in the main checkout, pull the merge and build the UI. The pull request
was merged on GitHub in §6, so `main` locally is now behind `origin/main` by
exactly that merge:

```bash
git pull --ff-only       # bring local main level with the merge done on GitHub
npm run build            # dist/ is gitignored, so the UI served from here goes stale
```

The pull touches files the running viewer imports, so under `node --watch`
**it restarts, and local terminals die with it** (remote ones re-adopt, under
new ids, with their alias replaced by the folder name). Tell the owner when
that is about to happen.

What the owner then does depends on how the viewer is running:

- **`npm run dev`, on `:5173`:** nothing to rebuild. Vite reloads UI edits by
  itself and `node --watch` restarts the server; refresh the tab if it looks stale.
- **`npm run viewer`, on `:8788`:** it serves the built bundle, so the `npm run
  build` above is what makes a UI change appear, and a server change needs the
  viewer restarted (`scripts/viewer.sh --restart`).

## What still needs the owner

- **Anything outside the repository or its remote:** repository/branch
  protection settings on GitHub, `~/.claude/settings.json`, credentials.
  `config.env` is gitignored and holds the instance id, IP, key path and
  token; never commit it, and keep those values out of commit messages and
  pull request descriptions.
- **Turning on branch protection** for `main` requiring the `build`, `lint`,
  and `test` checks (below) — planned, not yet enabled.

## One-time bootstrap

Until the first push, `origin/main` was behind local `main`. A branch cut from
`origin/main` would have missed that work, and a first pull request from local
`main` would have carried it all. The owner approved one fast-forward push of
`main` to bring the remote level; that has happened, and everything since goes
through pull requests.

## CI

`.github/workflows/build.yml` runs on every push to `main` and every pull
request targeting it, as three parallel jobs with no `needs:` between them —
the same checks `npm run gate` runs locally, split so a failure names which
side broke without opening the log:

- **`build`**: `npm run typecheck`, `npm run build`.
- **`lint`**: `npm run lint`.
- **`test`**: `npm test`, `npm run test:api`.

Each job does its own checkout and `npm ci`, since jobs run on separate
runners with no shared filesystem. Node 22, matching `engines.node` in
`package.json`; `node-pty` compiles a native module during `npm ci`, which
`ubuntu-latest`'s toolchain handles without extra setup.

Branch protection requiring `build`, `lint`, and `test` to pass before merge
is not turned on yet — the owner's call, planned once the workflow has run
cleanly a few times. Until then, a red `build`, `lint`, or `test` check on a
pull request is treated as blocking by discipline, the same as a red `npm
run gate` always has been.
See [ADR 0011](adr/0011-github-actions-ci-and-merging-through-pull-requests.md).

## Why not the main checkout

- **Several sessions share it and its index.** One session's `git commit` swept
  another's half-finished work into a commit about something else; a `grep -n`
  followed by a `sed -n` straddled a commit and returned the wrong lines. Each
  worktree has its own index and its own files.
- **The viewer runs from it.** Under `node --watch`, an edit to a server file
  restarts the viewer and kills the owner's local terminals mid-use.
- **Its built UI is separate.** `apps/web/dist` is gitignored, so a build in a
  worktree never reaches what the main checkout serves, and the reverse.

If you truly must work in the shared checkout, **commit by pathspec** (`git commit
-- <files>`), never a bare `git commit`, and check `git status` first.
