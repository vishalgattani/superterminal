// Command palette matching and the output index behind its search (#17).
import { check, repoRoot, report, src } from "./harness.mjs";

const { fuzzyScore, rankItems } = await import(src("lib/palette.ts"));
const { OutputIndex, stripAnsi } = await import(`${repoRoot}/apps/server/src/status/outputIndex.ts`);

check("characters must appear in order", fuzzyScore("vg", "virtual-generator") !== null && fuzzyScore("gv", "ab") === null);
check("word starts beat scattered letters", fuzzyScore("vg", "virtual-generator") > fuzzyScore("vg", "vault/logs-g"));
const item = (label, detail) => ({ id: label, label, detail, group: "session", run() {} });
const items = [item("vault", "fire · /home/me/vault"), item("api", "local · /srv/api · 1a2b3c4d")];
check("an empty query keeps everything, in order", rankItems(items, "").map((i) => i.id).join() === "vault,api");
check("detail is matched too: host, folder, Claude id", rankItems(items, "1a2b")[0]?.id === "api" && rankItems(items, "1a2b").length === 1);

check("escape sequences are stripped", stripAnsi("\x1b[1;32mgreen\x1b[0m \x1b]0;title\x07done\r") === "green done");
const idx = new OutputIndex();
idx.observe("A", "build ok\nall good\n");
idx.observe("B", "compiling\nERROR: \x1b[31mlinker failed\x1b[0m\nprompt$ ");
const hits = idx.search("linker");
check("search finds text in whichever terminal printed it", hits.length === 1 && hits[0].sessionId === "B" && hits[0].text.includes("linker failed"), JSON.stringify(hits));
check("search is case-insensitive", idx.search("LINKER").length === 1);
check("one-character queries are not searched", idx.search("l").length === 0);
check("tail gives the last lines", idx.tail("A", 2) === "all good\n");
idx.observe("C", "x".repeat(300_000) + "\nend-marker");
check("each terminal's text is bounded", idx.tail("C", 1) === "end-marker" && idx.search("end-marker").length === 1);

report();
