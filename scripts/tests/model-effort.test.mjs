// The model and effort a node shows come from the statusline Claude prints,
// not from the --model the terminal was started with (issue #16).
import { check, repoRoot, report } from "./harness.mjs";

const { parseModelEffort, ModelEffortScraper } = await import(
  `${repoRoot}/apps/server/src/status/modelEffort.ts`
);

const line = "vault ⌥main | Sonnet 5 · medium | C87 | H52 ⏱3h19m | $65.88 session : $98.94";
let got = parseModelEffort(line);
check("model and effort are read from the statusline", got?.model === "Sonnet 5" && got?.effort === "medium", JSON.stringify(got));

got = parseModelEffort("a | Opus 5.5 (1M context) · xhigh | C12 |");
check("a model name with detail keeps it", got?.model === "Opus 5.5 (1M context)" && got?.effort === "xhigh", JSON.stringify(got));

check("text with no such segment reads nothing", parseModelEffort("$ ls | grep medium") === undefined);
check("an unknown effort word is not taken", parseModelEffort("| Sonnet 5 · spicy |") === undefined);

const s = new ModelEffortScraper();
s.observe("t", "x | Sonnet 5 · med");
s.observe("t", "ium | C1 |");
check("a segment split across chunks is still read", s.get("t")?.effort === "medium");
s.observe("t", "\r| Opus 5.5 · high | C2 |");
check("a /model switch replaces the reading", s.get("t")?.model === "Opus 5.5" && s.get("t")?.effort === "high");
s.forget("t");
check("forget clears it, so an exited Claude leaves no pill", s.get("t") === undefined);

report();
