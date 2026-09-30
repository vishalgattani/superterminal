import { readdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";

/**
 * The Monitor watches Claude sessions on this machine have set up, read from
 * their transcripts.
 *
 * Claude Code offers no command that lists them, so the transcript is the only
 * record: a Monitor tool call (the description), its result ("Monitor started
 * (task <id>, expires in 30m …)"), <task-notification>s for that task — one
 * per event it saw, and a last one carrying a <status> when it ends — or a
 * TaskStop naming it. "Running" is therefore inferred: started,
 * no end seen, and not past its stated expiry. A session killed outright leaves
 * no end record, which is what the expiry bounds.
 */
export interface MonitorInfo {
  taskId: string;
  /** Claude's session id, the one `--resume` takes. */
  claudeSessionId: string;
  cwd?: string;
  description: string;
  startedAt: number;
  /** Absent for a monitor with no stated expiry. */
  expiresAt?: number;
  endedAt?: number;
  /** The most recent event the monitor reported, e.g. "kernel-x: RUNNING". */
  lastEvent?: string;
  lastEventAt?: number;
  running: boolean;
}

const PROJECTS = join(homedir(), ".claude", "projects");
/** Only transcripts written to this recently can hold a live monitor. */
const RECENT_MS = 24 * 60 * 60 * 1000;
const STARTED = /Monitor started \(task ([A-Za-z0-9_-]+)(?:, expires in (\d+)\s*(s|m|h))?/;
const NOTICE = /<task-notification>([\s\S]*?)<\/task-notification>/g;
const tag = (block: string, name: string) =>
  new RegExp(`<${name}>([\\s\\S]*?)</${name}>`).exec(block)?.[1]?.trim();
const UNIT_MS = { s: 1000, m: 60_000, h: 3_600_000 } as const;

interface Block {
  type?: string;
  id?: string;
  name?: string;
  input?: Record<string, unknown>;
  tool_use_id?: string;
  content?: unknown;
  text?: string;
}

/** One transcript's monitors, as parsed from its lines. */
export function parseMonitors(jsonl: string): Omit<MonitorInfo, "running">[] {
  const calls = new Map<string, { description: string; sid: string; cwd?: string; at: number }>();
  const byTask = new Map<string, Omit<MonitorInfo, "running">>();
  const ends = new Map<string, number>();
  const events = new Map<string, { text: string; at: number }>();
  for (const line of jsonl.split("\n")) {
    if (!line.includes("Monitor") && !line.includes("task-id") && !line.includes("TaskStop")) continue;
    let e: { message?: { content?: unknown }; sessionId?: string; cwd?: string; timestamp?: string };
    try {
      e = JSON.parse(line);
    } catch {
      continue;
    }
    const at = Date.parse(e.timestamp ?? "") || 0;
    const content = e.message?.content;
    const texts: string[] = typeof content === "string" ? [content] : [];
    for (const b of Array.isArray(content) ? (content as Block[]) : []) {
      if (b.type === "tool_use" && b.name === "Monitor" && b.id) {
        calls.set(b.id, {
          description: String(b.input?.description ?? "monitor"),
          sid: e.sessionId ?? "",
          cwd: e.cwd,
          at,
        });
      } else if (b.type === "tool_use" && b.name === "TaskStop" && b.input?.task_id) {
        ends.set(String(b.input.task_id), at);
      } else if (b.type === "tool_result") {
        const text = typeof b.content === "string" ? b.content : JSON.stringify(b.content ?? "");
        const call = b.tool_use_id ? calls.get(b.tool_use_id) : undefined;
        const m = call && STARTED.exec(text);
        if (call && m) {
          const [, taskId, n, unit] = m;
          byTask.set(taskId!, {
            taskId: taskId!,
            claudeSessionId: call.sid,
            cwd: call.cwd,
            description: call.description,
            startedAt: call.at,
            expiresAt: n ? call.at + Number(n) * UNIT_MS[unit as keyof typeof UNIT_MS] : undefined,
          });
        }
        texts.push(text);
      } else if (b.type === "text" && b.text) {
        texts.push(b.text);
      }
    }
    for (const t of texts) {
      for (const m of t.matchAll(NOTICE)) {
        const id = tag(m[1]!, "task-id");
        if (!id) continue;
        // An event is the monitor working; only a status means it stopped.
        if (tag(m[1]!, "status")) ends.set(id, at);
        const ev = tag(m[1]!, "event");
        if (ev && at >= (events.get(id)?.at ?? 0)) events.set(id, { text: ev, at });
      }
    }
  }
  for (const [taskId, ev] of events) {
    const m = byTask.get(taskId);
    if (m) {
      m.lastEvent = ev.text;
      m.lastEventAt = ev.at;
    }
  }
  for (const [taskId, at] of ends) {
    const m = byTask.get(taskId);
    if (m && at >= m.startedAt) m.endedAt = at;
  }
  return [...byTask.values()];
}

export class MonitorScanner {
  private cache = new Map<string, { mtimeMs: number; size: number; rows: Omit<MonitorInfo, "running">[] }>();

  list(now = Date.now()): MonitorInfo[] {
    const out: MonitorInfo[] = [];
    let files: string[];
    try {
      files = readdirSync(PROJECTS, { recursive: true, encoding: "utf8" }).filter((f) =>
        f.endsWith(".jsonl"),
      );
    } catch {
      return out;
    }
    const seen = new Set<string>();
    for (const rel of files) {
      const path = join(PROJECTS, rel);
      let st;
      try {
        st = statSync(path);
      } catch {
        continue;
      }
      if (now - st.mtimeMs > RECENT_MS) continue;
      seen.add(path);
      let hit = this.cache.get(path);
      if (!hit || hit.mtimeMs !== st.mtimeMs || hit.size !== st.size) {
        let text: string;
        try {
          text = readFileSync(path, "utf8");
        } catch {
          continue;
        }
        hit = { mtimeMs: st.mtimeMs, size: st.size, rows: text.includes('"Monitor"') ? parseMonitors(text) : [] };
        this.cache.set(path, hit);
      }
      for (const r of hit.rows) {
        out.push({ ...r, running: r.endedAt === undefined && (r.expiresAt === undefined || r.expiresAt > now) });
      }
    }
    for (const k of this.cache.keys()) if (!seen.has(k)) this.cache.delete(k);
    return out.sort((a, b) => b.startedAt - a.startedAt);
  }
}

export function registerMonitorRoutes(app: FastifyInstance): void {
  const scanner = new MonitorScanner();
  app.get("/api/monitors", async () => ({ monitors: scanner.list() }));
}
