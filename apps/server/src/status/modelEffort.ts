/**
 * The model and effort a running Claude is using, read from the statusline the
 * terminal already prints — the same trick as `cost.ts` and `context.ts`,
 * applied to the `Sonnet 5 · medium` segment of the same line:
 *
 *   vault ⌥main | Sonnet 5 · medium | C87 | H52 ⏱3h19m | $65.88 session : $98.94 …
 *
 * `--model` at launch is only what the terminal was started with; `/model`
 * and `/effort` change both mid-session, and the statusline is the one place
 * the viewer can see the current values without hooks. Best-effort: no such
 * segment on screen, no pill.
 */

/** A known model family, then ` · ` and an effort level, between `|`s. */
const MODEL_EFFORT =
  /[|│]\s*((?:Opus|Sonnet|Haiku|Fable)\b[^|│·]*?)\s*·\s*(low|medium|high|xhigh|max|ultracode)\s*(?=[|│])/gi;

export function parseModelEffort(text: string): { model: string; effort: string } | undefined {
  let last: RegExpExecArray | undefined;
  for (const m of text.matchAll(MODEL_EFFORT)) last = m as RegExpExecArray;
  if (!last) return undefined;
  return { model: last[1]!.trim(), effort: last[2]!.toLowerCase() };
}

export interface ModelEffortReading {
  model: string;
  effort: string;
  seenAt: number;
}

export class ModelEffortScraper {
  private readings = new Map<string, ModelEffortReading>();
  /** Per session, the tail of recent output, since a line can arrive split. */
  private tails = new Map<string, string>();

  get(sessionId: string): ModelEffortReading | undefined {
    return this.readings.get(sessionId);
  }

  observe(sessionId: string, chunk: string): void {
    const tail = (this.tails.get(sessionId) ?? "") + chunk;
    const window = tail.length > 4096 ? tail.slice(-4096) : tail;
    this.tails.set(sessionId, window);

    const found = parseModelEffort(window);
    if (found) this.readings.set(sessionId, { ...found, seenAt: Date.now() });
  }

  forget(sessionId: string): void {
    this.readings.delete(sessionId);
    this.tails.delete(sessionId);
  }
}
