// GET /api/search: a string printed in one terminal is found from anywhere (#17).
import { check, report } from "./harness.mjs";
import { call, until } from "./api-helper.mjs";

const [, ra] = await call("POST", "/api/sessions", { host: "local", cwd: "/tmp", alias: "a" });
const [, rb] = await call("POST", "/api/sessions", { host: "local", cwd: "/tmp", alias: "b" });
const a = ra.session.sessionId, b = rb.session.sessionId;
await call("POST", "/api/links", { source: a, target: b });
// Split so the typed command line itself does not contain the marker the
// shell prints back.
await call("POST", `/api/sessions/${b}/input`, { from: a, text: "echo PALETTE_$((40+2))_MARKER", submit: true });

const hits = await until(async () => {
  const [, r] = await call("GET", "/api/search?q=palette_42");
  return r.hits?.length ? r.hits : null;
}, 10000, 300);
check("output from terminal b is found", hits?.some((h) => h.sessionId === b && h.text.includes("PALETTE_42_MARKER")), JSON.stringify(hits));
check("...and not attributed to terminal a", !hits?.some((h) => h.sessionId === a));
let [s, r] = await call("GET", "/api/search?q=palette_42", undefined, { auth: false });
check("search needs the token", s === 401, s);

await call("DELETE", `/api/sessions/${b}`);
[, r] = await call("GET", "/api/search?q=palette_42");
check("a closed terminal's output is no longer a result", (r.hits ?? []).length === 0, JSON.stringify(r));
await call("DELETE", `/api/sessions/${a}`);

report();
