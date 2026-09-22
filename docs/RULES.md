# Rules the owner set

Not preferences to re-litigate.

- **Work in a worktree, and reach `main` through a green gate.** Every change is
  made in its own git worktree on its own branch, tested there, rebased on
  `main`, and merged only once `npm run gate` passes on the rebased head. There
  is **no CI yet**, so that command is the gate; once there is, it is the
  pipeline and merges go through a merge request. Never force-push a shared
  branch, never skip the gate, never merge past a red one. Test work gets its
  own worktree. **`main` is fast-forwarded to the branch (`git merge --ff-only`),
  never merged into, and a feature's tests follow it rather than lead it.** See [WORKFLOW.md](WORKFLOW.md) and
  [ADR 0010](adr/0010-work-in-worktrees-and-merge-through-a-green-pipeline.md).
  (This replaced "commit every change, never push".)
- **Never `git add -A`, `git add .`, or `git commit -a`. Stage by pathspec.**
  Name the files. Several sessions share this checkout and its index, so a
  blanket add sweeps up another session's unfinished work; and it stages things
  `.gitignore` does not actually cover — that is how a `node_modules` *symlink*
  was committed and pushed (`cae8676`), since the rule `node_modules/` matches a
  directory but not a link of the same name.
- **Do not edit `~/.claude/settings.json`** beyond adding hooks, and only if
  asked. The viewer reads profiles, never writes or switches them.
- **Nothing viewer-specific in repo `CLAUDE.md` files.** They are committed to
  shared repos, and connection state is per-session runtime state that a
  committed file cannot express. Context reaches a session at runtime, via
  `--append-system-prompt-file` at launch or the typed reference on connect.
- `config.env` is gitignored and holds the instance id, IP, key path and token.
  Never commit those, and keep them out of commit messages.
