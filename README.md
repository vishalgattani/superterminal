# superterminal

*A terminal of terminals for Claude, by Claude.*

A low-latency browser terminal for running and watching Claude Code sessions,
locally and on the "fire" EC2 instance. Sessions live in tmux on the remote
box, so they outlive the connection, the tab and the viewer itself.

New to the codebase? Skip to **[Working on the code](#working-on-the-code)**
for the architecture, invariants and traps that are not visible in the code.

| | |
|---|---|
| **Terminals** | Local and remote over SSH. Remote sessions run in tmux and survive disconnection |
| **Views** | Graph (canvas with tabs), Kanban, Agents, History |
| **Status** | Live, from `claude agents --json`. No hooks, no settings changes |
| **Instance** | 🟢🟡🔴⚪ light for the EC2 box, with Start |
| **History** | Browse, read, resume or fork any past session |
| **Presets** | Save a whole graph and redeploy it in one click |
| **Cost** | Per session, read from the statusline already in the terminal |

---

## Requirements

| | Needed | Notes |
|---|---|---|
| **Node** | >= 22 | Verified on 26. The server runs TypeScript directly via Node's type stripping, so there is no build step and no `tsx` |
| **npm** | >= 10 | npm workspaces, not pnpm |
| **OS** | macOS or Linux | Developed on macOS 15, Apple silicon |
| **Browser** | Chromium or Safari with WebGL | Falls back to the DOM renderer automatically |
| **On the remote box** | `tmux` | Already installed (3.2a) |

Nothing is installed globally. `node-pty` ships its `spawn-helper` without the
executable bit on macOS, so a `postinstall` script fixes it; if you ever see
`posix_spawnp failed`, run `npm run postinstall`.

## Quick start

```bash
npm install
npm run viewer    # builds the UI, serves it, prints the URL with its token
```

Two ways to run it, and they are not interchangeable.

| | | |
|---|---|---|
| **Use it** | `npm run viewer` | Builds the UI and serves it on `:8788`. Ctrl-C stops it |
| **Work on it** | `npm run dev` | Server under `node --watch` plus Vite on `:5173`, hot reload. Ctrl-C stops both |

`npm run viewer` rebuilds every time on purpose: `apps/web/dist` is gitignored,
so a stale bundle is invisible — the server serves last week's UI and nothing
says so. It also refuses to clobber a viewer that is already running, because
that viewer owns live terminals; pass `--restart` when you mean it, or `-b` to
run in the background and log to `.state/viewer.log`.

`npm run dev` requires `CV_TOKEN` pinned in `config.env` and says so if it is
not. Under `--watch` the server mints a fresh token on every edit, so an
unpinned tab starts refusing requests the moment you save a file — which reads
like a bug in whatever you were editing. Open the **5173** URL it prints, not
the server's own port: Vite serves the UI and proxies `/api` and `/ws`. Add
`&debug=1` for a footer with keystroke echo and paint times.

**The token is required** on every request.

### Configuration

`cp config.example.env config.env`, then edit. It is gitignored and holds the
port, default directory, and the EC2 instance id, IP and key path. The server
and the vendored scripts read the same file, so those values exist once.

---

## Using it

**Create** a terminal from the toolbar, or right-click the canvas to place one
where you clicked. Pick a host and optionally a directory; blank means the
host's home.

**Nodes** show the folder, host, live grid size, the Claude session id when one
is running, and the session cost. They size to their content, drag freely, and
carry an **i** button for full details.

- **Click** a node to open its terminal; click again to collapse.
- **Double-click the title** to rename. The alias is yours; Claude is never
  told about it, so renaming cannot confuse a running session.
- **Right-click** a node for Open, Rename, **Fork session** and Close. Fork
  runs `claude --resume <id> --fork-session`, leaving the original transcript
  untouched. It is disabled where no Claude is running.
- **Closing** a local node ends its shell. A remote node lives in tmux, so the
  dialog offers two choices: **Disconnect** lets go and leaves the session
  running (it returns on the next viewer start), **Terminate** ends the tmux
  session and everything in it. If the box cannot be reached, Terminate says so
  and keeps the node, so a session is never hidden while still running.
- **External sessions** (live Claude sessions the viewer did not start) appear
  as dashed cards below your terminals, and in the matching Kanban column, so a
  background agent waiting on input is something you can see, not a count. A
  card offers **Attach** when the session runs in tmux and **Stop** always
  (never on the session running the viewer). Attach turns the card into a real
  terminal in the same place. Cards cannot be linked, grouped or saved into a
  preset, and the **External** button on the canvas hides them.
- **Folders** shows the folders your sessions live in: a node for each ancestor
  folder, joined to what it holds by faint dotted lines that are visibly not
  context links. Folders are per host (`~/vault` on fire and a local `~/vault`
  are different nodes), a session at a path stands for that folder, and a chain
  that leads to one thing is one node (`~/repos`). They follow the active view's
  sessions, are derived rather than stored, and cannot be linked, grouped or
  saved into a preset. **LR / TD** then lay the tree out, external cards
  included, and the tree runs the same way.
- **Cmd/Ctrl+click** adds to a selection, **Shift+drag** draws a selection box,
  and dragging any selected node moves the whole selection.
- **Select 2+ and press Group** to enclose them in a named, translucent frame.
  Drag the frame's label to move the group; double-click it to rename.
- **LR / TD / grid** arrange the canvas; the **floppy** saves it as a preset.

**Views** are the tabs across the top. The first, **main**, is the overview: it
always shows every session and cannot be closed. `+` adds a view that starts
**empty**, and **+ Add sessions** opens a picker to choose which sessions it
shows, so a view is the subset you are working with. Each view has its own
layout and frames.

- A terminal you create, attach, fork or resume while a view is open joins that
  view. The overview and your other views are left alone.
- **Right-click a node → Remove from this view** stops showing it there; the
  session keeps running and stays on the overview. The node's **×** still closes
  the session, and a closed session leaves every view.
- Sessions the viewer did not start appear as cards on the overview only, and
  the Kanban board stays global, because both exist to answer "what needs me".
- Right-click a tab to duplicate it: **Connections only** copies the subset and
  its layout (duplicating main freezes what it shows into a subset), **New
  Claude sessions** spawns a fresh copy of just that view's sessions.
- **Views survive a page reload and a viewer restart.** They are saved to the
  server (`.state/views.json`) shortly after each change and loaded when the page
  opens. Fire sessions come back into their views even though a restart gives
  them new ids, because a session is saved under its tmux name. A local terminal
  does not survive a restart (it dies with the server), so it drops out of its
  views then, and only then. Saving a view as a preset is still how you keep the
  *workflow* (deployable, portable), as opposed to the arrangement.

**If a remote connection drops**, the node says `disconnected` and offers
**Reattach**, which rejoins the same tmux session with its work still running.

### Connecting sessions

Drag from one node's right handle to another's left. That creates a **context
link** and types a reference to the source into the target's terminal: its
folder, host, Claude session id and transcript path. The text is left
**unsubmitted** for you to review.

Links are a capability, not decoration: the server refuses to write into a
session unless a link points at it, in that direction. They are many-to-many,
server-owned, survive restarts, and are dropped when either session ends.

### Views

| View | For |
|---|---|
| **Graph** | The canvas. Default |
| **Kanban** | What needs you: waiting for input, working, idle, plus shell-only terminals |
| **Agents** | Every live Claude session on every host, including ones the viewer never started, with its transcript, Attach and Stop |
| **History** | Every past session per host, searchable, filterable by active/inactive, readable, resumable and forkable |

The header carries the instance light and a stats bar: terminals per host, live
Claude sessions, and how many past sessions are inactive.

### Presets

**Presets** (header button) are named graphs. Two are built in, matching the
MIL workflows:

- `mil-integration` — vault → virtual-generator → its five controller repos
- `mil-integration-testing` — the same with the integration test repo between

A preset stores nodes, edges **and groups**, as indices rather than session
ids, since ids are minted fresh on each deploy. Saving from a view (the floppy
on the canvas, or Snapshot in this panel) saves exactly the sessions that view
shows, with the links between them and its frames; saving from main saves
everything. Deploying a preset opens a new view holding exactly what it
spawned. Each renders as an inline SVG
graph (LR/TD), exports as PlantUML for vault docs, and imports/exports as JSON
so a workflow can live on disk or be shared. Deploy spawns everything, waits
for Claude to register, and **reports which nodes did not come up** rather than
claiming success.

### Keyboard

| Key | Does |
|---|---|
| `Tab` / `Shift+Tab` | Cycle sessions, **when no terminal has focus** |
| `Enter` | Hand the keyboard to the open terminal |
| `Esc` | Leave the terminal, return focus to the graph |

A focused terminal receives **every** keystroke untouched, because Claude Code
binds `Shift+Tab` itself. The graph may only claim it while you are not typing
into a session.

---

## Security

This server opens shells, so anything that reaches it can run commands as you.

1. **Loopback only.** It binds `127.0.0.1` and must never bind `0.0.0.0`.
2. **A token** on every API request and WebSocket upgrade.
3. **`Origin` and `Host` validation.** A WS upgrade is not subject to CORS, so
   the token alone is not enough; this is what stops DNS rebinding.
4. **Stop is pid-checked.** Only pids that `claude agents --json` itself
   reported can be signalled, and never the process tree the viewer runs in.

Do not expose the port with a tunnel or reverse proxy. Remote access works the
other way round: the viewer reaches out over your existing SSH.

---

## Verifying

```bash
npm test                     # 104 checks over apps/web/src; no server needed
npm test -- views            # only test files whose name contains "views"
npm run test:api             # 31 checks against a throwaway server on stub ssh
npm run smoke -- <token>     # 11 checks: auth, pty round trip, resize, Origin
#   run it with no browser tab open on that server: a tab adopts the test's
#   terminal and takes its output (one live viewer per session)
ssh -i ~/.ssh/<key> <host> 'bash -s' < scripts/fire-probe.sh   # read-only probe
```

`npm test` runs the unit tests in `scripts/tests/`, each in its own process
(the store is a module-level singleton, so sharing one process would let the
order decide the result). They import the real `.ts` sources, which node
strips types from directly, so there is no build step and no test framework.
They cover the folder tree, the tree layout, views as subsets, and saving and
reloading views — including the server-restart case that once wiped a saved
view.

`npm run test:api` starts a real server and binds a port, but still touches
nothing outside the machine: `scripts/tests/rig/bin` holds stub `ssh`, `tmux`
and `claude` executables, and the runner puts them first on `PATH`, so the
server's whole remote path runs with no fire box, no EC2 and no network. Its
state goes to a temp directory, never the repo's `.state/`, and the port is
one the OS says is free — two checkouts can run it at once. It covers the
`/api/views` document the browser saves (every way it can be malformed, plus
a damaged file on disk) and preset saving from a view. See
`scripts/tests/rig/README.md`.

Measured on this machine: keystroke echo **0.1 to 2.0 ms**, paint **0.2 to
0.8 ms**, and a **12.7 MB** output burst streamed with median main-thread lag
of **1 ms**.

Beyond the smoke test, the things that actually break are timing or
integration problems, best checked by hand:

1. Open a terminal, run `claude`, confirm the TUI renders on the alternate
   screen and typing feels immediate (`&debug=1` shows echo in ms).
2. Kill the ssh client for a fire session
   (`pkill -f "tmux new-session -A -s cv-<id>"`) and confirm the node says
   `disconnected` and **Reattach** rejoins the same tmux session.
3. Restart the server and confirm sessions are re-adopted and links restored,
   in that order, in the log.
4. Deploy a preset and confirm the report names any node that did not get a
   Claude, rather than claiming success.

## Known limits

- **Views are one shared copy.** Two browser tabs on the same viewer save over
  each other, last write wins. A fire session that was unreachable when the
  viewer started keeps its place in its views and rejoins them once it is
  re-adopted, but only on the next page load.
- **External sessions not in tmux** can be watched and stopped but not
  attached: there is no terminal to join.
- **No hooks.** Everything works by polling, deliberately, so a profile swap
  cannot blind the viewer. A 19-event http hook block was designed as a local
  plan doc (`docs/plan/`, gitignored — see [Working on the
  code](#working-on-the-code)) and nothing needs installing to work without
  it.
- **Deploy is not `VGSIM_DEV`-aware** (deferred, see the roadmap).
  `virtual-generator` only needs a session per controller repo when
  `VGSIM_DEV_<repo>` points at a local checkout; none are set, so the five
  controller edges in `mil-integration` are a fixed template rather than
  reflecting reality.
- **Cost needs a statusline** that prints a dollar figure. Without one, no cost
  is shown rather than `$0.00`, which would read as free.
- **Forking needs a conversation.** Forking a session that has not said
  anything fails with `No conversation found`.

---

## Working on the code

Everything a newcomer needs is above. Everything else lives in `docs/`.

**Changes are made in a git worktree and merged through a pull request only
once the gate is green**: see [docs/WORKFLOW.md](docs/WORKFLOW.md). `npm run
gate` is that gate — typecheck, unit tests, API tests against a stub rig, and
the build — and it also runs as the `build` GitHub Actions check
([.github/workflows/build.yml](.github/workflows/build.yml)) on every pull
request.

| | |
|---|---|
| [docs/DEV.md](docs/DEV.md) | Architecture, where each area lives, how to verify a change |
| [docs/INVARIANTS.md](docs/INVARIANTS.md) | Break these and things fail in ways that look like something else |
| [docs/TRAPS.md](docs/TRAPS.md) | Bugs already paid for, recorded so they are not reintroduced |
| [docs/RULES.md](docs/RULES.md) | Rules the owner set, not preferences to re-litigate |
| [docs/adr/](docs/adr/) | Why things are the way they are, one decision per file |
| `docs/plan/` | Working plan drafts — local only, gitignored like `CLAUDE.md`; a settled plan graduates to an ADR |
