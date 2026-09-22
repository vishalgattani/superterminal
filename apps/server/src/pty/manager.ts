import { randomUUID } from "node:crypto";
import { existsSync, statSync } from "node:fs";
import pty from "node-pty";
import type { IPty } from "node-pty";
import type { HostId, SessionInfo } from "@cv/shared";
import type { Host } from "../hosts/types.ts";

/**
 * How many bytes we let queue toward a client before pausing the pty.
 * Without this, a burst (a big build log, `cat` on a large file) outruns the
 * browser's ability to paint and the tab locks up. Resumed when the client
 * says it has drained.
 */
const HIGH_WATER_BYTES = 256 * 1024;

export interface Session {
  info: SessionInfo;
  proc: IPty;
  /** Attached client sink. One viewer per session in M1. */
  sink?: (chunk: Uint8Array) => void;
  onExit?: (code: number, signal?: number) => void;
  pendingBytes: number;
  paused: boolean;
  /** Output produced before a client attached, replayed on attach. */
  backlog: Uint8Array[];
  backlogBytes: number;
  /**
   * True once the backlog has had to drop bytes from its front.
   *
   * A terminal stream is not a log: you cannot cut the beginning off and
   * replay the rest. The bytes lost first are the ones that set the screen up
   * — on a tmux host, the switch to the alternate screen and the full paint
   * that follows it. Replaying what is left paints a Claude TUI onto a browser
   * that never entered the alternate buffer, which is why a busy session opened
   * blank, or with two frames drawn on top of each other.
   */
  backlogTruncated: boolean;
  exited?: { code: number; signal?: number };
  /** When the last client detached, or creation time if never attached. */
  detachedSince?: number;
  /** Incremented per attach, so a stale socket cannot detach a live one. */
  attachToken?: number;
}

const BACKLOG_MAX_BYTES = 512 * 1024;

/**
 * A session nobody is attached to is reaped after this long. Without it, a
 * closed browser tab leaves its shell running until the server stops, and they
 * accumulate (measured: three unattached sessions survived indefinitely).
 * M1 has no persistence, so nothing of value is lost. When tmux arrives in M2
 * this is replaced by reconciliation against `tmux ls`, where surviving a
 * detach is the whole point.
 */
const IDLE_REAP_MS = 10 * 60 * 1000;
const REAP_INTERVAL_MS = 60 * 1000;

export class PtyManager {
  private sessions = new Map<string, Session>();
  private hosts: Map<HostId, Host>;
  /**
   * Side tap on pty output. Deliberately separate from the sink that feeds
   * the browser: observers must never sit between the pty and the terminal.
   */
  private observer?: (sessionId: string, text: string) => void;

  constructor(hosts: Map<HostId, Host>) {
    this.hosts = hosts;
  }

  onOutput(fn: (sessionId: string, text: string) => void): void {
    this.observer = fn;
  }

  list(): SessionInfo[] {
    return [...this.sessions.values()].map((s) => s.info);
  }

  get(sessionId: string): Session | undefined {
    return this.sessions.get(sessionId);
  }

  /**
   * Re-run the host's spawn for an existing session id.
   *
   * On a tmux-backed host this reattaches rather than creating: the tmux
   * session name is derived from the session id and `new-session -A` attaches
   * when it already exists, so whatever was running is still running and tmux
   * redraws the pane on attach. On a host without tmux this is a fresh shell,
   * which is why the UI only offers it where it means reattach.
   */
  respawn(sessionId: string): SessionInfo {
    const s = this.sessions.get(sessionId);
    if (!s) throw new Error(`no such session: ${sessionId}`);
    const host = this.hosts.get(s.info.host);
    if (!host) throw new Error(`unknown host: ${s.info.host}`);

    if (!s.exited) {
      try {
        s.proc.kill();
      } catch {
        /* already gone */
      }
    }

    // A terminal adopted or attached to a session it did not create has a tmux
    // name that is not derived from its id. Reattach has to rejoin that one:
    // re-planning from the id alone would start a fresh session under a new
    // name and leave the real one untouched.
    const stored = s.info.tmuxSession;
    const attachTmux =
      stored && stored !== `cv-${sessionId.slice(0, 8)}` ? stored : undefined;
    const plan = host.plan({
      sessionId,
      cwd: spawnCwd(s.info.host, s.info.cwd, attachTmux),
      cols: s.info.cols,
      rows: s.info.rows,
      attachTmux,
    });
    const proc = pty.spawn(plan.file, plan.args, {
      name: "xterm-256color",
      cols: s.info.cols,
      rows: s.info.rows,
      cwd: plan.cwd,
      env: plan.env as { [key: string]: string },
    });

    s.proc = proc;
    s.exited = undefined;
    s.paused = false;
    s.pendingBytes = 0;
    s.backlog = [];
    s.backlogBytes = 0;
    s.backlogTruncated = false;
    s.detachedSince = Date.now();
    this.wire(s, proc);
    return s.info;
  }

  create(opts: {
    host: HostId;
    cwd: string;
    cols: number;
    rows: number;
    alias?: string;
    /** Claude session id to resume once the shell is up. */
    resume?: string;
    /** With resume: fork into a new session instead of continuing. */
    fork?: boolean;
    /** Attach to this existing tmux session rather than creating one. */
    attachTmux?: string;
    /** Start Claude in the terminal rather than leaving a bare shell. */
    startClaude?: boolean;
    /** Claude model to run. Falls back to the host's configured default. */
    model?: string;
  }): SessionInfo {
    const host = this.hosts.get(opts.host);
    if (!host) throw new Error(`unknown host: ${opts.host}`);

    // Only a local cwd can be checked here. A remote path lives on the other
    // machine, so validating it against this filesystem would reject every
    // valid remote directory; tmux reports the error over the terminal instead.
    // Attaching to an existing tmux session never uses the cwd to start
    // anything, and the session's directory may since have been deleted, so it
    // is kept for display only and the local process starts from home.
    const cwd =
      opts.host === "local" && !opts.attachTmux ? resolveCwd(opts.cwd) : opts.cwd;
    // Pre-assigned id: the session key exists before the process does, which is
    // what lets `claude --session-id <uuid>` agree with our registry later.
    const sessionId = randomUUID();
    const plan = host.plan({
      sessionId,
      cwd: spawnCwd(opts.host, cwd, opts.attachTmux),
      cols: opts.cols,
      rows: opts.rows,
      resume: opts.resume,
      fork: opts.fork,
      attachTmux: opts.attachTmux,
      startClaude: opts.startClaude,
      model: opts.model,
    });

    const proc = pty.spawn(plan.file, plan.args, {
      name: "xterm-256color",
      cols: opts.cols,
      rows: opts.rows,
      cwd: plan.cwd,
      env: plan.env as { [key: string]: string },
    });

    const session: Session = {
      info: {
        sessionId,
        host: opts.host,
        kind: "shell",
        cwd,
        shell: plan.shell,
        cols: opts.cols,
        rows: opts.rows,
        alias: opts.alias,
        // A local terminal is not in tmux unless it was attached to a session
        // that is; the viewer never wraps a local shell in one itself.
        tmuxSession:
          opts.host === "local"
            ? opts.attachTmux
            : (opts.attachTmux ?? `cv-${sessionId.slice(0, 8)}`),
        // From the plan, not from opts: the host default may have supplied it,
        // so this is what was launched rather than what was asked for.
        model: plan.model,
        startedAt: Date.now(),
      },
      proc,
      pendingBytes: 0,
      paused: false,
      backlog: [],
      backlogBytes: 0,
      backlogTruncated: false,
      detachedSince: Date.now(),
    };

    this.wire(session, proc);
    this.sessions.set(sessionId, session);
    return session.info;
  }

  /** Bind a pty's output and exit to a session. Shared by create and respawn. */
  private wire(session: Session, proc: IPty): void {
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    proc.onData((data) => {
      // The observer sees the decoded text; the browser still gets raw bytes.
      try {
        this.observer?.(session.info.sessionId, data);
      } catch {
        /* an observer must never break the terminal */
      }
      const bytes = Buffer.from(data, "utf8");
      if (session.sink) {
        session.pendingBytes += bytes.byteLength;
        session.sink(bytes);
        if (session.pendingBytes > HIGH_WATER_BYTES && !session.paused) {
          session.paused = true;
          proc.pause();
        }
      } else {
        session.backlog.push(bytes);
        session.backlogBytes += bytes.byteLength;
        while (
          session.backlogBytes > BACKLOG_MAX_BYTES &&
          session.backlog.length > 1
        ) {
          const dropped = session.backlog.shift()!;
          session.backlogBytes -= dropped.byteLength;
          session.backlogTruncated = true;
        }
      }
    });

    proc.onExit(({ exitCode, signal }) => {
      // Only record the exit if this is still the live pty: a respawn replaces
      // proc, and the old one's exit must not mark the new session dead.
      if (session.proc !== proc) return;
      session.exited = { code: exitCode, signal };
      session.onExit?.(exitCode, signal);
    });
  }

  /**
   * Attach a client sink; returns any output buffered before the attach, and
   * a token identifying this attachment.
   *
   * The token matters: React StrictMode mounts an effect twice, so socket A
   * connects, socket B connects and attaches, then A closes. Without a token,
   * A's close cleared B's sink and the terminal stayed blank forever while the
   * pty happily produced output into the void.
   */
  attach(
    sessionId: string,
    sink: (chunk: Uint8Array) => void,
    onExit: (code: number, signal?: number) => void,
  ): { backlog: Uint8Array[]; token: number } {
    const s = this.sessions.get(sessionId);
    if (!s) throw new Error(`no such session: ${sessionId}`);
    s.sink = sink;
    s.onExit = onExit;
    s.detachedSince = undefined;
    s.attachToken = (s.attachToken ?? 0) + 1;

    // A truncated backlog cannot be replayed faithfully, and on a tmux host it
    // does not have to be: tmux still holds the real screen, and a fresh
    // `tmux attach` repaints all of it. So drop the broken fragment and let the
    // client reconnect to a pty that will draw itself from scratch.
    //
    // Only for tmux-backed sessions. A local shell has no such authority —
    // respawning it would start a new shell and lose the scrollback, which is
    // worse than a gap.
    if (s.backlogTruncated && s.info.tmuxSession && !s.exited) {
      s.backlog = [];
      s.backlogBytes = 0;
      s.backlogTruncated = false;
      const token = s.attachToken;
      // After this returns, so the caller's sink is already wired and catches
      // the new pty's opening paint rather than racing it.
      queueMicrotask(() => {
        // Another client may have attached in between; respawning under it
        // would blank a terminal that is working.
        if (s.attachToken !== token) return;
        try {
          this.respawn(sessionId);
        } catch {
          // Leave the session as it is: a blank pane is recoverable, a thrown
          // attach is not.
        }
      });
      return { backlog: [], token };
    }

    const backlog = s.backlog;
    s.backlog = [];
    s.backlogBytes = 0;
    return { backlog, token: s.attachToken };
  }

  /** Detach, but only if the caller still owns the attachment. */
  detach(sessionId: string, token?: number): void {
    const s = this.sessions.get(sessionId);
    if (!s) return;
    if (token !== undefined && token !== s.attachToken) return;
    s.sink = undefined;
    s.onExit = undefined;
    s.detachedSince = Date.now();
    // A detached client must never leave the pty paused forever.
    if (s.paused) {
      s.paused = false;
      s.pendingBytes = 0;
      s.proc.resume();
    }
  }

  /** Client drained its buffer: clear the pending count and unpause. */
  drained(sessionId: string): void {
    const s = this.sessions.get(sessionId);
    if (!s) return;
    s.pendingBytes = 0;
    if (s.paused) {
      s.paused = false;
      s.proc.resume();
    }
  }

  write(sessionId: string, data: Uint8Array): void {
    const s = this.sessions.get(sessionId);
    if (!s || s.exited) return;
    // Raw passthrough: no interpretation of arrows, Enter or control bytes.
    s.proc.write(Buffer.from(data).toString("utf8"));
  }

  resize(sessionId: string, cols: number, rows: number): void {
    const s = this.sessions.get(sessionId);
    if (!s || s.exited) return;
    if (cols < 1 || rows < 1 || cols > 1000 || rows > 1000) return;
    s.proc.resize(cols, rows);
    s.info.cols = cols;
    s.info.rows = rows;
  }

  kill(sessionId: string): void {
    const s = this.sessions.get(sessionId);
    if (!s) return;
    try {
      if (!s.exited) s.proc.kill();
    } finally {
      this.sessions.delete(sessionId);
    }
  }

  killAll(): void {
    for (const id of [...this.sessions.keys()]) this.kill(id);
  }

  /**
   * Kill sessions no client has been attached to for IDLE_REAP_MS.
   *
   * An exited session is deliberately NOT reaped on sight: on a tmux host the
   * pty exiting usually means the connection dropped, while the remote work
   * carries on, and the node has to stay so it can be reattached. It ages out
   * on the same idle timer as anything else.
   */
  reapIdle(now = Date.now()): string[] {
    const reaped: string[] = [];
    for (const [id, s] of this.sessions) {
      if (!s.detachedSince) continue;
      if (now - s.detachedSince > IDLE_REAP_MS) {
        this.kill(id);
        reaped.push(id);
      }
    }
    return reaped;
  }

  startReaper(): NodeJS.Timeout {
    const timer = setInterval(() => {
      const reaped = this.reapIdle();
      if (reaped.length) {
        console.log(`[cv] reaped ${reaped.length} idle session(s)`);
      }
    }, REAP_INTERVAL_MS);
    // Never hold the process open just to reap.
    timer.unref();
    return timer;
  }
}

/** Where the local process starts: home when only attaching, else the cwd. */
function spawnCwd(host: HostId, cwd: string, attachTmux?: string): string {
  return host === "local" && attachTmux ? (process.env.HOME ?? "/") : cwd;
}

function resolveCwd(cwd: string): string {
  if (!existsSync(cwd) || !statSync(cwd).isDirectory()) {
    throw new Error(`not a directory: ${cwd}`);
  }
  return cwd;
}
