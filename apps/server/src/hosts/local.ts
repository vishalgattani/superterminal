import type { Host, SpawnPlan, SpawnRequest } from "./types.ts";

/** Single-quote for a POSIX shell. */
function shellQuote(s: string): string {
  return `'${s.replaceAll("'", `'\\''`)}'`;
}

export class LocalHost implements Host {
  readonly id = "local" as const;
  // Written as an explicit field rather than a constructor parameter property:
  // Node's built-in type stripping runs this file directly and rejects those.
  readonly defaultShell: string;

  constructor(defaultShell: string) {
    this.defaultShell = defaultShell;
  }

  plan(req: SpawnRequest): SpawnPlan {
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      // xterm.js with the WebGL renderer handles 256 colour and true colour.
      TERM: "xterm-256color",
      COLORTERM: "truecolor",
      // Mark the session so a shell profile (or we, later) can tell it apart.
      CV_SESSION_ID: req.sessionId,
      CV_HOST: this.id,
    };

    if (req.command) {
      return {
        file: req.command.file,
        args: req.command.args,
        cwd: req.cwd,
        env,
        shell: `${req.command.file} ${req.command.args.join(" ")}`.trim(),
      };
    }

    // Joining a tmux session that already exists, as the Attach button does for
    // a session started outside the viewer. Without this branch the request
    // fell through to a plain login shell: a terminal that looked attached and
    // was not.
    if (req.attachTmux) {
      return {
        file: "tmux",
        args: ["attach", "-t", req.attachTmux],
        cwd: req.cwd,
        env,
        shell: `tmux attach ${req.attachTmux}`,
      };
    }

    // Resuming starts Claude directly on that session, then drops back to a
    // shell when it exits, so the terminal survives the session ending.
    if (req.resume) {
      return {
        file: this.defaultShell,
        args: [
          "-l",
          "-c",
          `claude --resume ${shellQuote(req.resume)}${req.fork ? " --fork-session" : ""}; ` +
            `exec ${this.defaultShell} -l`,
        ],
        cwd: req.cwd,
        env,
        shell: `claude --resume ${req.resume.slice(0, 8)}${req.fork ? " (fork)" : ""}`,
      };
    }

    if (req.startClaude) {
      return {
        file: this.defaultShell,
        args: ["-l", "-c", `claude; exec ${this.defaultShell} -l`],
        cwd: req.cwd,
        env,
        shell: "claude",
      };
    }

    // A login shell, matching what run.sh ends with (`exec $SHELL -l`), so a
    // plain terminal here behaves like the terminal the owner already uses.
    return {
      file: this.defaultShell,
      args: ["-l"],
      cwd: req.cwd,
      env,
      shell: this.defaultShell,
    };
  }
}
