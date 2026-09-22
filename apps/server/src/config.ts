// Configuration lives in a shell-sourceable KEY=value file, not TOML.
// Why, and what broke when it was TOML:
// docs/adr/0003-config-is-a-shell-sourceable-env-file.md
import { existsSync, readFileSync } from "node:fs";
import { LOCAL_HOST_ID } from "@cv/shared";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = resolve(here, "../../..");
// Both can be redirected, so a second copy of the server (a test rig, a
// scratch instance) neither reads the real config nor writes the real state.
export const CONFIG_PATH = process.env.CV_CONFIG || join(REPO_ROOT, "config.env");
export const STATE_DIR = process.env.CV_STATE_DIR || join(REPO_ROOT, ".state");

export interface RemoteConfig {
  /** Host id, as sessions and presets refer to it. Never "local". */
  id: string;
  /** Shown in the host picker. Defaults to the id. */
  label?: string;
  sshTarget: string;
  keyPath?: string;
  instanceId?: string;
  apiBase?: string;
  forwardX11: boolean;
  /** Login shell to exec inside tmux on the remote host. */
  loginShell?: string;
  /**
   * Claude model for every session started on this host, unless a spawn asks
   * for another. Lets "everything on this box is sonnet" be a fact about the
   * host rather than something each caller has to remember.
   */
  claudeModel?: string;
  /**
   * Absolute path to `claude` on the remote host. Required because it is not
   * on PATH for a non-interactive shell there (verified: ~/.local/bin/claude),
   * so a bare `claude` over ssh fails silently.
   */
  claudePath: string;
  /** ControlMaster socket path. Defaults per host, so remotes never share one. */
  controlPath: string;
}

/**
 * Kept so existing imports keep working while the fire host is generalised.
 * New code should say RemoteConfig.
 */
export type FireConfig = RemoteConfig;

export interface Config {
  host: string;
  port: number;
  defaultCwd: string;
  defaultShell: string;
  /** Extra loopback ports allowed as an Origin, for the Vite dev proxy. */
  devPorts: number[];
  /** Every configured remote, in the order the config declares them. */
  remotes: RemoteConfig[];
  /**
   * The remote whose id is "fire", when one is configured.
   *
   * A compatibility shim for callers not yet converted to look a host up by id.
   * It is a member of `remotes`, not a separate object, so the two cannot drift.
   */
  fire?: RemoteConfig;
}

/** The configured remote with this id, or undefined. Never matches "local". */
export function remoteById(
  config: Config,
  host: string,
): RemoteConfig | undefined {
  return config.remotes.find((r) => r.id === host);
}

const DEFAULTS: Config = {
  host: "127.0.0.1",
  port: 8788,
  defaultCwd: homedir(),
  defaultShell: process.env.SHELL || "/bin/zsh",
  devPorts: [5173],
  remotes: [],
};

/** Parse KEY=value lines. Supports # comments, blank lines and quoted values. */
export function parseEnvFile(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const rawLine of text.split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim().replace(/^export\s+/, "");
    let value = line.slice(eq + 1).trim();
    // Strip a trailing comment only when the value is unquoted.
    if (!/^["']/.test(value)) value = value.split(/\s+#/)[0]!.trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (key) out[key] = value;
  }
  return out;
}

/**
 * Load config.env into process.env before anything reads it. auth.ts picks up
 * CV_TOKEN at module load, so this has to happen first, which is why
 * index.ts imports config before auth.
 */
export function loadEnvFile(): void {
  if (!existsSync(CONFIG_PATH)) return;
  const env = parseEnvFile(readFileSync(CONFIG_PATH, "utf8"));
  for (const [k, v] of Object.entries(env)) {
    if (process.env[k] === undefined) process.env[k] = v;
  }
}

loadEnvFile();

export function loadConfig(): Config {
  if (!existsSync(CONFIG_PATH)) return { ...DEFAULTS };

  const env = parseEnvFile(readFileSync(CONFIG_PATH, "utf8"));
  const port = Number.parseInt(env.CV_PORT ?? "", 10);
  const remotes = parseRemotes(env);

  return {
    host: env.CV_HOST || DEFAULTS.host,
    port: Number.isFinite(port) && port > 0 ? port : DEFAULTS.port,
    defaultCwd: expandHome(env.CV_DEFAULT_CWD) ?? DEFAULTS.defaultCwd,
    defaultShell: expandHome(env.CV_DEFAULT_SHELL) ?? DEFAULTS.defaultShell,
    devPorts: env.CV_DEV_PORTS
      ? env.CV_DEV_PORTS.split(",")
          .map((x) => Number.parseInt(x.trim(), 10))
          .filter((n) => Number.isFinite(n) && n > 0)
      : DEFAULTS.devPorts,
    remotes,
    fire: remotes.find((r) => r.id === "fire"),
  };
}

/**
 * Read every configured remote.
 *
 * Two spellings. Numbered keys declare any number of hosts:
 *
 *   CV_HOST_1_ID=fire
 *   CV_HOST_1_SSH_TARGET=ubuntu@10.0.0.1
 *   CV_HOST_2_ID=gpu-box
 *   CV_HOST_2_SSH_TARGET=vishal@gpu.internal
 *
 * The older CV_FIRE_* keys still work and mean a host whose id is "fire", so an
 * existing config.env keeps running untouched. An explicit CV_HOST_n_ID=fire
 * wins over them, so there is never a second, conflicting "fire".
 */
function parseRemotes(env: Record<string, string>): RemoteConfig[] {
  const out: RemoteConfig[] = [];

  // Whatever appears between CV_HOST_ and _ID: usually 1, 2, 3, but any token
  // works, so hosts can be named in the file itself (CV_HOST_GPU_ID=gpu-box).
  //
  // No underscore in the slot, deliberately. A greedy match here reads
  // CV_HOST_1_INSTANCE_ID as the slot "1_INSTANCE" and invents a host that was
  // never configured.
  const slots = Object.keys(env)
    .map((k) => /^CV_HOST_([A-Za-z0-9]+)_ID$/.exec(k)?.[1])
    .filter((x): x is string => !!x)
    .sort();

  // A slot with a target but no id declares nothing, and the loop below is
  // driven by _ID keys, so it would vanish without a word.
  for (const key of Object.keys(env)) {
    const orphan = /^CV_HOST_([A-Za-z0-9]+)_SSH_TARGET$/.exec(key)?.[1];
    if (orphan && !slots.includes(orphan)) {
      console.warn(`[cv] ignoring ${key}: no CV_HOST_${orphan}_ID`);
    }
  }

  for (const slot of slots) {
    const at = (suffix: string) => env[`CV_HOST_${slot}_${suffix}`];
    const id = at("ID")?.trim();
    const sshTarget = at("SSH_TARGET");
    // A host with no target cannot be connected to. Skipping it quietly would
    // make it vanish from the picker with no explanation, so say so.
    if (!id || !sshTarget) {
      console.warn(
        `[cv] ignoring CV_HOST_${slot}: ${!id ? "no _ID" : "no _SSH_TARGET"}`,
      );
      continue;
    }
    if (id === LOCAL_HOST_ID) {
      console.warn(`[cv] ignoring CV_HOST_${slot}: "${LOCAL_HOST_ID}" is reserved`);
      continue;
    }
    if (out.some((r) => r.id === id)) {
      console.warn(`[cv] ignoring CV_HOST_${slot}: duplicate host id "${id}"`);
      continue;
    }
    out.push(
      buildRemote({
        id,
        label: at("LABEL"),
        sshTarget,
        keyPath: at("KEY_PATH"),
        instanceId: at("INSTANCE_ID"),
        apiBase: at("API_BASE"),
        forwardX11: at("FORWARD_X11") === "1",
        claudePath: at("CLAUDE_PATH"),
        claudeModel: at("CLAUDE_MODEL"),
        loginShell: at("LOGIN_SHELL"),
        controlPath: at("CONTROL_PATH"),
      }),
    );
  }

  if (env.CV_FIRE_SSH_TARGET && !out.some((r) => r.id === "fire")) {
    out.push(
      buildRemote({
        id: "fire",
        label: env.CV_FIRE_LABEL,
        sshTarget: env.CV_FIRE_SSH_TARGET,
        keyPath: env.CV_FIRE_KEY_PATH,
        instanceId: env.CV_FIRE_INSTANCE_ID,
        apiBase: env.CV_FIRE_API_BASE,
        forwardX11: env.CV_FIRE_FORWARD_X11 === "1",
        claudePath: env.CV_FIRE_CLAUDE_PATH,
        claudeModel: env.CV_FIRE_CLAUDE_MODEL,
        loginShell: env.CV_FIRE_LOGIN_SHELL,
        controlPath: env.CV_FIRE_CONTROL_PATH,
      }),
    );
  }

  return out;
}

const DEFAULT_CLAUDE_PATH = "$HOME/.local/bin/claude";

/**
 * Raw fields for one remote, before the defaults that turn them into a
 * `RemoteConfig`. What a config.env slot supplies, and what the in-app "add a
 * host" form (`hostsStore.ts`) supplies too, so the two ways of declaring a
 * host cannot drift apart on what a blank field defaults to.
 */
export interface RemoteInput {
  id: string;
  label?: string;
  sshTarget: string;
  keyPath?: string;
  instanceId?: string;
  apiBase?: string;
  forwardX11?: boolean;
  claudePath?: string;
  claudeModel?: string;
  loginShell?: string;
  controlPath?: string;
}

/** Apply the same defaults a config.env slot gets, to fields from anywhere. */
export function buildRemote(input: RemoteInput): RemoteConfig {
  return {
    id: input.id,
    label: input.label,
    sshTarget: input.sshTarget,
    keyPath: expandHome(input.keyPath),
    instanceId: input.instanceId,
    apiBase: input.apiBase,
    forwardX11: input.forwardX11 ?? false,
    claudePath: input.claudePath || DEFAULT_CLAUDE_PATH,
    claudeModel: input.claudeModel,
    loginShell: input.loginShell,
    controlPath: expandHome(input.controlPath) ?? defaultControlPath(input.id),
  };
}

/**
 * Is this a usable, non-conflicting host id? Shared by config.env parsing and
 * the in-app "add a host" route, so the same name is refused everywhere or
 * accepted everywhere.
 *
 * Restricted to what is safe inside a tmux session name and a ControlMaster
 * socket path (both built from the id elsewhere) rather than escaped: an id a
 * shell or tmux would treat specially is more likely a typo than intent.
 */
export function validateHostId(id: string, existing: string[]): string | null {
  if (!id) return "an id is required";
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,31}$/.test(id)) {
    return "id must be 1-32 characters: letters, digits, - or _, not starting with one";
  }
  if (id === LOCAL_HOST_ID) return `"${LOCAL_HOST_ID}" is reserved`;
  if (existing.includes(id)) return `"${id}" is already in use`;
  return null;
}

/**
 * One ControlMaster socket per host. Sharing a path between two remotes would
 * multiplex the second onto the first's connection, silently sending its
 * commands to the wrong box.
 */
function defaultControlPath(id: string): string {
  return join(homedir(), ".ssh", `cv-${id}-%r@%h:%p`);
}

function expandHome(p: string | undefined): string | undefined {
  if (!p) return undefined;
  return p.startsWith("~") ? join(homedir(), p.slice(1)) : p;
}
