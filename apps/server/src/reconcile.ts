import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { RemoteConfig } from "./config.ts";
import type { AppContext } from "./context.ts";
import { sshArgs } from "./remote/ssh.ts";

const execFileAsync = promisify(execFile);

/**
 * Re-adopt tmux sessions this viewer created but lost track of.
 *
 * Remote sessions outlive the viewer by design, so after a restart the work
 * is still running on the box while the canvas is empty. That reads exactly
 * like having lost it. Anything named cv-* is ours, so reattach to it and put
 * the node back; sessions nobody created here are left alone and still show
 * in the Agents panel.
 */
export async function reconcileRemote(ctx: AppContext): Promise<number> {
  const { config, ptys } = ctx;
  // Every remote is reconciled, and one being unreachable must not stop the
  // others: a box off the VPN is a normal condition, not a failure.
  const counts = await Promise.all(
    config.remotes.map((remote) => adoptFrom(ctx, remote)),
  );
  return counts.reduce((a, b) => a + b, 0);
}

async function adoptFrom(ctx: AppContext, remote: RemoteConfig): Promise<number> {
  const { ptys } = ctx;
  const args = sshArgs(remote, 8);
  args.push(
    remote.sshTarget,
    "tmux list-sessions -F '#{session_name}|#{session_path}' 2>/dev/null || true",
  );

  let stdout = "";
  try {
    ({ stdout } = await execFileAsync("ssh", args, { timeout: 20_000 }));
  } catch {
    return 0; // instance down or off VPN: nothing to reconcile, not an error
  }

  // tmux names are only unique per host, so two remotes can each have a
  // cv-1a2b3c4d. Scope what is already known to this host, or the second box's
  // sessions look like duplicates and are silently skipped.
  const known = new Set(
    ptys
      .list()
      .filter((s) => s.host === remote.id)
      .map((s) => s.tmuxSession)
      .filter(Boolean) as string[],
  );
  let adopted = 0;
  for (const line of stdout.split("\n")) {
    const [name, path] = line.trim().split("|");
    if (!name?.startsWith("cv-") || known.has(name)) continue;
    try {
      ptys.create({
        host: remote.id,
        cwd: path || "~",
        cols: 80,
        rows: 45,
        attachTmux: name,
        alias: path ? path.split("/").filter(Boolean).pop() : name,
      });
      adopted++;
    } catch {
      // One bad session must not stop the rest being adopted.
    }
  }
  if (adopted > 0) {
    console.log(`[cv] re-adopted ${adopted} tmux session(s) on ${remote.id}`);
  }
  return adopted;
}
