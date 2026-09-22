#!/usr/bin/env node
// node-pty 1.1.0 ships its prebuilt `spawn-helper` without the executable bit on
// macOS. Without this, every pty spawn fails with "posix_spawnp failed".
// Verified on this machine: chmod +x is the whole fix, no rebuild needed.
// Runs on postinstall so a fresh `npm install` is enough to get a working pty.
import { chmodSync, existsSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

const require = createRequire(import.meta.url);

let ptyRoot;
try {
  ptyRoot = dirname(require.resolve("node-pty/package.json"));
} catch {
  // node-pty not installed yet (e.g. a bare clone). Nothing to fix.
  process.exit(0);
}

const targets = ["darwin-arm64", "darwin-x64"]
  .map((p) => join(ptyRoot, "prebuilds", p, "spawn-helper"))
  .filter((p) => existsSync(p));

let fixed = 0;
for (const helper of targets) {
  const mode = statSync(helper).mode;
  if ((mode & 0o111) === 0) {
    chmodSync(helper, 0o755);
    fixed++;
    console.log(`[cv] made node-pty spawn-helper executable: ${helper}`);
  }
}

if (targets.length === 0) {
  console.log("[cv] no macOS node-pty spawn-helper found, nothing to fix");
} else if (fixed === 0) {
  console.log("[cv] node-pty spawn-helper already executable");
}
