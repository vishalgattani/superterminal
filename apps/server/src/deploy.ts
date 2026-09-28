import type { AppContext } from "./context.ts";
import type { PresetEdge, PresetGroup, PresetNode, PresetNote } from "./presets.ts";

/**
 * Deploy a preset: spawn its terminals, wait for Claude to register, then wire
 * the edges.
 *
 * The wait is the crux. A link points at a live Claude session id, and that id
 * only appears in `claude agents --json` a few seconds after launch. Wiring
 * immediately produced edges pointing at nothing, the same failure mode as
 * forking a session that had not started yet.
 */
/**
 * Spawn a graph and wire it, whether it came from a saved preset or from
 * duplicating a view. Shared so an unsaved graph deploys by exactly the same
 * path as a saved one, including the wait for Claude to register.
 */
export async function deployGraph(
  ctx: AppContext,
  preset: {
    name: string;
    nodes: PresetNode[];
    edges: PresetEdge[];
    groups?: PresetGroup[];
    notes?: PresetNote[];
  },
) {
  const { hostStatuses, ptys, agents, links, linkExists, persistLinks } = ctx;
  const created: { index: number; sessionId: string; label: string }[] = [];
  const failed: { label: string; error: string }[] = [];

  preset.nodes.forEach((node, index) => {
    const status = hostStatuses.find((h) => h.id === node.host);
    if (!status?.available) {
      failed.push({ label: node.label, error: status?.reason ?? "host unavailable" });
      return;
    }
    try {
      const info = ptys.create({
        host: node.host,
        cwd: node.cwd,
        cols: 80,
        rows: 45,
        alias: node.label,
        startClaude: node.claude,
      });
      created.push({ index, sessionId: info.sessionId, label: node.label });
    } catch (err) {
      failed.push({ label: node.label, error: (err as Error).message });
    }
  });

  // Spawning a terminal is not the same as getting a Claude session. A repo
  // with pre-approved permissions in .claude/settings.local.json shows a trust
  // prompt and waits, so the terminal is up while Claude never starts.
  // Reporting "7 spawned, 0 failed" there is true and useless, so wait for
  // Claude to register and say which nodes actually came up.
  const claudeNodes = created.filter((c) => preset.nodes[c.index]?.claude);
  const pending = new Set(claudeNodes.map((c) => c.sessionId));
  const deadline = Date.now() + 30_000;
  while (pending.size > 0 && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 2500));
    for (const host of new Set(preset.nodes.map((n) => n.host))) {
      await agents.refresh(host);
    }
    for (const c of claudeNodes) {
      if (!pending.has(c.sessionId)) continue;
      const rows = agents.get(preset.nodes[c.index]!.host)?.rows ?? [];
      const tmuxName =
        ptys.get(c.sessionId)?.info.tmuxSession ?? `cv-${c.sessionId.slice(0, 8)}`;
      if (rows.some((r) => r.tmuxSession === tmuxName)) pending.delete(c.sessionId);
    }
  }

  const notStarted = claudeNodes
    .filter((c) => pending.has(c.sessionId))
    .map((c) => ({
      label: c.label,
      sessionId: c.sessionId,
      // The common cause, worth naming rather than leaving as a mystery.
      hint: "no Claude session yet: the terminal may be waiting at a trust or permission prompt",
    }));

  const byIndex = new Map(created.map((c) => [c.index, c.sessionId]));
  const wired: string[] = [];
  for (const e of preset.edges) {
    const source = byIndex.get(e.from);
    const target = byIndex.get(e.to);
    if (!source || !target || linkExists(source, target)) continue;
    const id = `${source}->${target}`;
    links.set(id, { id, source, target });
    wired.push(id);
  }
  if (wired.length > 0) persistLinks();

  // Hand frames back resolved to the sessions that now exist, so the client
  // can put them on a fresh view without knowing the index mapping.
  const groups = (preset.groups ?? [])
    .map((g) => ({
      name: g.name,
      hue: g.hue,
      members: g.members
        .map((i) => byIndex.get(i))
        .filter((id): id is string => Boolean(id)),
    }))
    .filter((g) => g.members.length > 0);

  return {
    preset: preset.name,
    groups,
    notes: preset.notes ?? [],
    spawned: created.length,
    claudeStarted: claudeNodes.length - notStarted.length,
    claudeExpected: claudeNodes.length,
    wired: wired.length,
    failed,
    notStarted,
    sessions: created.map((c) => c.sessionId),
  };
}
