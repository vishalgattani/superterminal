import type { HostId } from "@cv/shared";
import { shellQuote } from "../remote/ssh.ts";
import type { RemoteConfig } from "../config.ts";
import type { Host, SpawnPlan, SpawnRequest } from "./types.ts";

/**
 * Any host reached over SSH, with the session wrapped in tmux.
 *
 * One instance per configured remote; the id comes from the config rather than
 * the class, so a second box is a config entry and not a second file.
 *
 * Why tmux, and what `-A` buys:
 * docs/adr/0005-remote-sessions-live-in-tmux.md
 * Verified facts about the original box (tmux 3.2a, `claude` not on a
 * non-interactive PATH, reverse tunnels allowed): docs/FIRE.md
 */
export class SshHost implements Host {
  readonly id: HostId;
  private readonly cfg: RemoteConfig;

  constructor(cfg: RemoteConfig) {
    this.id = cfg.id;
    this.cfg = cfg;
  }

  plan(req: SpawnRequest): SpawnPlan {
    const session = req.attachTmux ?? `cv-${req.sessionId.slice(0, 8)}`;
    // Per-spawn beats the host default; the host default is what makes
    // "every session on this box is sonnet" true without each caller saying so.
    const model = sanitiseModel(req.model ?? this.cfg.claudeModel);
    // A model name reaches a remote shell, so it is restricted rather than
    // quoted: the same treatment `resume` gets a few lines down.
    const modelFlag = model ? ` --model ${model}` : "";
    // No cwd means "wherever the remote home is": tmux defaults there when
    // -c is omitted, which is right for a session started without a folder.
    // "~" is our marker for "the remote home": tmux would treat it literally,
    // so omit -c and let it default there.
    const dirFlag =
      req.cwd && req.cwd !== "~" ? `-c ${shellQuote(req.cwd)} ` : "";

    // tmux new-session -A: attach if it exists, create otherwise. This is what
    // makes a session survive a dropped connection, a closed tab and a
    // restarted viewer, so it is the attach path as well as the create path.
    //
    // A login shell inside tmux gives the same PATH and prompt the owner gets
    // when they ssh in by hand, which matters because `claude` is only on PATH
    // for a login shell.
    // Resuming runs Claude on that session id, then falls back to a login
    // shell so the terminal outlives the session rather than closing under you.
    // Starting Claude directly, then dropping back to a login shell when it
    // exits, so the terminal outlives the session rather than closing.
    const inner = req.startClaude && !req.resume
      ? `${this.cfg.claudePath}${modelFlag}; exec $SHELL -l`
      : req.resume
      ? `${this.cfg.claudePath}${modelFlag} --resume ${req.resume.replace(/[^a-zA-Z0-9-]/g, "")}` +
        // --fork-session branches: the original transcript is left untouched
        // and the new work gets its own session id.
        `${req.fork ? " --fork-session" : ""}; exec $SHELL -l`
      : `exec ${this.cfg.loginShell ?? "$SHELL"} -l`;

    // Attaching to a session someone else created: join it as it is, rather
    // than creating one of ours. -A would create it if the name were wrong,
    // which would silently give an empty shell instead of the real session.
    const remote = req.attachTmux
      ? `tmux attach -t ${shellQuote(req.attachTmux)}`
      : `tmux new-session -A -s ${session} ${dirFlag}${shellQuote(inner)}`;

    const args = [
      "-t", // force a pty: without it tmux has no terminal to attach to
      "-o", "BatchMode=yes", // never sit at an interactive password prompt
      "-o", "StrictHostKeyChecking=accept-new",
      "-o", "ServerAliveInterval=15",
      "-o", "ServerAliveCountMax=4",
      // Reuse one connection per host: a new session then costs about one
      // round trip instead of a full handshake.
      "-o", "ControlMaster=auto",
      "-o", `ControlPath=${this.cfg.controlPath}`,
      "-o", "ControlPersist=10m",
    ];
    if (this.cfg.keyPath) args.push("-i", this.cfg.keyPath, "-o", "IdentitiesOnly=yes");
    if (this.cfg.forwardX11) args.push("-X");
    args.push(this.cfg.sshTarget, remote);

    return {
      file: "ssh",
      args,
      // The local process runs from anywhere; the remote cwd is tmux's -c.
      cwd: process.env.HOME ?? "/",
      env: {
        ...process.env,
        TERM: "xterm-256color",
        COLORTERM: "truecolor",
        CV_SESSION_ID: req.sessionId,
        CV_HOST: this.id,
      },
      model,
      shell: req.attachTmux
        ? `tmux attach ${req.attachTmux}`
        : req.startClaude && !req.resume
        ? `claude${modelFlag} · tmux ${session}`
        : req.resume
        ? `claude${modelFlag} --resume ${req.resume.slice(0, 8)} · tmux ${session}`
        : `ssh ${this.cfg.sshTarget} · tmux ${session}`,
    };
  }
}

/**
 * Model names are `[a-z0-9-]` and reach a remote shell, so anything else is
 * dropped rather than escaped. A name that does not survive this was not a
 * model name, and launching with a mangled one would be worse than launching
 * with none: Claude would fall back to its default and look correct.
 */
function sanitiseModel(m: string | undefined): string | undefined {
  if (!m) return undefined;
  const clean = m.trim().toLowerCase().replace(/[^a-z0-9.-]/g, "");
  return clean || undefined;
}
