import type { FastifyInstance } from "fastify";
import type { AppContext } from "../context.ts";

/** Saved graph views: loaded once by the browser, saved as they change. */
export function registerViewsRoutes(app: FastifyInstance, ctx: AppContext): void {
  const { views } = ctx;

  app.get("/api/views", async () => ({ views: views.load() }));

  app.put("/api/views", async (req, reply) => {
    try {
      views.save(req.body);
      return { ok: true };
    } catch (err) {
      return reply.code(400).send({ error: (err as Error).message });
    }
  });
}
