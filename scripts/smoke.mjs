#!/usr/bin/env node
// End-to-end smoke test for M1: auth, pty round-trip, resize, Origin rejection.
// Usage: node scripts/smoke.mjs <token> [baseUrl]
import WebSocket from "ws";

const token = process.argv[2];
const base = process.argv[3] ?? "http://127.0.0.1:8788";
if (!token) {
  console.error("usage: node scripts/smoke.mjs <token> [baseUrl]");
  process.exit(2);
}
const wsBase = base.replace(/^http/, "ws");
const results = [];
const check = (name, pass, detail = "") =>
  results.push({ name, pass, detail });

const auth = { Authorization: `Bearer ${token}` };

const status = async (path, headers) =>
  (await fetch(base + path, { headers })).status;

check("GET /api/sessions without token is 401", (await status("/api/sessions")) === 401);
check(
  "GET /api/sessions with bad token is 401",
  (await status("/api/sessions", { Authorization: "Bearer nope" })) === 401,
);
check("GET /api/sessions with token is 200", (await status("/api/sessions", auth)) === 200);

const created = await fetch(base + "/api/sessions", {
  method: "POST",
  headers: { ...auth, "Content-Type": "application/json" },
  body: JSON.stringify({ cwd: "/tmp", cols: 90, rows: 25 }),
}).then((r) => r.json());
const id = created.session.sessionId;
check("POST /api/sessions returns a uuid", /^[0-9a-f-]{36}$/.test(id), id);

// A WS upgrade is not subject to CORS, so a foreign Origin must be refused.
await new Promise((resolve) => {
  const bad = new WebSocket(`${wsBase}/ws/term/${id}?token=${token}`, {
    origin: "http://evil.com",
  });
  bad.on("error", (e) => {
    check("WS from foreign Origin is refused", /403/.test(e.message), e.message);
    resolve();
  });
  bad.on("open", () => {
    check("WS from foreign Origin is refused", false, "it connected");
    bad.close();
    resolve();
  });
});

await new Promise((resolve) => {
  const bad = new WebSocket(`${wsBase}/ws/term/${id}?token=wrong`, {
    origin: base,
  });
  bad.on("error", (e) => {
    check("WS with bad token is refused", /401/.test(e.message), e.message);
    resolve();
  });
  bad.on("open", () => {
    check("WS with bad token is refused", false, "it connected");
    bad.close();
    resolve();
  });
});

// Wait for output rather than sleeping, so a slow shell start cannot fail the
// run and a fast one finishes in about a second.
//
// One thing waiting cannot fix: a session has ONE live viewer. A browser tab
// open on this server polls, adopts the terminal this test just created and
// attaches its own socket, which silently takes the output away from this one.
// Run it against a server with no tab open (a scratch instance is ideal).
const out = await new Promise((resolve) => {
  const ws = new WebSocket(`${wsBase}/ws/term/${id}?token=${token}`, {
    origin: base,
  });
  let text = "";
  let hello;
  const send = (type, payload) =>
    ws.send(Buffer.concat([Buffer.from([type]), Buffer.from(payload ?? "")]));
  const until = async (test, ms = 8000) => {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      if (test(text)) return true;
      await new Promise((r) => setTimeout(r, 50));
    }
    return false;
  };

  ws.on("message", (buf) => {
    const type = buf[0];
    const payload = buf.subarray(1);
    if (type === 2) hello = JSON.parse(payload.toString());
    if (type === 0) text += payload.toString();
  });
  ws.on("error", () => resolve({ text, hello }));
  ws.on("open", async () => {
    // The shell is ready once it has printed anything (its prompt).
    await until((t) => t.length > 0);
    send(0, "echo MARKER_$((21*2)); tput colors; stty size\r");
    await until((t) => /MARKER_42/.test(t) && /25 90/.test(t));
    // The echoed command line contains "40 120" nowhere, so this only matches
    // the new size once stty reports it.
    send(1, JSON.stringify({ cols: 120, rows: 40 }));
    send(0, "stty size\r");
    await until((t) => /40 120/.test(t));
    ws.close();
    resolve({ text, hello });
  });
});

if (!/MARKER_42/.test(out.text)) {
  console.error(
    "\nNo shell output arrived. If a browser tab is open on this server it has " +
      "probably taken over the terminal (one viewer per session): close it, or " +
      "run against a scratch instance, then retry.\n",
  );
}

check("HELLO carries the session info", out.hello?.cols === 90, JSON.stringify(out.hello));
check("shell ran a command", out.text.includes("MARKER_42"));
check("pty reports 256 colours", /(^|\s)256(\s|$)/m.test(out.text));
check("pty started at 25x90", /25 90/.test(out.text));
check("resize took effect (40x120)", /40 120/.test(out.text));

await fetch(`${base}/api/sessions/${id}`, { method: "DELETE", headers: auth });

let failed = 0;
for (const r of results) {
  if (!r.pass) failed++;
  console.log(`${r.pass ? "PASS" : "FAIL"}  ${r.name}${r.detail && !r.pass ? `  [${r.detail}]` : ""}`);
}
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
