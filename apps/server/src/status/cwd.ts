import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { LOCAL_HOST_ID, type HostId } from "@cv/shared";
import { remoteById, type Config } from "../config.ts";
import type { PtyManager } from "../pty/manager.ts";
import { runRemote } from "../remote/ssh.ts";

const execFileAsync = promisify(execFile);

/**
 * Where each terminal is working *now*, as opposed to where it started.
 *
 * `info.cwd` is set once, from the folder box, when the node is made. A `cd`
 * happens inside the shell, which the viewer never hears about, so the graph
 * kept showing the starting folder: the label, the folder the node hangs under
 * and every path tooltip were all stale after the first `cd`.
 *
 * Two sources, because there are two kinds of terminal:
 *
 * - **tmux-backed** (every remote, and a local one attached to a tmux session):
 *   ask tmux for the active pane's path. The pty here is `ssh` or
 *   `tmux attach`, whose own cwd is meaningless.
 * - **a bare local shell**: read the shell's cwd from the OS.
 */

/** One line per pane. The path is last so a `|` inside it cannot shift the rest. */
export const PANES_FORMAT =
  "#{session_name}|#{window_active}|#{pane_active}|#{pane_current_path}";

/**
 * tmux session name -> the path of its active pane.
 *
 * A session with panes split, or several windows, has several paths; the one
 * the owner is looking at is the pane that is active in the window that is
 * active. Lines that are not in the expected shape are skipped rather than
 * guessed at, so noise in the output cannot become a wrong folder.
 */
export function parsePanes(stdout: string): Map<string, string> {
  const active = new Map<string, string>();
  const anyPane = new Map<string, string>();
  for (const raw of stdout.split("\n")) {
    const line = raw.replace(/\r$/, "");
    const [name, window, pane, ...rest] = line.split("|");
    const path = rest.join("|");
    if (!name || !path) continue;
    if ((window !== "0" && window !== "1") || (pane !== "0" && pane !== "1")) continue;
    if (!anyPane.has(name)) anyPane.set(name, path);
    if (window === "1" && pane === "1") active.set(name, path);
  }
  // A session with no pane flagged active is not expected; its first pane is
  // still a better answer than none.
  for (const [name, path] of anyPane) if (!active.has(name)) active.set(name, path);
  return active;
}

/** The path out of `lsof -a -d cwd -p <pid> -Fn`: lines like `p123`, `fcwd`, `n/some/dir`. */
export function parseLsofCwd(stdout: string): string | undefined {
  for (const line of stdout.split("\n")) {
    if (line.startsWith("n") && line.length > 1) return line.slice(1);
  }
  return undefined;
}

/** A local process's working directory, or undefined if it cannot be read. */
export async function processCwd(pid: number): Promise<string | undefined> {
  try {
    const { stdout } = await execFileAsync(
      "lsof",
      ["-a", "-d", "cwd", "-p", String(pid), "-Fn"],
      { timeout: 5_000 },
    );
    return parseLsofCwd(stdout);
  } catch {
    return undefined; // gone, or not ours to inspect: keep what we had
  }
}

export class CwdTracker {
  private config: Config;
  private ptys: PtyManager;

  // Explicit fields, not parameter properties: Node's type stripping rejects those.
  constructor(config: Config, ptys: PtyManager) {
    this.config = config;
    this.ptys = ptys;
  }

  /** Active-pane paths on one host, or undefined when tmux cannot be asked. */
  private async panes(host: HostId): Promise<Map<string, string> | undefined> {
    const command = `tmux list-panes -a -F '${PANES_FORMAT}'`;
    if (host === LOCAL_HOST_ID) {
      try {
        const { stdout } = await execFileAsync(
          "tmux",
          ["list-panes", "-a", "-F", PANES_FORMAT],
          { timeout: 5_000 },
        );
        return parsePanes(stdout);
      } catch {
        return undefined; // no tmux, or no server running: nothing is attached
      }
    }
    const remote = remoteById(this.config, host);
    if (!remote) return undefined;
    const res = await runRemote(remote, `${command} 2>/dev/null`, 10_000);
    // An unreachable box leaves every path as it was.
    return res.ok ? parsePanes(res.output) : undefined;
  }

  /**
   * Bring this host's terminals up to date. Returns how many changed.
   * Never throws: this rides on the status poll and must not break it.
   */
  async refresh(host: HostId): Promise<number> {
    const ptys = this.ptys;
    const mine = ptys
      .list()
      .filter((i) => i.host === host && !ptys.get(i.sessionId)?.exited);
    const inTmux = mine.filter((i) => i.tmuxSession);
    const bare = host === LOCAL_HOST_ID ? mine.filter((i) => !i.tmuxSession) : [];

    let changed = 0;
    const apply = (id: string, path: string | undefined): void => {
      // Looked up again: a session closed while we were waiting is not ours to touch.
      const live = ptys.get(id);
      if (!path || !live || live.info.cwd === path) return;
      live.info.cwd = path;
      changed++;
    };

    try {
      if (inTmux.length) {
        const panes = await this.panes(host);
        for (const i of inTmux) apply(i.sessionId, panes?.get(i.tmuxSession!));
      }
      for (const i of bare) {
        const pid = ptys.get(i.sessionId)?.proc.pid;
        if (pid) apply(i.sessionId, await processCwd(pid));
      }
    } catch {
      // Keep whatever was known; the next poll tries again.
    }
    return changed;
  }
}
