// A terminal's folder follows where it is working, end to end through the server.
//
// The stub `tmux list-panes -F ...pane_current_path...` prints <rig>/cwd-panes.txt,
// so a test stages "the shell cd'd here" by writing that file. The server asks on
// its status poll (every 4s), so each wait below is a poll or two.
import { rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { check, report } from "./harness.mjs";
import { call, createSession, listSessions, resetRig, rigDir, sleep, tmuxSessions, until } from "./api-helper.mjs";

const panesFile = join(rigDir, "cwd-panes.txt");
const down = join(rigDir, "down");
const stage = (lines) => writeFileSync(panesFile, lines.join("\n") + "\n");
const cwdOf = async (id) => (await listSessions()).find((s) => s.sessionId === id)?.cwd;
const statusCwd = async (id) => {
  const [, body] = await call("GET", "/api/status");
  return body.sessions?.find((s) => s.sessionId === id)?.cwd;
};

await resetRig();

const a = await createSession("fire", "/srv/start-a");
const b = await createSession("fire", "/srv/start-b");
await until(() => tmuxSessions().includes(a.tmuxSession) && tmuxSessions().includes(b.tmuxSession), 5000);
check("a node starts in the folder it was made with", (await cwdOf(a.sessionId)) === "/srv/start-a");

// ---- a cd inside the shell reaches the node
stage([`${a.tmuxSession}|1|1|/home/me/repos/virtual-generator`]);
const moved = await until(async () => (await cwdOf(a.sessionId)) === "/home/me/repos/virtual-generator", 15000);
check("after a cd, the node's cwd becomes the new folder", moved === true, await cwdOf(a.sessionId));
check("...and /api/status carries it, which is how the graph learns",
  (await statusCwd(a.sessionId)) === "/home/me/repos/virtual-generator", await statusCwd(a.sessionId));
check("...and a terminal tmux said nothing about keeps its folder", (await cwdOf(b.sessionId)) === "/srv/start-b");

// ---- split panes: the active pane of the active window is where the owner is
stage([
  `${a.tmuxSession}|1|0|/srv/left`,
  `${a.tmuxSession}|1|1|/srv/right`,
  `${a.tmuxSession}|0|1|/srv/other-window`,
  `${b.tmuxSession}|1|1|/srv/b-moved`,
]);
const both = await until(async () => (await cwdOf(a.sessionId)) === "/srv/right" && (await cwdOf(b.sessionId)) === "/srv/b-moved", 15000);
check("the active pane wins, and every terminal is updated from one answer", both === true,
  `${await cwdOf(a.sessionId)} ${await cwdOf(b.sessionId)}`);

// ---- an unreachable box must not lose or invent a folder
writeFileSync(down, "");
stage([`${a.tmuxSession}|1|1|/srv/while-down`]);
await sleep(9000); // two polls
check("while the host is unreachable, the folder is left as it was", (await cwdOf(a.sessionId)) === "/srv/right", await cwdOf(a.sessionId));
rmSync(down, { force: true });
const back = await until(async () => (await cwdOf(a.sessionId)) === "/srv/while-down", 15000);
check("...and it catches up once the host answers again", back === true, await cwdOf(a.sessionId));

rmSync(panesFile, { force: true });
report();
