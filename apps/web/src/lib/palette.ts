/**
 * Fuzzy matching for the command palette (issue #17): every query character
 * must appear in order. Contiguous runs and word starts score higher, so
 * "vg" finds "virtual-generator" ahead of "vault/logs".
 */
export function fuzzyScore(query: string, text: string): number | null {
  const q = query.toLowerCase().replace(/\s+/g, "");
  if (!q) return 0;
  const t = text.toLowerCase();
  let score = 0;
  let at = -1;
  for (const ch of q) {
    const next = t.indexOf(ch, at + 1);
    if (next < 0) return null;
    score += next === at + 1 ? 3 : 1;
    if (next === 0 || /[\s/_.:·-]/.test(t[next - 1]!)) score += 2;
    at = next;
  }
  return score - t.length / 100;
}

export interface PaletteItem {
  id: string;
  /** What is matched and shown. */
  label: string;
  /** Secondary text, also matched: host, folder, Claude session id. */
  detail?: string;
  group: "session" | "view" | "action" | "output";
  run: () => void;
}

/** Items matching the query, best first; everything, in order, for an empty query. */
export function rankItems(items: PaletteItem[], query: string): PaletteItem[] {
  if (!query.trim()) return items;
  return items
    .map((it) => ({ it, s: fuzzyScore(query, `${it.label} ${it.detail ?? ""}`) }))
    .filter((x): x is { it: PaletteItem; s: number } => x.s !== null)
    .sort((a, b) => b.s - a.s)
    .map((x) => x.it);
}
