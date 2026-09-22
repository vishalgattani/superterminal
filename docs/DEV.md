# Working on the code

The architecture, and how to check a change actually works.

For the rules that are not visible in the code, see
[INVARIANTS.md](INVARIANTS.md), [TRAPS.md](TRAPS.md), [FIRE.md](FIRE.md)
and [RULES.md](RULES.md). For why things are the way they are, see
[adr/](adr/).

---

## Architecture

```
browser ──HTTP──▶ Fastify (127.0.0.1:8788) ──node-pty──▶ ssh ──▶ tmux ──▶ claude
   │  ▲                   │                                       (fire, EC2)
   │  └── WS /ws/term/:id ┘  binary frames, raw pty bytes
   └───── GET /api/status every 3s: instance light, session activity,
          terminals, links, orphans
```

One server, one browser tab, many terminals. The server owns every durable
fact; the browser owns what a view means and tells the server to remember it.

| Lives on the server | Lives in the browser |
|---|---|
| Sessions (ptys) | The live picture of them, refreshed every 3 s |
| Links between sessions | Selection |
| Presets (`.state/presets.json`) | Which view is open, and the panel |
| Link persistence (`.state/links.json`) | Views, held here and saved on change |
| Saved views (`.state/views.json`) | External cards' positions (never saved) |

The server stores views as one document and only checks its shape and size; it
never interprets them. A **connection** (a link) is a capability the server
enforces. An **arrangement** (a view, its layout, frames) is what the owner
wants to see, and is remembered for convenience. A **preset** is the portable,
deployable form of a workflow.

| Area | File |
|---|---|
| Boot, auth hook, listen, polling timers | `apps/server/src/index.ts` |
| Shared state built once at boot | `apps/server/src/context.ts` (`AppContext`) |
| Routes, by area | `apps/server/src/routes/{status,sessions,links,presets,transcripts,agents}.ts` |
| Deploy a graph, re-adopt tmux sessions, links on disk | `deploy.ts`, `reconcile.ts`, `links.ts` (same folder) |
| ssh helper for short remote commands | `apps/server/src/fire/ssh.ts` |
| pty lifecycle, flow control, attach tokens | `apps/server/src/pty/manager.ts` |
| Spawn argv per host | `apps/server/src/hosts/{local,fire}.ts` |
| Session status by polling | `apps/server/src/status/agents.ts` + `scripts/claude-agents.py` |
| Transcript index and digests | `apps/server/src/status/transcripts.ts` + `scripts/scan-transcripts.py` |
| Instance light | `apps/server/src/fire/instance.ts` |
| Saved views: store, routes, the browser's side | `apps/server/src/views.ts`, `routes/views.ts`; `apps/web/src/lib/persist.ts` (keys, hydrate, retain) |
| Folder tree | `apps/web/src/lib/folders.ts` (pure), `components/FolderNode.tsx`, `TreeHandles.tsx` |
| Client state, in slices | `apps/web/src/store.ts` composes `store/{ui,sessions,tabs,links,status}.ts`; types in `store/model.ts` |
| Terminal wiring, flow control, metrics | `apps/web/src/lib/termSocket.ts` |
| Canvas, menus, selection | `apps/web/src/components/Graph.tsx` |
| Cards for sessions the viewer did not start | `ForeignNode.tsx`, `ForeignActions.tsx`, `ConfirmStop.tsx` |

Route modules receive the `AppContext` and destructure what they use, so a
file says what it touches. Every route must still be registered in `index.ts`
before `listenWithRetry()`. Store slices share one `State` and may read each
other through `get()`; put new state in the slice whose area it belongs to, and
keep importing from `store.ts`, which re-exports the model.

Running a scratch copy of the server (a test rig) needs no edits to the real
config or state: `CV_CONFIG` points it at another config file and
`CV_STATE_DIR` at another state folder.

---

## Verifying

```bash
npm test                     # 104 checks over apps/web/src; no server needed
npm test -- views            # only test files whose name contains "views"
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

