import type { FastifyInstance } from "fastify";
import { LOCAL_HOST_ID } from "@cv/shared";
import { activityOf, matchRow, tally } from "../status/agents.ts";
import type { AppContext } from "../context.ts";

/** Health, hosts, live status and the instance light. */
export function registerStatusRoutes(app: FastifyInstance, ctx: AppContext): void {
  const { config, hosts, hostStatuses, ptys, agents, fireInstance, transcripts, costs, contexts, models, links, OWN_PIDS } = ctx;

  app.get("/api/health", async () => ({
    ok: true,
    host: LOCAL_HOST_ID,
    sessions: ptys.list().length,
  }));

  app.get("/api/hosts", async () => ({
    hosts: hostStatuses,
    defaultCwd: config.defaultCwd,
  }));

  /**
   * Live status: the instance light plus per-session activity.
   *
   * Sessions are matched to `claude agents --json` rows on the same host (see
   * matchRow). A terminal with no Claude running simply has no row, which is
   * reported as "shell" rather than guessed at.
   */
  app.get("/api/status", async () => {
    const byHost = new Map(agents.all().map((a) => [a.host, a]));
    const sessions = ptys.list().map((info) => {
      const host = byHost.get(info.host);
      const bareLocal = info.host === LOCAL_HOST_ID && !info.tmuxSession;
      const row = matchRow(host?.rows ?? [], {
        tmuxName: info.tmuxSession ?? `cv-${info.sessionId.slice(0, 8)}`,
        cwd: info.cwd,
        shellPid: bareLocal ? ptys.get(info.sessionId)?.proc.pid : undefined,
        parents: bareLocal ? host?.parents : undefined,
      });
      // Statusline readings belong to the Claude that printed them. Once it
      // exits back to the shell they are stale, and a cost left on a bare
      // terminal reads as a session still running up a bill.
      if (!row) {
        costs.forget(info.sessionId);
        contexts.forget(info.sessionId);
        models.forget(info.sessionId);
      }
      const cost = costs.get(info.sessionId);
      const context = contexts.get(info.sessionId);
      const modelEffort = models.get(info.sessionId);
      return {
        sessionId: info.sessionId,
        // Where the terminal is working now, kept current by the cwd tracker.
        // Sent with every status so a `cd` reaches the graph on the next poll.
        cwd: info.cwd,
        activity: row ? activityOf(row) : "shell",
        claudeName: row?.name,
        waitingFor: row?.waitingFor,
        kind: row?.kind,
        costUsd: cost?.sessionUsd,
        contextPct: context?.pct,
        liveModel: modelEffort?.model,
        effort: modelEffort?.effort,
        // Claude's own session id for this terminal, when a Claude is running
        // in it. Distinct from our terminal id: this is the one `--resume`
        // takes and the one another session can be pointed at.
        claudeSessionId: row?.sessionId,
      };
    });
    // Counts: live now, and how many exist but are not running. Historical
    // numbers come from the transcript cache only when it has already been
    // populated, so opening the page never triggers an ssh scan.
    const openTerminals = ptys.list();
    const tallies = agents.all().map((a) =>
      tally(
        a,
        transcripts.cached(a.host),
        openTerminals.filter((s) => s.host === a.host).length,
      ),
    );

    // Live Claude sessions with no terminal of ours: started from a plain ssh,
    // by another tool, or left behind. They are real work and often the ones
    // waiting for input, so the UI shows them rather than only counting them.
    const claimed = new Set(
      sessions.map((s) => s.claudeSessionId).filter(Boolean),
    );
    const orphans = agents.all().flatMap((a) =>
      a.rows
        .filter((r) => r.sessionId && !claimed.has(r.sessionId))
        .map((r) => ({
          host: a.host,
          sessionId: r.sessionId!,
          pid: r.pid,
          cwd: r.cwd,
          name: r.name,
          kind: r.kind,
          activity: activityOf(r),
          waitingFor: r.waitingFor,
          tmuxSession: r.tmuxSession,
          startedAt: r.startedAt,
          /** Only tmux-backed sessions can be attached to a terminal. */
          attachable: Boolean(r.tmuxSession),
          /** True for the session running this viewer: it must not be stopped. */
          isViewer: a.host === "local" && Boolean(r.pid && OWN_PIDS.has(r.pid)),
        })),
    );

    return {
      /** True once boot re-adoption has finished: sessions are all known. */
      booted: ctx.boot.ready,
      /** Changes on every server start: a page uses it to notice a restart. */
      bootId: ctx.boot.id,
      instance: fireInstance?.status,
      // Subagents per session, merged across hosts. Session ids are uuids, so
      // one map is unambiguous and the browser does not need to know which
      // host a transcript came from to look one up.
      subagents: (() => {
        const counts: Record<string, number> = {};
        const active: Record<string, number> = {};
        let fetchedAt = 0;
        for (const h of hosts.keys()) {
          const got = transcripts.subagentCounts(h);
          if (!got) continue;
          Object.assign(counts, got.counts);
          Object.assign(active, got.active);
          fetchedAt = Math.max(fetchedAt, got.fetchedAt);
        }
        return { counts, active, fetchedAt };
      })(),
      orphans,
      // The full terminal list, so the UI can mirror the server continuously.
      // Adopting only at page load meant a session created anywhere else (the
      // API, a second tab, a fork triggered outside this page) stayed invisible
      // until a reload.
      terminals: ptys.list(),
      links: [...links.values()],
      sessions,
      hosts: tallies,
      totals: {
        liveSessions: tallies.reduce((n, t) => n + t.interactive + t.background, 0),
        background: tallies.reduce((n, t) => n + t.background, 0),
        waiting: tallies.reduce((n, t) => n + t.waiting, 0),
        working: tallies.reduce((n, t) => n + t.working, 0),
        terminals: ptys.list().length,
      },
    };
  });

  app.post("/api/instance/start", async (_req, reply) => {
    if (!fireInstance) {
      return reply.code(400).send({ error: "fire-control not configured" });
    }
    try {
      return { instance: await fireInstance.start() };
    } catch (err) {
      // start() throws when fire-control has no API base or id, or cannot be
      // reached: a configuration or network problem, not a server fault.
      return reply.code(502).send({ error: (err as Error).message });
    }
  });
}
