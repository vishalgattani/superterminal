// Closing a remote terminal, and what happens to the tmux session behind it.
//
// A fire session lives in tmux, so closing its node only lets go of it: it keeps
// running and comes back when the viewer restarts. `?terminate=1` is the only way
// to end it from the UI. The stub ssh and tmux stand in for the box, and
// `<rig>/down` makes the stub ssh fail like an unreachable host.
import { rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { check, report } from "./harness.mjs";
import { alive, call, createSession, listSessions, resetRig, rigDir, sleep, sshLog, tmuxClientPid, tmuxSessions, until } from "./api-helper.mjs";

const down = join(rigDir, "down");
const del = (id, query = "") => call("DELETE", `/api/sessions/${id}${query}`);
const count = async () => (await listSessions()).length;

await resetRig();

// ---- Disconnect (a plain close) leaves the remote session running
const a = await createSession("fire");
const tmuxA = a.tmuxSession;
check("a fire terminal gets a cv- tmux name", /^cv-[0-9a-f]{8}$/.test(tmuxA ?? ""), tmuxA);
check("the stub tmux session exists", await until(() => tmuxSessions().includes(tmuxA), 5000) === true);

let [s] = await del(a.sessionId);
check("a plain close is 200", s === 200, s);
check("...and leaves the tmux session running", tmuxSessions().includes(tmuxA));
check("...and drops the node", (await count()) === 0);

// ---- Reconcile brings it back under a new id, with the same tmux name
let [, rec] = await call("POST", "/api/reconcile");
check("reconcile re-adopts the survivor", rec.adopted === 1, JSON.stringify(rec));
const adopted = (await listSessions()).find((x) => x.tmuxSession === tmuxA);
check("...with a new id and the old tmux name", !!adopted && adopted.sessionId !== a.sessionId);

// ---- Terminate ends it
[s, rec] = await del(adopted.sessionId, "?terminate=1");
check("terminate is 200", s === 200 && rec.ok === true, JSON.stringify([s, rec]));
check("...removes the tmux session", !tmuxSessions().includes(tmuxA));
check("...drops the node", (await count()) === 0);
check("...using an exact-match target, never a prefix",
  sshLog().some((l) => l.includes(`kill-session -t '=${tmuxA}'`)), sshLog().filter((l) => l.includes("kill-session")).join(" | "));

// ---- Already gone on the box: still the outcome asked for
const b = await createSession("fire");
await until(() => tmuxSessions().includes(b.tmuxSession), 5000);
rmSync(join(rigDir, "tmux", b.tmuxSession), { force: true });
[s, rec] = await del(b.sessionId, "?terminate=1");
check("terminating a session that is already gone is 200, not an error", s === 200, JSON.stringify([s, rec]));
check("...and the node is dropped", (await count()) === 0);

// ---- Unreachable: a running session must never be hidden
const c = await createSession("fire");
await until(() => tmuxSessions().includes(c.tmuxSession), 5000);
writeFileSync(down, "");
[s, rec] = await del(c.sessionId, "?terminate=1");
check("an unreachable host is 502", s === 502, JSON.stringify([s, rec]));
check("...naming the cause", /could not reach/.test(rec.error ?? ""), rec.error);
check("...and keeps the node, so the session is not hidden", (await count()) === 1);
check("...and leaves the tmux session alone", tmuxSessions().includes(c.tmuxSession));
rmSync(down, { force: true });
[s] = await del(c.sessionId, "?terminate=1");
check("retrying once the host is back succeeds", s === 200, s);
check("...and ends the session", !tmuxSessions().includes(c.tmuxSession));

// ---- Things that are not remote, not there, or not allowed
const local = await createSession("local", "/tmp");
[s] = await del(local.sessionId, "?terminate=1");
check("terminate on a local terminal is 400 (nothing remote to end)", s === 400, s);
check("...and the node is kept", (await count()) === 1);
[s] = await del(local.sessionId);
check("a plain close of a local terminal still works", s === 200 && (await count()) === 0);
[s] = await del("00000000-0000-0000-0000-000000000000", "?terminate=1");
check("terminating an unknown id is 404", s === 404, s);
[s] = await call("DELETE", "/api/sessions/x?terminate=1", undefined, { auth: false });
check("no token is 401", s === 401, s);
[s] = await call("DELETE", "/api/sessions/x?terminate=1&tmux=other");
check("a request cannot name the tmux session to end", s === 404, s);

// ---- Reattach must rejoin the SAME tmux session, including after a re-adoption
// (a re-adopted terminal has a new id but keeps its old tmux name, so re-planning
// from the id alone would start a second session and leave the real one alone)
const d = await createSession("fire");
await until(() => tmuxSessions().includes(d.tmuxSession), 5000);
await del(d.sessionId);
await call("POST", "/api/reconcile");
const re = (await listSessions()).find((x) => x.tmuxSession === d.tmuxSession);
const before = tmuxSessions().filter((n) => n.startsWith("cv-"));
const attachesBefore = sshLog().filter((l) => l.includes(`tmux attach -t '${d.tmuxSession}'`)).length;
// The stub records its client's pid when it attaches; until then the file holds
// the previous (dead) client's, so wait for a live one before dropping it.
await until(() => alive(tmuxClientPid(d.tmuxSession)), 5000);
process.kill(tmuxClientPid(d.tmuxSession)); // the connection drops
await sleep(1200);
[s, rec] = await call("POST", `/api/sessions/${re.sessionId}/reattach`);
check("reattach of a re-adopted terminal is accepted", s === 200 && !!rec.session, JSON.stringify([s, rec]));
await sleep(1200);
const log = sshLog();
check("...it attached to the original tmux name",
  log.filter((l) => l.includes(`tmux attach -t '${d.tmuxSession}'`)).length > attachesBefore);
check("...and started no new tmux session", tmuxSessions().filter((n) => n.startsWith("cv-")).join() === before.join(), tmuxSessions().join());
check("...and the tmux name is unchanged", (await listSessions()).find((x) => x.sessionId === re.sessionId)?.tmuxSession === d.tmuxSession);

await resetRig();
report();
