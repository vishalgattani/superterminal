import type { FastifyInstance } from "fastify";
import type { HostId } from "@cv/shared";
import { activityOf } from "../status/agents.ts";
import { digest, usageOf } from "../status/transcripts.ts";
import type { AppContext } from "../context.ts";

/** Past sessions and their transcripts. */
export function registerTranscriptsRoutes(app: FastifyInstance, ctx: AppContext): void {
  const { agents, transcripts } = ctx;

  /**
   * Past sessions, per host. Browsing, so it is cached and only refreshed on
   * request rather than polled.
   */
  app.get("/api/transcripts", async (req) => {
    const q = req.query as { host?: HostId; refresh?: string };
    const host = q.host ?? "local";
    const entry = await transcripts.list(host, q.refresh === "1");
    // Mark which past sessions are running right now, by matching the
    // transcript's session id against live `claude agents --json` rows. That is
    // what makes "active vs inactive" answerable from the history list.
    const liveIds = new Set(
      (agents.get(host)?.rows ?? [])
        .map((r) => r.sessionId)
        .filter((id): id is string => Boolean(id)),
    );
    const liveRows = agents.get(host)?.rows ?? [];
    return {
      host,
      total: entry.total,
      error: entry.error,
      fetchedAt: entry.fetchedAt,
      sessions: entry.rows.map((r) => {
        const row = liveRows.find((a) => a.sessionId === r.sessionId);
        return {
          ...r,
          live: liveIds.has(r.sessionId),
          liveStatus: row ? activityOf(row) : undefined,
          liveKind: row?.kind,
        };
      }),
    };
  });

  /** One transcript, rendered as readable turns. */
  app.get("/api/transcripts/detail", async (req, reply) => {
    const q = req.query as { host?: HostId; path?: string; sessionId?: string };
    const host = q.host ?? "local";
    // A session id is the reliable handle; the path layout is an implementation
    // detail that callers should not have to reconstruct.
    const path = q.path ?? (q.sessionId ? await transcripts.pathFor(host, q.sessionId) : undefined);
    if (!path) {
      return reply
        .code(404)
        .send({ error: "no transcript found for that session yet" });
    }
    try {
      // Whole file for the detail view: token totals must be exact, and the
      // tail alone would undercount a long session badly.
      const raw = await transcripts.read(host, path, 0);
      return { entries: digest(raw), usage: usageOf(raw), path };
    } catch (err) {
      return reply.code(400).send({ error: (err as Error).message });
    }
  });
}
