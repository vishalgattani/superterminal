// Shared bits for the tests under this folder.
//
// Each test file is run in its own process by run.mjs, because the store is a
// module-level singleton: two test files sharing one process would share one
// store, and the order they ran in would decide whether they passed.
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

/** Repo root, so tests import the real sources wherever the repo is checked out. */
export const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

export const src = (path) => resolve(repoRoot, "apps/web/src", path);

/**
 * The store reads the token out of the URL and talks to the server on import.
 * Give it a browser to find. `fetch` returns `json` for every request; pass a
 * recording one when a test needs to see what was sent.
 */
export function stubBrowser({ fetch, json = {} } = {}) {
  globalThis.location = { search: "?token=t" };
  globalThis.fetch = fetch ?? (async () => ({ ok: true, json: async () => json }));
}

let pass = 0;
let fail = 0;

/** Record one assertion. `detail` is printed only when it fails. */
export const check = (name, ok, detail = "") => {
  ok ? pass++ : fail++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${!ok && detail ? `  [${detail}]` : ""}`);
};

/** Print the tally and exit non-zero if anything failed. */
export const report = () => {
  console.log(`${pass}/${pass + fail} passed`);
  process.exit(fail ? 1 : 0);
};
