// Talking to the rig server. run-api.mjs starts it and passes its address in,
// so nothing here hardcodes a port, a token or a state path.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";

export const base = process.env.CV_TEST_BASE;
export const token = process.env.CV_TEST_TOKEN;
export const stateDir = process.env.CV_TEST_STATE;
export const viewsFile = stateDir ? join(stateDir, "views.json") : undefined;
/** The copy of the rig this run uses: the state dir sits inside it. */
export const rigDir = stateDir ? dirname(stateDir) : undefined;
const tmuxDir = rigDir ? join(rigDir, "tmux") : undefined;

if (!base || !token) {
  console.error("these tests need the rig: run `npm run test:api`, not this file directly.");
  process.exit(2);
}

/**
 * One request. Returns `[status, body]` — an error response is a result to
 * assert on, not an exception. `raw` sends bytes as-is (malformed JSON), and
 * `auth: false` omits the token.
 */
export async function call(method, path, body, { auth = true, raw } = {}) {
  const headers = {};
  if (auth) headers.Authorization = `Bearer ${token}`;
  let payload;
  if (raw !== undefined) {
    payload = raw;
    headers["Content-Type"] = "application/json";
  } else if (body !== undefined) {
    payload = JSON.stringify(body);
    headers["Content-Type"] = "application/json";
  }
  const res = await fetch(base + path, { method, headers, body: payload });
  const text = await res.text();
  let parsed = {};
  try {
    parsed = text ? JSON.parse(text) : {};
  } catch {
    parsed = { raw: text };
  }
  return [res.status, parsed];
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Poll until `test()` is truthy, or give up after `ms`. Returns the last value. */
export async function until(test, ms = 15000, every = 100) {
  const end = Date.now() + ms;
  let v;
  while (Date.now() < end) {
    v = await test();
    if (v) return v;
    await sleep(every);
  }
  return v;
}

/** Names of the stub tmux's sessions: a session is a file in the rig. */
export const tmuxSessions = () => (existsSync(tmuxDir) ? readdirSync(tmuxDir).sort() : []);
export const tmuxClientPid = (name) => Number(readFileSync(join(tmuxDir, name), "utf8").trim());
/** Is this process running? Signal 0 checks without signalling. */
export const alive = (pid) => {
  try { process.kill(pid, 0); return true; } catch { return false; }
};

/** Every ssh command the server ran, in order (the stub logs them). */
export const sshLog = () => {
  const f = join(rigDir, "ssh.log");
  return existsSync(f) ? readFileSync(f, "utf8").split("\n").filter(Boolean) : [];
};

/** The sessions the viewer holds right now. */
export const listSessions = async () => (await call("GET", "/api/sessions"))[1].sessions ?? [];

/** Create a terminal; returns its SessionInfo. */
export async function createSession(host, cwd = "/tmp", extra = {}) {
  const [status, body] = await call("POST", "/api/sessions", { host, cwd, ...extra });
  if (!body.session) throw new Error(`could not create a ${host} session: ${status} ${JSON.stringify(body)}`);
  return body.session;
}

/** Remove every session and every stub tmux session, so the next file starts clean. */
export async function resetRig() {
  for (const s of await listSessions()) await call("DELETE", `/api/sessions/${s.sessionId}`);
  for (const name of tmuxSessions()) {
    try { process.kill(tmuxClientPid(name)); } catch { /* already gone */ }
    try { (await import("node:fs")).rmSync(join(tmuxDir, name), { force: true }); } catch { /* gone */ }
  }
}
