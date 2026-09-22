// Live Claude sessions the viewer did not start: how they are reported, what
// Attach does, what Stop is allowed to signal, and what Reattach does to a
// terminal attached to a tmux session it did not create.
//
// The stub `claude agents --json` prints <rig>/agents.json and the stub
// `tmux list-panes` prints <rig>/panes.txt (pid, then tmux session), so a test
// can stage any set of "external" sessions. Each session is a real `sleep`
// process, because Stop sends a real signal to a real pid.
import { spawn } from "node:child_process";
import { existsSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { check, report } from "./harness.mjs";
import { alive, call, listSessions, resetRig, rigDir, sleep, tmuxClientPid, tmuxSessions, until } from "./api-helper.mjs";

await resetRig();

const id = (c, n) => `${c.repeat(8)}-0000-0000-0000-00000000000${n}`;
const A = id("a", 1), B = id("b", 2), C = id("c", 3), V = id("d", 4);
const now = Date.now();

const kids = [1, 2, 3].map(() => spawn("sleep", ["600"], { stdio: "ignore", detached: true }));
kids.forEach((k) => k.unref());
const [pa, pb, pc] = kids.map((k) => k.pid);
// The server refuses to signal its own ancestry (it is often started from inside
// a Claude session). Its parent is the runner, which is also this process's parent.
const viewerPid = process.ppid;

const stage = (rows, panes) => {
  writeFileSync(join(rigDir, "agents.json"), JSON.stringify(rows));
  writeFileSync(join(rigDir, "panes.txt"), panes);
};
stage(
  [
    { pid: pa, sessionId: A, cwd: "/srv/bg", kind: "background", name: "nightly-build", status: "waiting", state: "blocked", waitingFor: "input needed", startedAt: now },
    { pid: pb, sessionId: B, cwd: "/srv/ext-b", kind: "interactive", name: "ext-b", status: "busy", startedAt: now },
    { pid: pc, sessionId: C, cwd: "/srv/ext-c", kind: "interactive", name: "ext-c", status: "idle", startedAt: now },
    { pid: viewerPid, sessionId: V, cwd: "/srv/viewer", kind: "interactive", name: "viewer-host", status: "idle", startedAt: now },
  ],
  `${pb} ext-b\n${pc} ext-c\n`,
);
writeFileSync(join(rigDir, "tmux", "ext-b"), `${pb}\n`);
writeFileSync(join(rigDir, "tmux", "ext-c"), `${pc}\n`);

const orphans = async () => (await call("GET", "/api/status"))[1].orphans ?? [];
const post = (path, body) => call("POST", path, body ?? {});

try {
  // The agents poller runs every few seconds.
  const seen = await until(async () => ((await orphans()).length >= 4 ? await orphans() : null), 20000, 500);
  check("four external sessions are reported", seen?.length === 4, `${seen?.length}`);
  const by = Object.fromEntries((seen ?? []).map((o) => [o.name, o]));
  check("only tmux-backed ones are attachable", by["ext-b"]?.attachable && by["ext-c"]?.attachable && !by["nightly-build"]?.attachable && !by["viewer-host"]?.attachable);
  check("a session blocked on input says so", by["nightly-build"]?.activity === "waiting" && by["nightly-build"]?.waitingFor === "input needed", JSON.stringify(by["nightly-build"]));
  check("...and is reported as a background agent", by["nightly-build"]?.kind === "background");
  check("the session running the viewer is flagged", by["viewer-host"]?.isViewer === true && !by["ext-b"]?.isViewer);

  // ---- Attach
  let [s, r] = await post(`/api/agents/${A}/attach`, { host: "local" });
  check("attaching a session that is not in tmux is 400", s === 400, s);
  check("...and says why", /not running inside tmux/.test(r.error ?? ""), r.error);
  [s] = await post("/api/agents/nope/attach", { host: "local" });
  check("attaching an unknown session is 404", s === 404, s);

  // /srv/ext-b does not exist on this machine: attaching never uses the cwd, so a
  // session whose directory has since been deleted must still attach.
  [s, r] = await post(`/api/agents/${B}/attach`, { host: "local" });
  check("attaching a session whose directory does not exist here succeeds", s === 200 && !!r.session, JSON.stringify([s, r]));
  const t = r.session;
  check("...as a terminal on the existing tmux session, not a plain shell", t?.shell === "tmux attach ext-b", t?.shell);
  check("...that records the tmux name", t?.tmuxSession === "ext-b");
  check("...and keeps the cwd for display", t?.cwd === "/srv/ext-b");

  const claimed = await until(async () => {
    const st = (await call("GET", "/api/status"))[1];
    return st.sessions.find((x) => x.sessionId === t.sessionId)?.claudeSessionId === B && !st.orphans.some((o) => o.name === "ext-b");
  }, 15000, 500);
  check("the terminal is matched to its Claude session and the card leaves the external list", claimed === true);
  check("the other external sessions are untouched", (await orphans()).length === 3);

  // ---- Reattach keeps an attached terminal on ITS tmux session
  const beforeNames = tmuxSessions().join();
  await until(() => alive(tmuxClientPid("ext-b")) && tmuxClientPid("ext-b") !== pb, 8000);
  const droppedClient = tmuxClientPid("ext-b");
  process.kill(droppedClient); // the connection drops
  await sleep(1200);
  [s, r] = await post(`/api/sessions/${t.sessionId}/reattach`);
  check("reattach of an attached terminal is accepted", s === 200 && !!r.session, JSON.stringify([s, r]));
  await sleep(1200);
  check("...it made no new tmux session", tmuxSessions().join() === beforeNames, tmuxSessions().join());
  // The stub tmux writes its client's pid into the session's file when it attaches,
  // so a new live pid there means `tmux attach -t ext-b` really ran again.
  check("...it attached to ext-b again, by name",
    (await until(() => alive(tmuxClientPid("ext-b")) && tmuxClientPid("ext-b") !== droppedClient, 5000)) === true);
  check("...and the terminal still records that name", (await listSessions()).find((x) => x.sessionId === t.sessionId)?.tmuxSession === "ext-b");
  check("...and the Claude session is still running", alive(pb));

  // ---- Stop
  [s] = await post(`/api/agents/${V}/stop`, { host: "local" });
  check("stopping the session that runs the viewer is refused", s === 403, s);
  check("...and its process is untouched", alive(viewerPid));
  [s, r] = await post(`/api/agents/${C}/stop`, { host: "local" });
  check("stopping another session is accepted, with SIGTERM", s === 200 && r.signal === "TERM" && r.pid === pc, JSON.stringify([s, r]));
  check("...and that process really received it", (await until(() => !alive(pc), 5000)) === true);
  check("...while the others are still running", alive(pa) && alive(pb));
  [s] = await post("/api/agents/nope/stop", { host: "local" });
  check("stopping an unknown session is 404", s === 404, s);
  [s] = await call("POST", `/api/agents/${A}/stop`, { host: "local" }, { auth: false });
  check("stopping without a token is 401", s === 401, s);
} finally {
  await resetRig();
  for (const k of kids) { try { process.kill(k.pid, "SIGKILL"); } catch { /* gone */ } }
  for (const f of ["agents.json", "panes.txt"]) rmSync(join(rigDir, f), { force: true });
}
report();
