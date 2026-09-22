// The Host interface exists from day one even though M1 only implements
// `local`: a new host is a new file, never a refactor of the hot path.
// docs/adr/0004-hosts-behind-an-interface-from-day-one.md
import type { HostId } from "@cv/shared";

export interface SpawnRequest {
  sessionId: string;
  cwd: string;
  cols: number;
  rows: number;
  /** When set, the command to run instead of an interactive shell. */
  command?: { file: string; args: string[] };
  /** When set, resume this Claude session id instead of a bare shell. */
  resume?: string;
  /** With resume: branch into a new session id rather than continuing it. */
  fork?: boolean;
  /** Attach to an existing tmux session by name instead of creating one. */
  attachTmux?: string;
  /** Start Claude in the new terminal rather than leaving a bare shell. */
  startClaude?: boolean;
  /** Claude model to run. Overrides the host's default when both are set. */
  model?: string;
}

/** What the host resolves a spawn request into: an argv plus an environment. */
export interface SpawnPlan {
  file: string;
  args: string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
  /** Human-readable description of what is running, for the session record. */
  shell: string;
  /**
   * The model the plan actually resolved to, after the host default and any
   * per-spawn override. The caller records this rather than recomputing the
   * precedence, so what is displayed cannot disagree with what was launched.
   */
  model?: string;
}

export interface Host {
  readonly id: HostId;
  /**
   * Turn a request into an argv. The local host runs the shell directly; the
   * fire host will wrap the same request in `ssh -t ... tmux new-session -A`,
   * which is why the pty layer never builds commands itself.
   */
  plan(req: SpawnRequest): SpawnPlan;
}
