// Declaring a remote host from the UI, not only config.env: the shared
// defaulting (buildRemote), the id rule (validateHostId), and the store that
// persists what was added (HostsStore).
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { check, report, repoRoot } from "./harness.mjs";

process.env.CV_CONFIG = "/nonexistent/config.env";
process.env.CV_STATE_DIR = mkdtempSync(join(tmpdir(), "cv-hosts-"));

const { buildRemote, validateHostId } = await import(`${repoRoot}/apps/server/src/config.ts`);
const { HostsStore } = await import(`${repoRoot}/apps/server/src/hostsStore.ts`);

// ---- buildRemote: the same defaults a config.env slot gets, from anywhere
let r = buildRemote({ id: "gpu", sshTarget: "me@gpu.internal" });
check("a bare id and target is enough", r.id === "gpu" && r.sshTarget === "me@gpu.internal");
check("claudePath defaults, like a config.env slot with none", r.claudePath === "$HOME/.local/bin/claude", r.claudePath);
check("controlPath is minted per host", r.controlPath.includes("cv-gpu-"), r.controlPath);
check("forwardX11 defaults false", r.forwardX11 === false);

r = buildRemote({ id: "gpu", sshTarget: "me@gpu.internal", keyPath: "~/.ssh/gpu_key" });
check("~ in a key path is expanded", !r.keyPath.startsWith("~"), r.keyPath);

r = buildRemote({ id: "gpu", sshTarget: "me@gpu.internal", claudePath: "/opt/claude" });
check("an explicit claudePath is kept, not defaulted", r.claudePath === "/opt/claude");

// ---- validateHostId: the rule an added host and a config.env slot share
check("a plain id is fine", validateHostId("gpu-box", []) === null);
check("local is reserved", /reserved/.test(validateHostId("local", []) ?? ""));
check("empty is refused", validateHostId("", []) !== null);
check("a duplicate is refused", validateHostId("fire", ["fire"]) !== null);
check("a space is refused (it would break a tmux session name)", validateHostId("my box", []) !== null);
check("a slash is refused (it would break a ControlMaster path)", validateHostId("a/b", []) !== null);
check("starting with - or _ is refused", validateHostId("-x", []) !== null && validateHostId("_x", []) !== null);
check("33 characters is refused", validateHostId("a".repeat(33), []) !== null);
check("32 characters is fine", validateHostId("a".repeat(32), []) === null);
check("- and _ inside are fine", validateHostId("gpu-box_2", []) === null);

// ---- HostsStore: add, list, remove, and that it actually persists
let store = new HostsStore();
check("nothing added yet", store.list().length === 0);

const added = store.add({ id: "gpu", sshTarget: "me@gpu.internal" }, ["local"]);
check("add returns the built remote", added.id === "gpu" && added.claudePath.includes("claude"));
check("...and list sees it", store.list().length === 1 && store.list()[0].id === "gpu");

try {
  store.add({ id: "gpu", sshTarget: "me@other" }, ["local", "gpu"]);
  check("adding a duplicate id throws", false);
} catch (e) {
  check("adding a duplicate id throws", /already in use/.test(e.message), e.message);
}

try {
  store.add({ id: "x", sshTarget: "" }, ["local"]);
  check("an empty SSH target throws", false);
} catch (e) {
  check("an empty SSH target throws", /SSH target/.test(e.message), e.message);
}

check("removing an unknown id returns false, not an error", store.remove("nope") === false);
check("removing a known id returns true", store.remove("gpu") === true);
check("...and it is gone from list()", store.list().length === 0);

// A fresh instance reads the same file: this is what makes it survive a restart.
store = new HostsStore();
store.add({ id: "again", sshTarget: "me@again" }, ["local"]);
const reopened = new HostsStore();
check("a second HostsStore instance sees what the first wrote", reopened.list().some((r) => r.id === "again"));

report();
