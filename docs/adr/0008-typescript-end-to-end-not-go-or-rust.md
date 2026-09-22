---
status: accepted
---
# TypeScript end to end, server and UI — not Go, not Rust

| Layer | Choice |
|---|---|
| Language | TypeScript, server and UI, npm workspaces, shared protocol types |
| Runtime | Node >= 22 (verified on 26). Native type stripping, so no build step and no `tsx` |
| Server | Fastify + `ws` |
| Terminal | `node-pty` server side; `@xterm/xterm` with WebGL and fit addons client side |
| UI | React 19, Vite, `@xyflow/react`, Zustand |
| Persistence | JSON under `.state/`. tmux for the sessions themselves |
| Remote | System `ssh` with `ControlMaster`. No `ssh2` library |

The latency path is `keystroke → WS → pty → ssh → EC2 → claude` and back, dominated by the round trip to EC2. The server's own hop is under 1 ms in any of the three languages. What actually decides whether typing feels native is the xterm **WebGL** renderer, a warm **ControlMaster**, **binary frames** and **flow control** — all language-independent. Measured through Node: 0.1 to 2.0 ms echo, 0.2 to 0.8 ms paint, and a 12.7 MB burst streamed with 1 ms median main-thread lag.

## Considered options
- Rust or Go server for the pty layer — rejected: it buys sub-millisecond on a hop that is already sub-millisecond, on a path dominated by a network round trip. This machine also has neither toolchain.
- Rust for the terminal grid specifically (superterminal's choice) — not applicable: that project renders its own grid on the GPU, where the language does decide the outcome. This one renders in a browser, where xterm's WebGL renderer already does that work.

## Consequences
- One language means the wire protocol is compiler-checked on both sides, via shared types in `packages/shared`.
- Using the **system `ssh`** with `ControlMaster` rather than an `ssh2` library means the user's `~/.ssh/config`, agent, keys and `ProxyJump` all apply for free.
- `node-pty` is the best-supported binding, at the cost of its `spawn-helper` permissions bug on macOS. See [../TRAPS.md](../TRAPS.md).
- The pty and WS layer sits behind the `Host` interface of [0004](0004-hosts-behind-an-interface-from-day-one.md), so it stays replaceable if profiling ever disagrees.
