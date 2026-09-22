// The model a session runs with: resolved by the host, recorded on the plan,
// and shortened for the node. "Is this actually sonnet?" must be answerable
// from what was launched, not from what was asked for.
import { check, report, src, repoRoot } from "./harness.mjs";

const { SshHost } = await import(`${repoRoot}/apps/server/src/hosts/ssh.ts`);
const { shortModel, modelLabel } = await import(src("lib/model.ts"));

const cfg = (extra = {}) => ({
  id: "fire",
  sshTarget: "me@box",
  claudePath: "/home/me/.local/bin/claude",
  controlPath: "/tmp/cp",
  forwardX11: false,
  ...extra,
});
const req = (extra = {}) => ({
  sessionId: "abcd1234-ef56-7890-abcd-ef1234567890",
  cwd: "/home/me/vault",
  cols: 80,
  rows: 24,
  ...extra,
});
const remote = (plan) => plan.args[plan.args.length - 1];

// ---- the host default is what makes "everything on this box is sonnet" true
let p = new SshHost(cfg({ claudeModel: "claude-sonnet-5" })).plan(req({ startClaude: true }));
check("the host default reaches the command line", remote(p).includes("--model claude-sonnet-5"), remote(p));
check("...and is recorded on the plan", p.model === "claude-sonnet-5", p.model);
check("...and is visible in the shell description", p.shell.includes("--model claude-sonnet-5"), p.shell);

// ---- a spawn may override it
p = new SshHost(cfg({ claudeModel: "claude-sonnet-5" })).plan(req({ startClaude: true, model: "claude-opus-5" }));
check("a per-spawn model wins over the host default", remote(p).includes("--model claude-opus-5"), remote(p));
check("...and that is what gets recorded", p.model === "claude-opus-5", p.model);

// ---- no model configured means we must not claim one
p = new SshHost(cfg()).plan(req({ startClaude: true }));
check("no model asked for means no --model flag", !remote(p).includes("--model"), remote(p));
check("...and nothing is recorded, rather than a guess", p.model === undefined, String(p.model));

// ---- resume carries the model too: resuming must not silently change it
p = new SshHost(cfg({ claudeModel: "claude-sonnet-5" })).plan(req({ resume: "11111111-2222-3333-4444-555555555555" }));
check("resuming also passes the model", remote(p).includes("--model claude-sonnet-5"), remote(p));

// ---- a model name reaches a remote shell
const nasty = new SshHost(cfg({ claudeModel: "sonnet; rm -rf ~" })).plan(req({ startClaude: true }));
check("shell metacharacters are stripped from a model name", !remote(nasty).includes("rm -rf"), remote(nasty));
check("...leaving only a safe name", nasty.model === "sonnetrm-rf", nasty.model);
const empty = new SshHost(cfg({ claudeModel: "!!!" })).plan(req({ startClaude: true }));
check("a name with nothing safe left becomes no model at all", empty.model === undefined && !remote(empty).includes("--model"), String(empty.model));

// ---- attaching to someone else's tmux session must not claim a model
p = new SshHost(cfg({ claudeModel: "claude-sonnet-5" })).plan(req({ attachTmux: "cv-deadbeef" }));
check("attaching to an existing session adds no --model", !remote(p).includes("--model"), remote(p));

// ---- the pill
check("the vendor prefix is dropped for display", shortModel("claude-sonnet-5") === "sonnet-5", shortModel("claude-sonnet-5"));
check("a dated model drops its date", shortModel("claude-haiku-4-5-20251001") === "haiku-4-5", shortModel("claude-haiku-4-5-20251001"));
check("an unprefixed name is left alone", shortModel("sonnet-5") === "sonnet-5", shortModel("sonnet-5"));

// ---- when the pill shows: only while a Claude is running in the terminal
check("a running Claude shows its model, shortened",
  modelLabel("claude-sonnet-5", "bc9989c2-0000") === "sonnet-5", String(modelLabel("claude-sonnet-5", "bc9989c2-0000")));
check("a terminal with no Claude running shows no pill, whatever it was started with",
  modelLabel("claude-sonnet-5", undefined) === undefined, String(modelLabel("claude-sonnet-5", undefined)));
check("an empty Claude session id is not a running Claude",
  modelLabel("claude-sonnet-5", "") === undefined);
check("a running Claude with no recorded model shows no pill (the viewer does not guess)",
  modelLabel(undefined, "bc9989c2-0000") === undefined);
check("neither shows no pill", modelLabel(undefined, undefined) === undefined);

report();
