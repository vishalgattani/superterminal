#!/usr/bin/env node
// Boots a throwaway server against the stub rig, runs every *.api.mjs in
// scripts/tests/, and tears the server down again.
//
//   npm run test:api
//
// Unlike `npm test`, this starts a process and binds a port — but it still
// touches nothing real: no fire box, no ssh, no EC2, and its state goes to a
// temp directory, never the repo's .state/. See rig/README.md.
import { spawn, spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..", "..");

/** A port the OS just told us is free, rather than a constant two rigs fight over. */
const freePort = () =>
  new Promise((resolve, reject) => {
    const s = createServer();
    s.on("error", reject);
    s.listen(0, "127.0.0.1", () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
  });

// A copy of the rig, so tests can write into it and the repo stays clean.
const rig = mkdtempSync(join(tmpdir(), "cv-rig-"));
cpSync(join(here, "rig"), rig, { recursive: true });
mkdirSync(join(rig, "state"), { recursive: true });
mkdirSync(join(rig, "tmux"), { recursive: true });

const port = await freePort();
const token = "rigtoken-rigtoken-1234"; // >= 16 chars, or auth generates its own
const base = `http://127.0.0.1:${port}`;

writeFileSync(
  join(rig, "config.env"),
  [
    `CV_PORT=${port}`,
    `CV_TOKEN=${token}`,
    "CV_FIRE_SSH_TARGET=rig@fake",
    `CV_FIRE_CONTROL_PATH=${join(rig, "cv-%C")}`,
    `CV_FIRE_CLAUDE_PATH=${join(rig, "bin", "claude-fire")}`,
    "",
  ].join("\n"),
);

// Its own process group: the stub ssh and tmux leave `cat` processes behind
// that hold the server's pipes open, so killing the server alone would leave
// this runner waiting on them forever.
const server = spawn(process.execPath, [join(repoRoot, "apps/server/src/index.ts")], {
  cwd: repoRoot,
  detached: true,
  env: {
    ...process.env,
    PATH: `${join(rig, "bin")}:${process.env.PATH}`,
    CV_CONFIG: join(rig, "config.env"),
    CV_STATE_DIR: join(rig, "state"),
    FAKE_TMUX_DIR: join(rig, "tmux"),
  },
  stdio: ["ignore", "pipe", "pipe"],
});
let serverLog = "";
server.stdout.on("data", (d) => (serverLog += d));
server.stderr.on("data", (d) => (serverLog += d));

let exited = null;
server.on("exit", (code) => (exited = code));

let cleanedUp = false;
const cleanup = () => {
  if (cleanedUp) return;
  cleanedUp = true;
  try {
    process.kill(-server.pid, "SIGKILL"); // the group, not just the server
  } catch (e) {
    if (process.env.CV_RIG_DEBUG) console.error("group kill failed:", e.code, e.message);
  }
  rmSync(rig, { recursive: true, force: true });
};

/**
 * Every exit goes through here. The server's pipes keep this process's event
 * loop alive, so it never falls off the end by itself: without an explicit
 * exit the suite prints its results and then hangs, leaving a rig server
 * running. Ask how this is known.
 */
const finish = (code) => {
  cleanup();
  process.exit(code);
};
process.on("exit", cleanup);
for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => finish(130));

// Wait for it to answer, rather than sleeping a guessed number of seconds.
const deadline = Date.now() + 30_000;
let up = false;
while (Date.now() < deadline && exited === null) {
  try {
    // /api/health is behind the same auth hook as everything else: an
    // unauthenticated probe answers 401, which says listening, not healthy.
    const r = await fetch(`${base}/api/health`, { headers: { Authorization: `Bearer ${token}` } });
    if (r.ok) { up = true; break; }
  } catch {
    // not listening yet
  }
  await new Promise((r) => setTimeout(r, 100));
}
if (!up) {
  console.error(`the rig server never came up on ${base}${exited === null ? "" : ` (it exited ${exited})`}\n`);
  console.error(serverLog.trim() || "(it printed nothing)");
  finish(2);
}

// Listening is not ready. Boot re-adoption starts on a 2.5s timer and can
// reconcile away sessions created before it runs, so a test that spawns one
// early would fail on a schedule rather than on its own logic. The browser
// waits for this flag too.
let booted = false;
while (Date.now() < deadline && exited === null) {
  const [, status] = await (async () => {
    const res = await fetch(`${base}/api/status`, { headers: { Authorization: `Bearer ${token}` } });
    return [res.status, await res.json()];
  })();
  if (status.booted === true) { booted = true; break; }
  await new Promise((r) => setTimeout(r, 100));
}
if (!booted) {
  console.error("the rig server came up but never finished booting");
  console.error(serverLog.trim() || "(it printed nothing)");
  finish(2);
}

const filter = process.argv[2];
const files = readdirSync(here)
  .filter((f) => f.endsWith(".api.mjs"))
  .filter((f) => !filter || f.includes(filter))
  .sort();

if (files.length === 0) {
  console.error(filter ? `no api test files match "${filter}"` : "no api test files found");
  finish(2);
}

const failed = [];
for (const file of files) {
  console.log(`\n=== ${file}`);
  const run = spawnSync(process.execPath, [join(here, file)], {
    stdio: "inherit",
    env: { ...process.env, CV_TEST_BASE: base, CV_TEST_TOKEN: token, CV_TEST_STATE: join(rig, "state") },
  });
  if (run.status !== 0) failed.push(file);
}

console.log("");
if (failed.length) {
  console.log(`FAILED: ${failed.join(", ")}`);
  finish(1);
}
console.log(`ok: ${files.length} api test ${files.length === 1 ? "file" : "files"} passed`);
finish(0);
