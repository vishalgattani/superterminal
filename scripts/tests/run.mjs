#!/usr/bin/env node
// Runs every *.test.mjs in this folder, each in its own process, and exits
// non-zero if any of them fails.
//
//   npm test                 # all of them
//   npm test -- views        # only files whose name contains "views"
//
// These are unit tests over apps/web/src: they import the real modules and
// need no server, no fire host and no network. For the end-to-end path see
// scripts/smoke.mjs, which does need a running server.
import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));

// The tests import .ts sources directly. Node strips the types itself from
// 22.18 (and 23.6); older 22.x can do it behind a flag.
const [major, minor] = process.versions.node.split(".").map(Number);
const stripsTypes = major > 23 || (major === 23 && minor >= 6) || (major === 22 && minor >= 18);
const needsFlag = !stripsTypes && major === 22 && minor >= 6;
if (!stripsTypes && !needsFlag) {
  console.error(`node ${process.versions.node} cannot import .ts sources; these tests need node >= 22.6 (22.18+ without a flag).`);
  process.exit(2);
}
const flags = needsFlag ? ["--experimental-strip-types"] : [];

const filter = process.argv[2];
const files = readdirSync(here)
  .filter((f) => f.endsWith(".test.mjs"))
  .filter((f) => !filter || f.includes(filter))
  .sort();

if (files.length === 0) {
  console.error(filter ? `no test files match "${filter}"` : "no test files found");
  process.exit(2);
}

const failed = [];
for (const file of files) {
  console.log(`\n=== ${file}`);
  const run = spawnSync(process.execPath, [...flags, join(here, file)], { stdio: "inherit" });
  if (run.status !== 0) failed.push(file);
}

console.log("");
if (failed.length) {
  console.log(`FAILED: ${failed.join(", ")}`);
  process.exit(1);
}
console.log(`ok: ${files.length} test ${files.length === 1 ? "file" : "files"} passed`);
