import type { NodePosition } from "../store.ts";

/**
 * Arrange nodes by their connections.
 *
 * Layered by longest path from a root, so a chain like
 * vault -> testing -> virtual-generator -> controllers reads as four ranks
 * rather than collapsing into two. Unconnected nodes form their own rank at
 * the end instead of piling on the origin.
 */
export type LayoutKind = "LR" | "TD" | "grid";

// Planning width for layout. Nodes size to their content, so this is a
// little wider than the minimum to stop a long label overlapping the
// next rank.
const NODE_W = 250;
const NODE_H = 92;

export function layoutGraph(
  ids: string[],
  links: { source: string; target: string }[],
  kind: LayoutKind,
): Record<string, NodePosition> {
  const out: Record<string, NodePosition> = {};
  if (ids.length === 0) return out;

  if (kind === "grid") {
    const cols = Math.ceil(Math.sqrt(ids.length));
    ids.forEach((id, i) => {
      out[id] = {
        x: 40 + (i % cols) * (NODE_W + 40),
        y: 40 + Math.floor(i / cols) * (NODE_H + 40),
      };
    });
    return out;
  }

  const index = new Map(ids.map((id, i) => [id, i]));
  const edges = links
    .map((l) => [index.get(l.source), index.get(l.target)] as const)
    .filter((e): e is readonly [number, number] => e[0] !== undefined && e[1] !== undefined);

  const depth = new Array(ids.length).fill(0);
  // Relax repeatedly rather than recursing: cycles then settle instead of
  // overflowing the stack, which a user-drawn graph can easily contain.
  for (let pass = 0; pass < ids.length; pass++) {
    let moved = false;
    for (const [from, to] of edges) {
      if (depth[to] < depth[from] + 1) {
        depth[to] = depth[from] + 1;
        moved = true;
      }
    }
    if (!moved) break;
  }

  const connected = new Set(edges.flat());
  const ranks = new Map<number, number[]>();
  ids.forEach((_, i) => {
    // Park unconnected nodes in a rank of their own, past the deepest one.
    const d = connected.has(i) ? depth[i]! : Math.max(...depth, 0) + 1;
    ranks.set(d, [...(ranks.get(d) ?? []), i]);
  });

  const widest = Math.max(...[...ranks.values()].map((r) => r.length), 1);
  const GAP_MAIN = kind === "LR" ? 110 : 70;
  const GAP_CROSS = 30;

  for (const [d, members] of ranks) {
    members.forEach((i, k) => {
      if (kind === "LR") {
        const span = members.length * (NODE_H + GAP_CROSS);
        const full = widest * (NODE_H + GAP_CROSS);
        out[ids[i]!] = {
          x: 40 + d * (NODE_W + GAP_MAIN),
          y: 40 + (full - span) / 2 + k * (NODE_H + GAP_CROSS),
        };
      } else {
        const span = members.length * (NODE_W + GAP_CROSS);
        const full = widest * (NODE_W + GAP_CROSS);
        out[ids[i]!] = {
          x: 40 + (full - span) / 2 + k * (NODE_W + GAP_CROSS),
          y: 40 + d * (NODE_H + GAP_MAIN),
        };
      }
    });
  }
  return out;
}
