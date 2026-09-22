// Where a terminal is working now: reading it out of tmux and the OS, and
// getting it from the status poll into the graph's sessions.
//
// Before this, `info.cwd` was set once at creation and nothing updated it, so a
// `cd` inside the shell left the label, the folder the node hangs under and
// every path tooltip on the starting folder.
import { spawn } from "node:child_process";
import { realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { check, repoRoot, report, src, stubBrowser } from "./harness.mjs";

const { parsePanes, parseLsofCwd, processCwd } = await import(
  `${repoRoot}/apps/server/src/status/cwd.ts`
);

// ---- parsePanes: which path is the terminal in
let m = parsePanes("cv-aaaa|1|1|/srv/repos/virtual-generator\n");
check("a single pane is that session's path", m.get("cv-aaaa") === "/srv/repos/virtual-generator");

m = parsePanes(
  ["cv-bbbb|1|0|/srv/left", "cv-bbbb|1|1|/srv/right", "cv-bbbb|0|1|/srv/other-window"].join("\n"),
);
check("with split panes and windows, the active pane of the active window wins",
  m.get("cv-bbbb") === "/srv/right", m.get("cv-bbbb"));

m = parsePanes("cv-cccc|0|0|/srv/first\ncv-cccc|0|1|/srv/second\n");
check("a session with nothing flagged active falls back to its first pane", m.get("cv-cccc") === "/srv/first");

m = parsePanes("cv-dddd|1|1|/srv/has|pipe/inside\n");
check("a `|` inside the path does not shift the fields", m.get("cv-dddd") === "/srv/has|pipe/inside", m.get("cv-dddd"));

m = parsePanes("cv-eeee|1|1|/a\ncv-ffff|1|1|/b\n");
check("each session gets its own path", m.get("cv-eeee") === "/a" && m.get("cv-ffff") === "/b");

// Other callers print `<pid> <session>` from the same command; and tmux prints
// nothing useful when there is no server. None of it may become a folder.
m = parsePanes("12345 cv-gggg\n\nnot a pane line\ncv-hhhh|x|y|/nope\ncv-iiii|1|1|\n\r\n");
check("lines in any other shape are skipped, never guessed at", m.size === 0, [...m].join(";"));
check("empty output is no panes", parsePanes("").size === 0);
check("CRLF line endings are handled", parsePanes("cv-jjjj|1|1|/srv/x\r\n").get("cv-jjjj") === "/srv/x");

// ---- parseLsofCwd
check("lsof -Fn output yields the path", parseLsofCwd("p123\nfcwd\nn/Users/x/repos\n") === "/Users/x/repos");
check("no name line is undefined", parseLsofCwd("p123\nfcwd\n") === undefined);
check("empty output is undefined", parseLsofCwd("") === undefined);

// ---- processCwd against a real process
const dir = realpathSync(tmpdir());
const child = spawn("sleep", ["30"], { cwd: dir, stdio: "ignore" });
await new Promise((r) => setTimeout(r, 200));
const got = await processCwd(child.pid);
if (got === undefined) {
  console.log("SKIP  processCwd on a real process: lsof is not available here");
} else {
  check("processCwd reads a live process's working directory", realpathSync(got) === dir, got);
}
child.kill();
check("...and is undefined for a pid that is gone", (await processCwd(child.pid)) === undefined);

// ---- the status poll reaches the graph's sessions
stubBrowser();
const { useStore } = await import(src("store.ts"));
const S = () => useStore.getState();
const info = (id, cwd) => ({ sessionId: id, host: "local", kind: "shell", cwd, shell: "sh", cols: 80, rows: 45, startedAt: 1 });
const status = (rows) => S().applyStatus({ sessions: rows });

S().addSession(info("A", "/start/a"));
S().addSession(info("B", "/start/b"));

status([{ sessionId: "A", activity: "shell", cwd: "/moved/a" }, { sessionId: "B", activity: "shell", cwd: "/start/b" }]);
check("a new cwd from the poll updates that session", S().sessions.A.cwd === "/moved/a", S().sessions.A.cwd);
check("...and leaves the one that did not move alone", S().sessions.B.cwd === "/start/b");
check("...and the cwd is not left behind as activity", !("cwd" in S().activity.A));

const before = S().sessions;
status([{ sessionId: "A", activity: "shell", cwd: "/moved/a" }, { sessionId: "B", activity: "shell", cwd: "/start/b" }]);
check("a poll that finds nothing new leaves `sessions` the same object (no re-render)", S().sessions === before);

status([{ sessionId: "A", activity: "working" }]);
check("a status with no cwd keeps the one it had", S().sessions.A.cwd === "/moved/a");

status([{ sessionId: "GONE", activity: "shell", cwd: "/x" }]);
check("a session the store does not know is not invented", S().sessions.GONE === undefined);

report();
