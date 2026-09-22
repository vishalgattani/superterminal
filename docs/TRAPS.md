# Traps already hit

Each cost real time. They are fixed; this is so they are not reintroduced.

| Symptom | Cause | Fix in |
|---|---|---|
| Every pty spawn fails, `posix_spawnp failed` | node-pty ships `spawn-helper` without the executable bit on macOS | `scripts/fix-pty-helper.mjs`, runs on postinstall |
| Terminal blank, "WebSocket is closed before the connection is established" | Origin check allowed only the server port; Vite proxies from 5173 | `auth.ts`, `devPorts` |
| Fire terminals reliably blank, local ones intermittently | React StrictMode double-mounts: socket A connects, B attaches, A's close cleared B's sink | `attachToken` in `pty/manager.ts` |
| Remote scan returns nothing, looks like an ssh failure | `execFile`'s `input` option is silently ignored; that belongs to `execFileSync` | `pipeIn()` in `status/transcripts.ts` and `status/agents.ts` |
| Server dies on boot: "Fastify instance is already listening" | A route registered after `app.listen()` | keep all routes above `listenWithRetry()` |
| Dragging a group pans the canvas | React Flow pans via a native d3 listener; React's `stopPropagation` never reaches it | `nopan nodrag` classes in `GroupFrames.tsx` |
| Renaming a node jumps the viewport | React Flow zooms on double-click by default | `zoomOnDoubleClick={false}` |
| Rename box opens but typing goes to the shell | The double-click's click half re-opened the pane, whose focus effect took the keyboard back | `focusOnOpen` in `store.ts`, plus `autoFocus` |
| Multi-select does nothing | React Flow's `select` changes were ignored, so no node was ever marked selected | `onNodesChange` in `Graph.tsx` |
| Node shows `2×44` briefly, TUI wraps oddly | A fit during the panel's width animation measured a collapsing container | debounce plus a minimum size in `termSocket.ts` |
| `~/vault` renders as `vault/~` | CSS `direction: rtl` reorders the text, it does not just clip it | `elidePath()` in `SessionNode.tsx` |
| UI stops responding to clicks that should work | Vite served two copies of the store after a failed HMR | restart Vite, do not debug the code |
| A saved view comes back empty after a viewer restart | A page left open reconciled the vanished sessions out of its views and autosaved that | `noteBoot` in `store/tabs.ts`, the `bootId` in `/api/status` |
| The open tab starts 401ing while developing | `node --watch` regenerates the token on every server edit | set `CV_TOKEN` in `config.env` |
| A re-adopted remote terminal opens blank, though tmux has content and the stream is live | tmux sends only deltas. The full screen — including the switch to the alternate screen — was painted into the pty when `tmux attach` ran at boot, with no browser attached, so the browser's xterm never entered the alt buffer and tmux believes the client is current | not fixed yet |
