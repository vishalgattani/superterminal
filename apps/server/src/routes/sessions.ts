import type { FastifyInstance } from "fastify";
import { LOCAL_HOST_ID, type HostId } from "@cv/shared";
import { remoteById } from "../config.ts";
import { runRemote, shellQuote } from "../remote/ssh.ts";
import type { AppContext } from "../context.ts";

/** Terminals: create, rename, reattach, type into, close. */
export function registerSessionsRoutes(app: FastifyInstance, ctx: AppContext): void {
  const { config, hostStatuses, ptys, agents, links, linkExists, persistLinks, reconcileRemote } = ctx;

  app.get("/api/sessions", async () => ({ sessions: ptys.list() }));

  app.post("/api/reconcile", async () => ({ adopted: await reconcileRemote() }));

  app.post("/api/sessions", async (req, reply) => {
    const body = (req.body ?? {}) as {
      host?: HostId;
      cwd?: string;
      cols?: number;
      rows?: number;
      alias?: string;
      /** Resume an existing Claude session in the new terminal. */
      resume?: string;
      /** With resume: fork rather than continue. */
      fork?: boolean;
      /** Start Claude in the new terminal rather than leaving a bare shell. */
      startClaude?: boolean;
      /** Claude model. Falls back to the host's configured default. */
      model?: string;
    };
    const requested = body.host ?? LOCAL_HOST_ID;
    const status = hostStatuses.find((h) => h.id === requested);
    if (!status?.available) {
      return reply
        .code(400)
        .send({ error: status?.reason ?? `unknown host: ${requested}` });
    }
    try {
      const info = ptys.create({
        host: requested,
        // A remote host has its own home; falling back to the local default
        // would send the session to a path that does not exist there. Empty
        // means "the host decides", which for fire is the remote home.
        // "~" for a remote host with no folder given: tmux is told nothing and
        // lands in the remote home, and the node reads "~" rather than "/".
        cwd: body.cwd || (requested === LOCAL_HOST_ID ? config.defaultCwd : "~"),
        cols: clamp(body.cols ?? 80, 1, 1000),
        rows: clamp(body.rows ?? 45, 1, 1000),
        alias: body.alias,
        resume: body.resume,
        fork: body.fork,
        startClaude: body.startClaude,
        model: body.model,
      });
      return { session: info };
    } catch (err) {
      return reply.code(400).send({ error: (err as Error).message });
    }
  });

  // The alias is the owner's label for a session. It is viewer metadata only:
  // Claude is never told about it, so renaming cannot confuse a running session.
  app.patch("/api/sessions/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const { alias } = (req.body ?? {}) as { alias?: string };
    const session = ptys.get(id);
    if (!session) return reply.code(404).send({ error: "no such session" });
    const trimmed = (alias ?? "").trim().slice(0, 60);
    session.info.alias = trimmed || undefined;
    return { session: session.info };
  });

  // Reattach: re-run the host's spawn for this session id. On the tmux-backed
  // fire host that rejoins the existing tmux session, so whatever was running is
  // still running.
  app.post("/api/sessions/:id/reattach", async (req, reply) => {
    const { id } = req.params as { id: string };
    try {
      return { session: ptys.respawn(id) };
    } catch (err) {
      return reply.code(400).send({ error: (err as Error).message });
    }
  });

  /**
   * Run `/compact` in a session's own terminal.
   *
   * Deliberately its own endpoint rather than a call to `/input`: `/input` is
   * gated on a link because it lets one session drive another, and a link
   * only ever *types* (never submits) so the owner reviews what lands in
   * another session's terminal before it runs. This writes into the
   * session's own terminal and submits unattended — there is no "someone
   * else reviews this" step for a single well-known slash command the owner
   * chose to run by clicking Compact.
   */
  app.post("/api/sessions/:id/compact", async (req, reply) => {
    const { id } = req.params as { id: string };
    const session = ptys.get(id);
    if (!session) return reply.code(404).send({ error: "no such session" });
    const encoder = new TextEncoder();
    ptys.write(id, encoder.encode("/compact"));
    // Enter as a separate write, so a paste-bracketing terminal still runs it.
    setTimeout(() => ptys.write(id, encoder.encode("\r")), 120);
    return { ok: true };
  });

  /**
   * Type text into a session's terminal.
   *
   * This is how one session talks to another: the viewer writes a prompt into
   * the target's pty, exactly as if it had been typed. Authenticated like
   * everything else, and never triggered by anything a terminal or transcript
   * printed, only by an explicit action in the UI.
   */
  app.post("/api/sessions/:id/input", async (req, reply) => {
    const { id } = req.params as { id: string };
    const { text, submit, from } = (req.body ?? {}) as {
      text?: string;
      submit?: boolean;
      from?: string;
    };
    if (!text) return reply.code(400).send({ error: "text required" });
    const session = ptys.get(id);
    if (!session) return reply.code(404).send({ error: "no such session" });
    // Gated on a link: one session may only write into another along an edge
    // the owner drew on the canvas. Without this the endpoint let anything
    // authenticated type into any terminal, which made the connector
    // decorative rather than a capability.
    if (!from || !linkExists(from, id)) {
      return reply.code(403).send({
        error:
          "no link from that session to this one: connect the nodes on the canvas first",
      });
    }
    const encoder = new TextEncoder();
    ptys.write(id, encoder.encode(text));
    if (submit) {
      // Enter as a separate write, so a paste-bracketing terminal still runs it.
      setTimeout(() => ptys.write(id, encoder.encode("\r")), 120);
    }
    return { ok: true };
  });

  /**
   * Close a terminal.
   *
   * By default this drops the local pty only: a remote session lives in tmux, so
   * it keeps running and is re-adopted on the next restart. That is the point of
   * tmux, and also why closing a node is not the same as ending its work.
   * `?terminate=1` additionally kills the tmux session, which is the only way to
   * end remote work from the UI.
   */
  app.delete("/api/sessions/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const terminate = (req.query as { terminate?: string }).terminate === "1";

    if (terminate) {
      const session = ptys.get(id);
      if (!session) return reply.code(404).send({ error: "no such session" });
      // The name comes from our own registry, never from the request, so this
      // cannot be pointed at an arbitrary tmux session.
      const tmux = session.info.tmuxSession;
      if (session.info.host === LOCAL_HOST_ID || !tmux) {
        return reply
          .code(400)
          .send({ error: "this terminal has no remote session to terminate" });
      }
      const remote = remoteById(config, session.info.host);
      if (!remote) {
        return reply
          .code(400)
          .send({ error: `host "${session.info.host}" is not configured` });
      }

      // "=" makes the match exact: without it tmux treats the name as a prefix
      // and could end a different session that merely starts the same way.
      const res = await runRemote(
        remote,
        `tmux kill-session -t ${shellQuote(`=${tmux}`)}`,
      );
      // Already gone is the outcome the owner asked for, so it is not an error.
      const alreadyGone =
        !res.ok &&
        !res.transport &&
        /can't find session|no server running|error connecting to/i.test(res.output);
      if (!res.ok && !alreadyGone) {
        // The node is kept, so the owner can see it is still there and retry.
        return reply.code(res.transport ? 502 : 500).send({
          error: res.transport
            ? `could not reach ${session.info.host}: ${res.output.split("\n")[0]}`
            : `tmux refused: ${res.output.split("\n")[0]}`,
        });
      }
      setTimeout(() => void agents.refresh(session.info.host), 800);
    }

    ptys.kill(id);
    // A link to a dead session is a capability pointing at nothing.
    for (const [key, l] of links) {
      if (l.source === id || l.target === id) links.delete(key);
    }
    persistLinks();
    return { ok: true };
  });

  /**
   * Search every open terminal's recent output at once, for the command
   * palette. Only live terminals: a closed one's text is not a place to jump to.
   */
  app.get("/api/search", async (req) => {
    const q = String((req.query as { q?: string }).q ?? "").slice(0, 200);
    return { hits: ctx.output.search(q).filter((h) => ptys.get(h.sessionId)) };
  });
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, Math.trunc(n)));
}
