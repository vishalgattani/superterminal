// Context-window usage percentage, scraped from the statusline the terminal
// already prints — the same trick cost.ts's CostScraper plays. Best-effort:
// no statusline visible, no reading, never a 0% that looks like "empty".
import { check, report, repoRoot } from "./harness.mjs";

const { ContextScraper } = await import(`${repoRoot}/apps/server/src/status/context.ts`);

const line = (pct) => `vault ⌥main | Sonnet 5 · medium | C${pct} | H52 ⏱3h19m | $65.88 session`;

let s = new ContextScraper();
check("no output yet: nothing to read", s.get("a") === undefined);

s.observe("a", line(87));
check("a bare Cnn in the statusline is read as a percentage", s.get("a")?.pct === 87);

// The rolling window keeps the last 4096 characters, oldest first: a redraw
// that lands before the earlier one has scrolled out of it still finds the
// earlier figure first (the same trade-off cost.ts's identical window makes).
// Padding past the window size is what makes a later reading win.
s.observe("a", "x".repeat(4100));
s.observe("a", line(12));
check("a later reading wins once the earlier one has scrolled out of the window", s.get("a")?.pct === 12);

s = new ContextScraper();
s.observe("a", "no statusline here, just a shell prompt");
check("output with no statusline yields no reading, not a zero", s.get("a") === undefined);

s = new ContextScraper();
s.observe("a", line(150));
check("an out-of-range figure is not trusted", s.get("a") === undefined);

s = new ContextScraper();
// Split across two chunks, as a pty can deliver mid-line.
s.observe("a", "vault ⌥main | Sonnet 5 · medium | C");
s.observe("a", "87 | H52 ⏱3h19m");
check("a line split across two chunks is still read, via the rolling tail", s.get("a")?.pct === 87);

s = new ContextScraper();
s.observe("a", line(40));
s.observe("b", line(90));
check("readings are kept per session, not shared", s.get("a")?.pct === 40 && s.get("b")?.pct === 90);

s = new ContextScraper();
s.observe("a", line(55));
s.forget("a");
check("forgetting a session drops its reading", s.get("a") === undefined);

s = new ContextScraper();
s.observe("a", "COST is not a context reading: C alone is not Cnn");
check("a bare 'C' with no digits is not matched", s.get("a") === undefined);
s.observe("a", "H87 is a different letter entirely");
check("a different letter is not mistaken for the context figure", s.get("a") === undefined);

report();
