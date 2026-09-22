import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { RemoteConfig } from "../config.ts";

const execFileAsync = promisify(execFile);

/**
 * Options for a short, non-interactive ssh to a remote host.
 *
 * Shares that host's ControlMaster socket with its terminal spawns, so a command
 * costs about one round trip. BatchMode means an expired key fails at once
 * rather than hanging on a password prompt nobody can see.
 *
 * Every caller must use this rather than assembling the list again: four copies
 * had drifted apart before, and a flag added to one was missing from the rest.
 */
export function sshArgs(remote: RemoteConfig, connectTimeoutS = 6): string[] {
  const args = [
    "-o", "BatchMode=yes",
    "-o", `ConnectTimeout=${connectTimeoutS}`,
    "-o", "ControlMaster=auto",
    "-o", `ControlPath=${remote.controlPath}`,
    "-o", "ControlPersist=10m",
  ];
  if (remote.keyPath) args.push("-i", remote.keyPath, "-o", "IdentitiesOnly=yes");
  return args;
}

/** Single-quote for a POSIX remote shell. */
export function shellQuote(s: string): string {
  return `'${s.replaceAll("'", `'\\''`)}'`;
}

export interface RemoteResult {
  ok: boolean;
  /** Combined stdout and stderr of the remote command. */
  output: string;
  /** True when ssh itself failed (host down, auth), not the remote command. */
  transport: boolean;
}

/**
 * Run one command on a remote host. Never throws: a caller has to tell "the box
 * is unreachable" apart from "the command said no", and an exception hides
 * which.
 */
export async function runRemote(
  remote: RemoteConfig,
  command: string,
  timeoutMs = 15_000,
): Promise<RemoteResult> {
  try {
    const { stdout, stderr } = await execFileAsync(
      "ssh",
      [...sshArgs(remote), remote.sshTarget, command],
      { timeout: timeoutMs },
    );
    return { ok: true, output: `${stdout}${stderr}`.trim(), transport: false };
  } catch (err) {
    const e = err as {
      // A number is the process's exit status; a string is a spawn error.
      code?: number | string;
      stdout?: string;
      stderr?: string;
      killed?: boolean;
      message: string;
    };
    // ssh exits 255 for its own failures; anything else is the remote command's.
    const transport = e.code === 255 || e.killed === true || e.code === "ENOENT";
    return {
      ok: false,
      output: `${e.stdout ?? ""}${e.stderr ?? ""}`.trim() || e.message,
      transport,
    };
  }
}
