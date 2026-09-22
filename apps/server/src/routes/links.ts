import type { FastifyInstance } from "fastify";
import type { AppContext } from "../context.ts";

/** Context links between terminals. */
export function registerLinksRoutes(app: FastifyInstance, ctx: AppContext): void {
  const { ptys, links, linkExists, persistLinks, agents } = ctx;

  /**
   * A link's two ends are not the same kind of thing.
   *
   * The **target** is a capability: text gets written into its pty, so it must
   * be one of ours. The **source** is only an identity — the thing named as the
   * writer when `/input` checks `linkExists(from, id)`. Requiring the source to
   * be a pty as well conflated the two, and the cost was that a Claude session
   * the viewer did not start could not be shown driving anything, though it
   * plainly was.
   *
   * So a source may also be a live session we merely observe: it is a real,
   * running Claude with a stable id, just not one we own.
   */
  const knownAsSource = (id: string): boolean =>
    Boolean(ptys.get(id)) ||
    agents.all().some((h) => h.rows.some((r) => r.sessionId === id));

  app.get("/api/links", async () => ({ links: [...links.values()] }));

  app.post("/api/links", async (req, reply) => {
    const { source, target } = (req.body ?? {}) as {
      source?: string;
      target?: string;
    };
    if (!source || !target) {
      return reply.code(400).send({ error: "source and target required" });
    }
    if (source === target) {
      return reply.code(400).send({ error: "a session cannot link to itself" });
    }
    // The target must be ours: writing into a session with no pty is not a
    // permission question, it is impossible.
    if (!ptys.get(target)) {
      return reply
        .code(404)
        .send({ error: "the target must be a terminal this viewer owns" });
    }
    if (!knownAsSource(source)) {
      return reply.code(404).send({ error: "no such session" });
    }
    if (linkExists(source, target)) {
      return { links: [...links.values()] };
    }
    const id = `${source}->${target}`;
    links.set(id, { id, source, target });
    persistLinks();
    return { links: [...links.values()] };
  });

  app.delete("/api/links/:id", async (req) => {
    const { id } = req.params as { id: string };
    links.delete(decodeURIComponent(id));
    persistLinks();
    return { links: [...links.values()] };
  });
}
