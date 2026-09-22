import type { FastifyInstance } from "fastify";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { HostId } from "@cv/shared";
import { remoteById } from "../config.ts";
import { sshArgs } from "../remote/ssh.ts";
import type { AppContext } from "../context.ts";

const execFileAsync = promisify(execFile);

/** Live Claude sessions the viewer does not own: stop and attach. */
export function registerAgentsRoutes(app: FastifyInstance, ctx: AppContext): void {
  const { config, ptys, agents, OWN_PIDS } = ctx;

  /**
   * Stop a live Claude session this viewer does not own.
   *
   * Only pids that `claude agents --json` itself reported can be signalled: the
   * pid is looked up from the poller's own rows rather than taken from the
   * request, so this can never be pointed at an arbitrary process.
   */
  app.post("/api/agents/:sessionId/stop", async (req, reply) => {
    const { sessionId } = req.params as { sessionId: string };
    const { host, force } = (req.body ?? {}) as { host?: HostId; force?: boolean };
    const h = host ?? "local";
    const row = (agents.get(h)?.rows ?? []).find((r) => r.sessionId === sessionId);
    if (!row?.pid) {
      return reply
        .code(404)
        .send({ error: "no live session with that id on this host" });
    }

    // Never signal the process tree this server runs inside: on a local host
    // that is usually the Claude session that started the viewer, and stopping
    // it would take the viewer down with it.
    if (h === "local" && OWN_PIDS.has(row.pid)) {
      return reply.code(403).send({
        error:
          "that is the session running this viewer; stopping it would kill the viewer too",
      });
    }

    // SIGTERM first: Claude Code can then run its own shutdown, including the
    // SessionEnd hooks. SIGKILL only when explicitly asked for.
    const signal = force ? "KILL" : "TERM";
    try {
      if (h === "local") {
        process.kill(row.pid, force ? "SIGKILL" : "SIGTERM");
      } else {
        const remote = remoteById(config, h);
        if (!remote) throw new Error(`host "${h}" is not configured`);
        const args = sshArgs(remote, 6);
        args.push(remote.sshTarget, `kill -${signal} ${row.pid}`);
        await execFileAsync("ssh", args, { timeout: 15000 });
      }
    } catch (err) {
      return reply.code(500).send({ error: (err as Error).message });
    }

    // Refresh so the UI reflects it on the next poll rather than in 4 seconds.
    setTimeout(() => void agents.refresh(h), 800);
    return { ok: true, signal, pid: row.pid };
  });

  /** Open a terminal attached to an existing tmux session. */
  app.post("/api/agents/:sessionId/attach", async (req, reply) => {
    const { sessionId } = req.params as { sessionId: string };
    const { host } = (req.body ?? {}) as { host?: HostId };
    const h = host ?? "local";
    const row = (agents.get(h)?.rows ?? []).find((r) => r.sessionId === sessionId);
    if (!row) return reply.code(404).send({ error: "no live session with that id" });
    if (!row.tmuxSession) {
      return reply.code(400).send({
        error:
          "this session is not running inside tmux, so there is no terminal to attach to. It can still be stopped.",
      });
    }
    try {
      const info = ptys.create({
        host: h,
        cwd: row.cwd ?? "~",
        cols: 80,
        rows: 45,
        attachTmux: row.tmuxSession,
        alias: row.name,
      });
      return { session: info };
    } catch (err) {
      return reply.code(400).send({ error: (err as Error).message });
    }
  });
}
