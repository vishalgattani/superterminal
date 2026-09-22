// Adding and removing a remote host from the UI, through the real routes.
//
// Self-contained: every host it adds is named so it cannot collide with
// anything another test file uses, and it removes what it added, because the
// rig server (and its .state/hosts.json) is shared by every *.api.mjs file
// in one `npm run test:api` run.
import { check, report } from "./harness.mjs";
import { call, createSession, listSessions, until } from "./api-helper.mjs";

const ID = "hostsapitest";

const hostsOf = async () => (await call("GET", "/api/hosts"))[1].hosts ?? [];
const remotesOf = async () => (await call("GET", "/api/hosts/remotes"))[1].remotes ?? [];
const findHost = (hosts, id) => hosts.find((h) => h.id === id);

// Clean slate, in case an earlier run of this file left something behind.
await call("DELETE", `/api/hosts/remotes/${ID}`);

// ---- add
let [status, body] = await call("POST", "/api/hosts/remotes", {
  id: ID,
  sshTarget: "test@example.invalid",
});
check("adding a host is 200", status === 200, JSON.stringify(body));
check("...and returns the built remote", body.remote?.id === ID, JSON.stringify(body.remote));

let hosts = await hostsOf();
check("it appears in /api/hosts", !!findHost(hosts, ID));
check("...marked remote and available", findHost(hosts, ID)?.remote === true && findHost(hosts, ID)?.available === true);

let remotes = await remotesOf();
check("it appears in /api/hosts/remotes (the manageable list)", remotes.some((r) => r.id === ID));

// ---- it works without a restart: the new host is immediately usable
const s = await createSession(ID, "~");
check("a terminal can be created on the host right after adding it", s.host === ID, JSON.stringify(s));
await call("DELETE", `/api/sessions/${s.sessionId}`);

// ---- rejections
[status, body] = await call("POST", "/api/hosts/remotes", { id: ID, sshTarget: "again@example.invalid" });
check("a duplicate id is refused", status === 400 && /already in use/.test(body.error ?? ""), JSON.stringify(body));

[status, body] = await call("POST", "/api/hosts/remotes", { id: "local", sshTarget: "x@y" });
check("\"local\" is refused", status === 400 && /reserved/.test(body.error ?? ""), JSON.stringify(body));

[status, body] = await call("POST", "/api/hosts/remotes", { id: "no-target" });
check("no sshTarget is refused", status === 400, JSON.stringify(body));

// ---- a config.env host cannot be removed here (this rig's config declares "fire")
[status, body] = await call("DELETE", "/api/hosts/remotes/fire");
check("removing a config.env host is refused, naming why", status === 400 && /config\.env/.test(body.error ?? ""), JSON.stringify(body));
hosts = await hostsOf();
check("...and it is still there", !!findHost(hosts, "fire"));

// ---- a host with an open terminal cannot be removed
const s2 = await createSession(ID, "~");
[status, body] = await call("DELETE", `/api/hosts/remotes/${ID}`);
check("removing a host with an open terminal is refused", status === 400, JSON.stringify(body));
await call("DELETE", `/api/sessions/${s2.sessionId}`);

// ---- remove, once nothing is open on it
[status, body] = await call("DELETE", `/api/hosts/remotes/${ID}`);
check("removing it now is 200", status === 200, JSON.stringify(body));
hosts = await hostsOf();
check("...and it is gone from /api/hosts", !findHost(hosts, ID));
remotes = await remotesOf();
check("...and gone from /api/hosts/remotes", !remotes.some((r) => r.id === ID));

[status, body] = await call("DELETE", `/api/hosts/remotes/${ID}`);
check("removing it again is a no-op error, not a crash", status === 400, JSON.stringify(body));

report();
