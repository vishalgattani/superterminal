/**
 * How a subagent count is described on a node.
 *
 * The count comes from a transcript scan, so it is as fresh as that scan and
 * no fresher. The age travels with it deliberately: a bare "3 subagents" reads
 * as live, and the number most likely to be wrong is the one that matters
 * most — a fan-out that has just started still scans as zero.
 */
export function subagentLabel(n: number): string {
  return n === 1 ? "1 subagent" : `${n} subagents`;
}

/** "just now", "12s ago", "3m ago" — enough to judge whether to trust it. */
export function scanAge(fetchedAt: number, now = Date.now()): string {
  if (!fetchedAt) return "not scanned yet";
  const s = Math.max(0, Math.round((now - fetchedAt) / 1000));
  if (s < 5) return "just now";
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  return m === 1 ? "1m ago" : `${m}m ago`;
}

/**
 * Whether a count is fresh enough to be worth believing without saying so.
 * Past this the node says the age out loud rather than only in a tooltip.
 */
export function isStale(fetchedAt: number, now = Date.now()): boolean {
  return !fetchedAt || now - fetchedAt > 45_000;
}
