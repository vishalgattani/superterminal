/**
 * Context-window usage percentage, read from the statusline the terminal
 * already prints — the same trick `cost.ts`'s `CostScraper` plays, applied to
 * a different figure in the same line, e.g.
 *
 *   vault ⌥main | Sonnet 5 · medium | C87 | H52 ⏱3h19m | $65.88 session : $98.94 …
 *
 * `C87` is assumed to be a context-percentage figure the owner's
 * statusline.js prints — unconfirmed at the time this was written (see the
 * PR this shipped in). If that assumption is wrong, this reads garbage for
 * every session with a statusline and nothing changes for a session without
 * one, so the failure mode is silent and bounded to this one feature; it is
 * not load-bearing for anything else in the viewer. The correct fallback,
 * should the assumption not hold, is computing the percentage from token
 * counts in the transcript (`transcripts.ts`) against a per-model
 * context-window table — real effort, deferred until the assumption is
 * checked.
 *
 * Same trade-off as cost: best-effort. No statusline visible, no percentage
 * shown — never a 0% that reads as "empty context".
 */

/** `C87`, `C100`, `C5` — a bare `C` followed by 1-3 digits, word-bounded. */
const CONTEXT_PCT = /\bC(\d{1,3})\b/;

export interface ContextReading {
  pct: number;
  seenAt: number;
}

export class ContextScraper {
  private readings = new Map<string, ContextReading>();
  /** Per session, the tail of recent output, since a line can arrive split. */
  private tails = new Map<string, string>();

  get(sessionId: string): ContextReading | undefined {
    return this.readings.get(sessionId);
  }

  /**
   * Feed terminal output. Called from the same side tap on the pty stream
   * `CostScraper.observe()` gets, never in the path that forwards bytes to
   * the browser, so it cannot add latency to what you see while typing.
   */
  observe(sessionId: string, chunk: string): void {
    const tail = (this.tails.get(sessionId) ?? "") + chunk;
    const window = tail.length > 4096 ? tail.slice(-4096) : tail;
    this.tails.set(sessionId, window);

    const match = window.match(CONTEXT_PCT);
    if (!match) return;
    const pct = Number.parseInt(match[1]!, 10);
    // A malformed or out-of-range figure is not trustworthy enough to show.
    if (!Number.isFinite(pct) || pct < 0 || pct > 100) return;
    this.readings.set(sessionId, { pct, seenAt: Date.now() });
  }

  forget(sessionId: string): void {
    this.readings.delete(sessionId);
    this.tails.delete(sessionId);
  }
}
