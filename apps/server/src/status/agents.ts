import { execFile, spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";
import type { HostId } from "@cv/shared";
import { REPO_ROOT, remoteById, type Config } from "../config.ts";
import { sshArgs } from "../remote/ssh.ts";

const run = promisify(execFile);

/**
 * Session status by polling `claude agents --json`.
 *
 * This is the floor, not an optimisation. It needs no hooks and no settings
 * changes, so a swapped profile or an unhooked host can never blind the
 * viewer. Verified on the fire box, where the output already carries
 * `status`, `state: "blocked"` and `waitingFor: "input needed"`, which is
 * exactly the "needs you" signal.
 */
export interface AgentRow {
  pid?: number;
  id?: string;
  sessionId?: string;
  cwd?: string;
  kind?: string;
  name?: string;
  status?: string;
  state?: string;
  waitingFor?: string;
  startedAt?: number;
  /** tmux session this Claude runs in, used to join it to a terminal. */
  tmuxSession?: string;
}

/** What the UI sorts sessions by. */
export type Activity = "working" | "waiting" | "idle" | "unknown";

export interface HostAgents {
  host: HostId;
  rows: AgentRow[];
  /** pid -> parent pid, local host only: ties a Claude row to the shell it runs under. */
  parents?: Map<number, number>;
  error?: string;
  checkedAt: number;
}

export function activityOf(row: AgentRow | undefined): Activity {
  if (!row) return "unknown";
  // waitingFor / state:blocked is the strongest signal and must win: a
  // session blocked on input can still report a busy-looking status.
  if (row.waitingFor || row.state === "blocked" || row.status === "waiting") {
    return "waiting";
  }
  if (row.status === "busy" || row.status === "running") return "working";
  if (row.status === "idle") return "idle";
  return "unknown";
}

export interface HostTally {
  host: HostId;
  /** Terminals this viewer has open on the host. Not the same as sessions. */
  terminals: number;
  /** Live Claude processes right now, split by kind. */
  interactive: number;
  background: number;
  /** Live sessions by what they are doing. */
  working: number;
  waiting: number;
  idle: number;
  /** Transcripts on disk, i.e. every session ever run here. */
  historical?: number;
  /** Historical minus live: sessions that exist but are not running. */
  inactive?: number;
  subagents?: number;
  error?: string;
  checkedAt: number;
}

/**
 * Counts for "how many are active, how many are not".
 *
 * Live comes from `claude agents --json`; historical comes from the transcript
 * index. Inactive is the difference, which is the honest definition: a session
 * with a transcript and no process is one you could resume but is not running.
 */
export function tally(
  a: HostAgents,
  historical?: { total: number; subagents: number },
  terminals = 0,
): HostTally {
  const rows = a.rows;
  const count = (f: (r: AgentRow) => boolean) => rows.filter(f).length;
  const live = rows.length;
  return {
    host: a.host,
    terminals,
    interactive: count((r) => r.kind !== "background"),
    background: count((r) => r.kind === "background"),
    working: count((r) => activityOf(r) === "working"),
    waiting: count((r) => activityOf(r) === "waiting"),
    idle: count((r) => activityOf(r) === "idle"),
    historical: historical?.total,
    inactive:
      historical === undefined ? undefined : Math.max(0, historical.total - live),
    subagents: historical?.subagents,
    error: a.error,
    checkedAt: a.checkedAt,
  };
}

/** `ps -A -o pid=,ppid=` into pid -> parent pid. */
export function parseParents(stdout: string): Map<number, number> {
  const parents = new Map<number, number>();
  for (const line of stdout.split("\n")) {
    const [pid = NaN, ppid = NaN] = line.trim().split(/\s+/).map(Number);
    if (pid > 0 && ppid >= 0) parents.set(pid, ppid);
  }
  return parents;
}

function descendsFrom(pid: number, ancestor: number, parents: Map<number, number>): boolean {
  for (let p: number | undefined = pid, hops = 0; p && hops < 64; hops++) {
    if (p === ancestor) return true;
    p = parents.get(p);
  }
  return false;
}

/**
 * The `claude agents --json` row running in one terminal.
 *
 * Joined on the tmux session name when there is one. A bare local shell is
 * joined on pid ancestry: its Claude is a descendant of the pty's shell. cwd
 * was wrong there, because an unrelated Claude started outside the viewer in
 * the same folder was the sole row at that cwd and claimed every new terminal
 * opened beside it. cwd stays only for remote hosts without tmux, where the
 * process tree is not visible, and then only when it is unambiguous.
 */
export function matchRow(
  rows: AgentRow[],
  t: { tmuxName: string; cwd?: string; shellPid?: number; parents?: Map<number, number> },
): AgentRow | undefined {
  const byTmux = rows.find((r) => r.tmuxSession === t.tmuxName);
  if (byTmux) return byTmux;
  if (t.shellPid && t.parents) {
    const { shellPid, parents } = t;
    return rows.find((r) => !r.tmuxSession && r.pid && descendsFrom(r.pid, shellPid, parents));
  }
  const sameCwd = rows.filter((r) => r.cwd === t.cwd && !r.tmuxSession);
  return sameCwd.length === 1 ? sameCwd[0] : undefined;
}

/** Run a command with text on stdin, collecting stdout. */
function pipeIn(
  file: string,
  args: string[],
  input: string,
  timeoutMs: number,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(file, args, { stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`${file} timed out`));
    }, timeoutMs);
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (d: string) => (stdout += d));
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (d: string) => (stderr += d));
    child.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(stdout);
      else reject(new Error(`${file} exited ${code}: ${stderr.slice(0, 200)}`));
    });
    child.stdin.on("error", () => {});
    child.stdin.end(input);
  });
}

export class AgentPoller {
  private cfg: Config;
  private cache = new Map<HostId, HostAgents>();

  constructor(cfg: Config) {
    this.cfg = cfg;
  }

  get(host: HostId): HostAgents | undefined {
    return this.cache.get(host);
  }

  all(): HostAgents[] {
    return [...this.cache.values()];
  }

  async refresh(host: HostId): Promise<HostAgents> {
    const now = Date.now();
    try {
      const stdout = await this.exec(host);
      const rows = JSON.parse(stdout) as AgentRow[];
      const parents =
        host === "local"
          ? parseParents((await run("ps", ["-A", "-o", "pid=,ppid="])).stdout)
          : undefined;
      const result = { host, rows, parents, checkedAt: now };
      this.cache.set(host, result);
      return result;
    } catch (err) {
      const result = {
        host,
        rows: this.cache.get(host)?.rows ?? [],
        parents: this.cache.get(host)?.parents,
        error: (err as Error).message.split("\n")[0],
        checkedAt: now,
      };
      this.cache.set(host, result);
      return result;
    }
  }

  private async exec(host: HostId): Promise<string> {
    const script = readFileSync(
      join(REPO_ROOT, "scripts", "claude-agents.py"),
      "utf8",
    );

    if (host === "local") {
      const out = await pipeIn("python3", ["-", "claude"], script, 20_000);
      return JSON.stringify(JSON.parse(out).agents ?? []);
    }

    const remote = remoteById(this.cfg, host);
    if (!remote) throw new Error(`host "${host}" is not configured`);
    const args = sshArgs(remote, 6);
    // The absolute path is required: claude is not on PATH for a
    // non-interactive shell on that box, so a bare `claude` silently fails.
    args.push(remote.sshTarget, `python3 - ${remote.claudePath}`);
    const out = await pipeIn("ssh", args, script, 25_000);
    return JSON.stringify(JSON.parse(out).agents ?? []);
  }
}
