/**
 * Session cost, read from the statusline the terminal already prints.
 *
 * The owner's statusline.js renders Claude Code's authoritative
 * `cost.total_cost_usd`, e.g.
 *
 *   vault ⌥main | Sonnet 5 · medium | C87 | H52 ⏱3h19m | $65.88 session : $98.94 …
 *
 * Claude Code hands that number only to the statusline command, so the
 * alternatives are to modify the owner's statusline.js or to compute it from
 * tokens with a pricing table we would have to keep correct. Reading what is
 * already on screen needs neither, and it is the figure Claude Code itself
 * computed rather than our estimate of it.
 *
 * The trade-off, stated plainly: this only works while a statusline that
 * prints a dollar amount is visible, so it is best-effort. A session with no
 * such statusline simply has no cost, and the UI shows nothing rather than a
 * zero that looks like "free".
 */

/** `$65.88 session` and the bare `$98.94` that may follow it. */
const SESSION_COST = /\$\s?([0-9]+(?:\.[0-9]{1,2})?)\s*session/i;

export interface CostReading {
  sessionUsd: number;
  seenAt: number;
}

export class CostScraper {
  private readings = new Map<string, CostReading>();
  /** Per session, the tail of recent output, since a line can arrive split. */
  private tails = new Map<string, string>();

  get(sessionId: string): CostReading | undefined {
    return this.readings.get(sessionId);
  }

  /**
   * Feed terminal output. Called from a side tap on the pty stream, never in
   * the path that forwards bytes to the browser, so it cannot add latency to
   * what you see while typing.
   */
  observe(sessionId: string, chunk: string): void {
    // Keep a small rolling window: enough to span a split line, small enough
    // that scanning it is trivial.
    const tail = (this.tails.get(sessionId) ?? "") + chunk;
    const window = tail.length > 4096 ? tail.slice(-4096) : tail;
    this.tails.set(sessionId, window);

    const match = window.match(SESSION_COST);
    if (!match) return;
    const usd = Number.parseFloat(match[1]!);
    if (!Number.isFinite(usd)) return;
    this.readings.set(sessionId, { sessionUsd: usd, seenAt: Date.now() });
  }

  forget(sessionId: string): void {
    this.readings.delete(sessionId);
    this.tails.delete(sessionId);
  }
}
