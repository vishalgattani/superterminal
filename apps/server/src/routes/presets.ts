import type { FastifyInstance } from "fastify";
import type { HostId } from "@cv/shared";
import { cleanNotes, type PresetEdge, type PresetGroup, type PresetNode } from "../presets.ts";
import type { AppContext } from "../context.ts";

/** Saved graphs, and deploying them. */
export function registerPresetsRoutes(app: FastifyInstance, ctx: AppContext): void {
  const { hostStatuses, ptys, agents, presets, links, deployGraph } = ctx;

  app.get("/api/presets", async () => ({ presets: presets.list() }));

  app.post("/api/presets", async (req, reply) => {
    const body = req.body as {
      name?: string;
      description?: string;
      // Frames live in the browser, so the client sends them by session id and
      // the server stores them as indices alongside the edges.
      groups?: { name: string; hue: number; members: string[] }[];
      notes?: unknown;
      // The sessions to save, when saving from a view that shows a subset.
      // Omitted means everything that is open.
      members?: string[];
    };
    if (!body?.name?.trim()) {
      return reply.code(400).send({ error: "name required" });
    }
    // Snapshot the live graph: what is open now, and how it is wired.
    let open = ptys.list();
    if (Array.isArray(body.members)) {
      // Keep the caller's order, and drop ids that are not live sessions rather
      // than saving a node for something that no longer exists.
      open = body.members
        .map((id) => ptys.get(id)?.info)
        .filter((info): info is NonNullable<typeof info> => Boolean(info));
      if (open.length === 0) {
        return reply.code(400).send({ error: "this view has no sessions to save" });
      }
    }
    const index = new Map(open.map((s, i) => [s.sessionId, i]));
    const claudeBySession = new Set(
      agents
        .all()
        .flatMap((a) => a.rows)
        .map((r) => r.tmuxSession)
        .filter(Boolean) as string[],
    );
    try {
      return {
        presets: presets.save({
          name: body.name.trim(),
          description: body.description,
          nodes: open.map((s) => ({
            host: s.host,
            cwd: s.cwd,
            label: s.alias || s.cwd.split("/").filter(Boolean).pop() || "terminal",
            // Record whether a Claude was running here, so redeploying
            // reproduces what you had rather than a row of bare shells.
            claude: claudeBySession.has(s.tmuxSession ?? `cv-${s.sessionId.slice(0, 8)}`),
          })),
          edges: [...links.values()]
            .map((l) => ({ from: index.get(l.source), to: index.get(l.target) }))
            .filter((e): e is { from: number; to: number } =>
              e.from !== undefined && e.to !== undefined,
            ),
          groups: (body.groups ?? [])
            .map((g) => ({
              name: g.name,
              hue: g.hue,
              members: g.members
                .map((m) => index.get(m))
                .filter((i): i is number => i !== undefined),
            }))
            // A frame whose sessions are all gone is not worth saving.
            .filter((g) => g.members.length > 0),
          notes: cleanNotes(body.notes),
        }),
      };
    } catch (err) {
      return reply.code(400).send({ error: (err as Error).message });
    }
  });

  /**
   * Import a preset from JSON, as written by the export button or by hand.
   *
   * Separate from POST /api/presets, which snapshots the live graph: this takes
   * a complete preset and validates it, so a hand-edited or shared file cannot
   * put nonsense into the store.
   */
  app.post("/api/presets/import", async (req, reply) => {
    const body = req.body as {
      name?: string;
      description?: string;
      nodes?: unknown;
      edges?: unknown;
    };
    const name = body?.name?.trim();
    if (!name) return reply.code(400).send({ error: "name required" });
    if (!Array.isArray(body.nodes) || body.nodes.length === 0) {
      return reply.code(400).send({ error: "nodes must be a non-empty array" });
    }

    const validHosts = new Set(hostStatuses.map((h) => h.id));
    const nodes = [];
    for (const raw of body.nodes as Record<string, unknown>[]) {
      const host = String(raw?.host ?? "");
      const cwd = String(raw?.cwd ?? "");
      if (!validHosts.has(host as HostId)) {
        return reply.code(400).send({ error: `unknown host "${host}"` });
      }
      if (!cwd) return reply.code(400).send({ error: "every node needs a cwd" });
      nodes.push({
        host: host as HostId,
        cwd,
        label: String(raw?.label ?? cwd.split("/").filter(Boolean).pop() ?? "terminal"),
        claude: Boolean(raw?.claude),
      });
    }

    const edges = [];
    for (const raw of (Array.isArray(body.edges) ? body.edges : []) as Record<string, unknown>[]) {
      const from = Number(raw?.from);
      const to = Number(raw?.to);
      // Out-of-range indices would silently drop connections at deploy time.
      if (!Number.isInteger(from) || !Number.isInteger(to)) {
        return reply.code(400).send({ error: "edges need integer from/to" });
      }
      if (from < 0 || to < 0 || from >= nodes.length || to >= nodes.length) {
        return reply.code(400).send({
          error: `edge ${from}->${to} points outside the ${nodes.length} nodes`,
        });
      }
      if (from !== to) edges.push({ from, to });
    }

    const groups: PresetGroup[] = [];
    for (const raw of (Array.isArray((body as { groups?: unknown }).groups)
      ? (body as { groups: Record<string, unknown>[] }).groups
      : [])) {
      const members = (Array.isArray(raw?.members) ? raw.members : [])
        .map(Number)
        .filter((i) => Number.isInteger(i) && i >= 0 && i < nodes.length);
      if (members.length === 0) continue;
      groups.push({
        name: String(raw?.name ?? "group"),
        hue: Number.isFinite(Number(raw?.hue)) ? Number(raw.hue) % 360 : 210,
        members,
      });
    }

    try {
      return {
        presets: presets.save({
          name,
          description: body.description,
          nodes,
          edges,
          groups,
          notes: cleanNotes((body as { notes?: unknown }).notes),
        }),
        imported: name,
      };
    } catch (err) {
      return reply.code(400).send({ error: (err as Error).message });
    }
  });

  app.delete("/api/presets/:name", async (req) => ({
    presets: presets.remove(decodeURIComponent((req.params as { name: string }).name)),
  }));

  app.post("/api/presets/:name/deploy", async (req, reply) => {
    const name = decodeURIComponent((req.params as { name: string }).name);
    const preset = presets.get(name);
    if (!preset) return reply.code(404).send({ error: `no preset "${name}"` });
    return deployGraph(preset);
  });

  /**
   * Deploy a graph that was never saved, which is what duplicating a view with
   * new sessions does. Validated like an import, since it comes from the client.
   */
  app.post("/api/deploy", async (req, reply) => {
    const body = req.body as {
      name?: string;
      nodes?: PresetNode[];
      edges?: PresetEdge[];
    };
    if (!Array.isArray(body?.nodes) || body.nodes.length === 0) {
      return reply.code(400).send({ error: "nodes required" });
    }
    const validHosts = new Set(hostStatuses.map((h) => h.id));
    for (const n of body.nodes) {
      if (!validHosts.has(n.host)) {
        return reply.code(400).send({ error: `unknown host "${n.host}"` });
      }
    }
    const edges = (body.edges ?? []).filter(
      (e) =>
        Number.isInteger(e.from) &&
        Number.isInteger(e.to) &&
        e.from !== e.to &&
        e.from >= 0 &&
        e.to >= 0 &&
        e.from < body.nodes!.length &&
        e.to < body.nodes!.length,
    );
    return deployGraph({
      name: body.name ?? "duplicate",
      nodes: body.nodes,
      edges,
      groups: (body as { groups?: PresetGroup[] }).groups,
      notes: cleanNotes((body as { notes?: unknown }).notes),
    });
  });
}
