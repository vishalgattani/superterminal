// PUT/GET /api/views: what the server accepts, what it refuses, and what it
// does with a damaged file. The saved document is the only copy of a layout,
// so a bad write must not land and a bad file must not read as an error.
import { writeFileSync } from "node:fs";
import { check, report } from "./harness.mjs";
import { call, viewsFile } from "./api-helper.mjs";

const good = {
  version: 1,
  activeTab: "t1",
  showFolders: true,
  showForeign: true,
  treeFlow: "LR",
  positions: { k: { x: 1, y: 2 } },
  tabs: [
    { id: "default", name: "main", positions: {} },
    { id: "t1", name: "work", members: ["cv-abc"], positions: { "cv-abc": { x: 5, y: 6 } } },
  ],
};

let [s, r] = await call("GET", "/api/views");
check("no saved views yet gives null", s === 200 && r.views === null, JSON.stringify([s, r]));

const [noTokenGet] = await call("GET", "/api/views", undefined, { auth: false });
const [noTokenPut] = await call("PUT", "/api/views", good, { auth: false });
check("no token is 401", noTokenGet === 401 && noTokenPut === 401, `${noTokenGet}/${noTokenPut}`);

[s, r] = await call("PUT", "/api/views", good);
check("a valid document is accepted", s === 200 && r.ok === true, JSON.stringify([s, r]));
[s, r] = await call("GET", "/api/views");
check("...and read back exactly", JSON.stringify(r.views) === JSON.stringify(good), JSON.stringify(r));

const { readFileSync, existsSync } = await import("node:fs");
check("...and written to disk", existsSync(viewsFile) && JSON.stringify(JSON.parse(readFileSync(viewsFile, "utf8"))) === JSON.stringify(good));
check("no temp file left behind", !existsSync(`${viewsFile}.tmp`));

const rejects = [
  ["an array", [1]],
  ["no version", { tabs: [{ id: "a", name: "b" }] }],
  ["wrong version", { ...good, version: 2 }],
  ["no tabs", { version: 1 }],
  ["tabs not a list", { version: 1, tabs: "x" }],
  ["empty tabs", { version: 1, tabs: [] }],
  ["a tab without a name", { version: 1, tabs: [{ id: "a" }] }],
  ["a null tab", { version: 1, tabs: [null] }],
  ["101 tabs", { version: 1, tabs: Array.from({ length: 101 }, (_, i) => ({ id: String(i), name: "n" })) }],
];
for (const [name, body] of rejects) {
  const [status, res] = await call("PUT", "/api/views", body);
  check(`rejected: ${name}`, status === 400 && "error" in res, JSON.stringify([status, res]).slice(0, 120));
}

[s, r] = await call("PUT", "/api/views", { version: 1, tabs: [{ id: "a", name: "n", pad: "x".repeat(600 * 1024) }] });
check("rejected: over 512 KB, with a clear reason", s === 400 && (r.error ?? "").includes("too large"), `${s} ${String(r.error).slice(0, 80)}`);

let refused;
try {
  const [status] = await call("PUT", "/api/views", { version: 1, tabs: [{ id: "a", name: "n", pad: "x".repeat(2 * 1024 * 1024) }] });
  refused = status >= 400;
} catch {
  refused = true; // the framework drops the connection
}
check("rejected: over the framework's body limit too", refused);

[s, r] = await call("PUT", "/api/views", undefined, { raw: "{not json" });
check("rejected: malformed JSON", s === 400, JSON.stringify([s, r]).slice(0, 120));

[s, r] = await call("GET", "/api/views");
check("every rejected write left the good document untouched", JSON.stringify(r.views) === JSON.stringify(good));

// a damaged file on disk reads as none, not an error
writeFileSync(viewsFile, "{truncated");
[s, r] = await call("GET", "/api/views");
check("a damaged file reads as no saved views", s === 200 && r.views === null, JSON.stringify([s, r]));
await call("PUT", "/api/views", good);

const [st, status] = await call("GET", "/api/status");
check("status reports the boot flag", st === 200 && "booted" in status, Object.keys(status).join());
check("...and it is true once boot re-adoption has finished", status.booted === true, String(status.booted)); // run-api.mjs waits for this before starting any test file

report();
