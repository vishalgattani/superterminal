/**
 * A searchable text tail of every terminal's output, for the command palette's
 * cross-terminal search (issue #17).
 *
 * Fed from the same side tap as the cost scraper, never from the path that
 * forwards bytes to the browser. Escape sequences and carriage-return redraws
 * are stripped, so what is searched is roughly what was on screen. Bounded per
 * terminal: this is "recent output", not a log.
 */

const MAX_CHARS = 200_000;
// CSI, OSC (BEL or ST terminated), and single-character escapes.
const ANSI = /\x1b\[[0-?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b[@-Z\\-_]/g;

export function stripAnsi(s: string): string {
  return s.replace(ANSI, "").replace(/[\x00-\x08\x0b-\x1f\x7f]/g, "");
}

export interface SearchHit {
  sessionId: string;
  /** The matching line, trimmed to something a palette row can show. */
  text: string;
  /** How far back from the newest output, in lines: 0 is the latest line. */
  linesAgo: number;
}

export class OutputIndex {
  private text = new Map<string, string>();

  observe(sessionId: string, chunk: string): void {
    const next = (this.text.get(sessionId) ?? "") + stripAnsi(chunk);
    this.text.set(sessionId, next.length > MAX_CHARS ? next.slice(-MAX_CHARS) : next);
  }

  /** The last `lines` lines of a terminal's output. */
  tail(sessionId: string, lines: number): string {
    return (this.text.get(sessionId) ?? "").split("\n").slice(-lines).join("\n");
  }

  /** Case-insensitive substring search, newest first, at most `limit` hits. */
  search(query: string, limit = 50): SearchHit[] {
    const q = query.toLowerCase();
    if (q.length < 2) return [];
    const hits: SearchHit[] = [];
    for (const [sessionId, text] of this.text) {
      const lines = text.split("\n");
      for (let i = lines.length - 1; i >= 0 && hits.length < limit; i--) {
        const line = lines[i]!;
        const at = line.toLowerCase().indexOf(q);
        if (at < 0) continue;
        const from = Math.max(0, at - 60);
        hits.push({ sessionId, text: line.slice(from, at + q.length + 60).trim(), linesAgo: lines.length - 1 - i });
      }
    }
    return hits.sort((a, b) => a.linesAgo - b.linesAgo).slice(0, limit);
  }

  forget(sessionId: string): void {
    this.text.delete(sessionId);
  }
}
