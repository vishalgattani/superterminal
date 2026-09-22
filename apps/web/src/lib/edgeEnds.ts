import { foreignId } from "../store/model.ts";

/**
 * Resolve a link end to the id the canvas uses for it.
 *
 * The server stores a link as two session ids. A terminal's canvas id *is* its
 * session id, but an external card's is `foreign:<host>:<sessionId>`, so a link
 * whose source is a session the viewer did not start would otherwise point at a
 * node that does not exist and the edge would silently not be drawn.
 *
 * Returns undefined when neither is on the canvas — a link can outlive the
 * session at either end, and an edge to nothing must be dropped rather than
 * guessed at.
 */
export function canvasEnd(
  id: string,
  terminalIds: ReadonlySet<string>,
  externals: ReadonlyArray<{ host: string; sessionId: string }>,
): string | undefined {
  if (terminalIds.has(id)) return id;
  const o = externals.find((e) => e.sessionId === id);
  return o ? foreignId(o) : undefined;
}
