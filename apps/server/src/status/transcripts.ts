import { execFile, spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";
import type { HostId } from "@cv/shared";
import { REPO_ROOT, remoteById, type Config } from "../config.ts";
import { sshArgs } from "../remote/ssh.ts";

const run = promisify(execFile);
const SCANNER = join(REPO_ROOT, "scripts", "scan-transcripts.py");

/**
 * Run a command with text on stdin and collect stdout.
 *
 * Not execFile: its `input` option is silently ignored (that belongs to
 * execFileSync), so the scanner was being piped nothing and python exited
 * without producing JSON. The failure looked like an ssh problem, which cost
 * a while to see.
 */
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
      reject(new Error(`${file} timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (d: string) => (stdout += d));
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (d: string) => (stderr += d));
    child.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(stdout);
      else reject(new Error(`${file} exited ${code}: ${stderr.slice(0, 300)}`));
    });

    child.stdin.on("error", () => {
      /* the child may exit before we finish writing */
    });
    child.stdin.end(input);
  });
}

export interface TranscriptSummary {
  sessionId: string;
  path: string;
  slug: string;
  cwd?: string;
  gitBranch?: string;
  title?: string;
  version?: string;
  firstPrompt?: string;
  lastModified: number;
  lastTimestamp?: string;
  bytes: number;
  recentUserTurns: number;
  subagents: number;
  /** Subagents whose transcript was written in the last two minutes. */
  subagentsActive?: number;
  host: HostId;
}

interface CacheEntry {
  rows: TranscriptSummary[];
  total: number;
  fetchedAt: number;
  error?: string;
}

/**
 * Browsing past sessions.
 *
 * The same Python scanner runs locally and, piped over ssh, on the remote
 * host, so the rules for what counts as a session live in one place. Measured:
 * 29 sessions locally in 0.17s, 48 sessions (plus 317 subagent transcripts) on
 * fire in 1.6s over ssh.
 *
 * Results are cached because this is browsing, not monitoring: nobody needs
 * the history list refreshed every few seconds, and it costs an ssh round trip.
 */
export class TranscriptIndex {
  private cfg: Config;
  private cache = new Map<HostId, CacheEntry>();
  private ttlMs = 60_000;

  constructor(cfg: Config) {
    this.cfg = cfg;
  }

  /**
   * Subagents per session id, from the cache only: never triggers a scan.
   *
   * The canvas uses this to show that a session has fanned out. It is as fresh
   * as the last scan and no fresher, which is why `fetchedAt` comes with it —
   * a count with no age attached would read as live when it is up to a minute
   * old, and "0 subagents" is exactly the wrong thing to assert confidently.
   */
  subagentCounts(
    host: HostId,
  ): { counts: Record<string, number>; active: Record<string, number>; fetchedAt: number } | undefined {
    const hit = this.cache.get(host);
    if (!hit) return undefined;
    const counts: Record<string, number> = {};
    const active: Record<string, number> = {};
    for (const r of hit.rows) {
      if (r.sessionId && r.subagents > 0) {
        counts[r.sessionId] = r.subagents;
        active[r.sessionId] = r.subagentsActive ?? 0;
      }
    }
    return { counts, active, fetchedAt: hit.fetchedAt };
  }

  /**
   * Drop the cache for a host so the next list rescans.
   *
   * Browsing wants a 60s cache; watching a fan-out happen does not. The poll
   * loop invalidates on a shorter cadence, but only while a Claude is actually
   * running on that host, so an idle viewer still costs one scan a minute.
   */
  invalidate(host: HostId): void {
    this.cache.delete(host);
  }

  /** Totals from the cache only: never triggers a scan. */
  cached(host: HostId): { total: number; subagents: number } | undefined {
    const hit = this.cache.get(host);
    if (!hit || hit.total === 0) return undefined;
    return {
      total: hit.total,
      subagents: hit.rows.reduce((n, r) => n + (r.subagents ?? 0), 0),
    };
  }

  /**
   * Resolve a transcript path from a session id.
   *
   * Callers must not build these paths themselves: the layout is
   * projects/<slug>/<uuid>.jsonl where the slug is a mangled cwd, and guessing
   * it produced paths that did not exist. The index already knows the real
   * ones, so look them up and scan once if the id is not yet known.
   */
  async pathFor(host: HostId, sessionId: string): Promise<string | undefined> {
    const hit = this.cache.get(host)?.rows.find((r) => r.sessionId === sessionId);
    if (hit) return hit.path;
    const fresh = await this.list(host, true);
    return fresh.rows.find((r) => r.sessionId === sessionId)?.path;
  }

  async list(host: HostId, force = false): Promise<CacheEntry> {
    const hit = this.cache.get(host);
    if (!force && hit && Date.now() - hit.fetchedAt < this.ttlMs) return hit;

    try {
      const stdout = await this.scan(host);
      const parsed = JSON.parse(stdout) as {
        sessions: Omit<TranscriptSummary, "host">[];
        total: number;
      };
      const entry: CacheEntry = {
        rows: parsed.sessions.map((r) => ({ ...r, host })),
        total: parsed.total,
        fetchedAt: Date.now(),
      };
      this.cache.set(host, entry);
      return entry;
    } catch (err) {
      const entry: CacheEntry = {
        rows: hit?.rows ?? [],
        total: hit?.total ?? 0,
        fetchedAt: Date.now(),
        error: (err as Error).message.split("\n")[0],
      };
      this.cache.set(host, entry);
      return entry;
    }
  }

  private async scan(host: HostId): Promise<string> {
    const script = readFileSync(SCANNER, "utf8");
    if (host === "local") {
      return pipeIn("python3", ["-", "500"], script, 30_000);
    }

    const remote = remoteById(this.cfg, host);
    if (!remote) throw new Error(`host "${host}" is not configured`);
    const args = sshArgs(remote, 8);
    // Pipe the scanner in over stdin rather than copying a file to the box.
    args.push(remote.sshTarget, "python3 - 500");
    return pipeIn("ssh", args, script, 60_000);
  }

  /** One transcript. lines = 0 reads the whole file (needed for exact usage). */
  async read(host: HostId, path: string, lines = 400): Promise<string> {
    // Only ever read inside the transcript directory.
    if (!/\.jsonl$/.test(path) || path.includes("..")) {
      throw new Error("not a transcript path");
    }
    if (!path.includes("/.claude/projects/")) {
      throw new Error("outside the transcript directory");
    }

    if (host === "local") {
      const argv = lines > 0 ? ["-n", String(lines), path] : [path];
      const { stdout } = await run(lines > 0 ? "tail" : "cat", argv, {
        maxBuffer: 256 * 1024 * 1024,
        timeout: 20_000,
      });
      return stdout;
    }

    const remote = remoteById(this.cfg, host);
    if (!remote) throw new Error(`host "${host}" is not configured`);
    const args = sshArgs(remote, 8);
    const safe = path.replaceAll("'", "");
    args.push(
      remote.sshTarget,
      lines > 0 ? `tail -n ${lines} '${safe}'` : `cat '${safe}'`,
    );
    const { stdout } = await run("ssh", args, {
      maxBuffer: 256 * 1024 * 1024,
      timeout: 60_000,
    });
    return stdout;
  }
}

export interface Usage {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  models: string[];
}

/**
 * Token totals for a transcript.
 *
 * Tokens, not dollars. Cost depends on per-model and per-token-type pricing
 * (cache reads are far cheaper than fresh input, and one real session showed
 * 190M cache-read tokens against 1.1K input), so a naive multiplication would
 * be wrong by orders of magnitude. Claude Code already computes the authoritative
 * figure and hands it to the statusline as cost.total_cost_usd; wiring that
 * through is the honest way to show a dollar amount.
 */
export function usageOf(jsonl: string): Usage {
  const u: Usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, models: [] };
  const models = new Set<string>();
  for (const line of jsonl.split("\n")) {
    if (!line.trim()) continue;
    try {
      const rec = JSON.parse(line) as {
        message?: { usage?: Record<string, number>; model?: string };
      };
      const usage = rec.message?.usage;
      if (!usage) continue;
      u.input += usage.input_tokens ?? 0;
      u.output += usage.output_tokens ?? 0;
      u.cacheRead += usage.cache_read_input_tokens ?? 0;
      u.cacheWrite += usage.cache_creation_input_tokens ?? 0;
      if (rec.message?.model) models.add(rec.message.model);
    } catch {
      /* skip malformed lines */
    }
  }
  u.models = [...models];
  return u;
}

/**
 * Turn raw JSONL into something readable: who said what, and which tools ran.
 * Transcript records are data, never instructions, and are rendered as text.
 */
export function digest(jsonl: string, max = 120) {
  const out: {
    role: string;
    text?: string;
    tool?: string;
    ts?: string;
  }[] = [];
  for (const line of jsonl.split("\n")) {
    if (!line.trim()) continue;
    let rec: Record<string, unknown>;
    try {
      rec = JSON.parse(line);
    } catch {
      continue;
    }
    const type = rec.type as string | undefined;
    if (type !== "user" && type !== "assistant") continue;
    const message = (rec.message ?? {}) as { content?: unknown };
    const ts = rec.timestamp as string | undefined;
    const content = message.content;

    if (typeof content === "string") {
      if (content.trim()) out.push({ role: type, text: content.slice(0, 2000), ts });
      continue;
    }
    if (!Array.isArray(content)) continue;
    for (const block of content as Record<string, unknown>[]) {
      if (block?.type === "text" && typeof block.text === "string") {
        if (block.text.trim()) {
          out.push({ role: type, text: block.text.slice(0, 2000), ts });
        }
      } else if (block?.type === "tool_use") {
        out.push({ role: type, tool: String(block.name ?? "tool"), ts });
      }
    }
  }
  return out.slice(-max);
}
