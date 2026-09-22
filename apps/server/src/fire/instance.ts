import { connect } from "node:net";
import type { FireConfig } from "../config.ts";

/**
 * The instance light.
 *
 * Four states, not three. Grey matters: `fire-control` is intranet-only, so
 * being off the VPN is a normal condition, and showing red for it would say
 * "stopped" when the truth is "cannot see". Colour is never the only signal;
 * `state` carries the text.
 */
export type Light = "green" | "yellow" | "red" | "grey";

export interface InstanceStatus {
  light: Light;
  /** Raw state from the API, or a description when we cannot reach it. */
  state: string;
  sshReady: boolean;
  checkedAt: number;
  instanceId?: string;
}

// Verified against the real API: {"instance_id":"...","state":"running"}.
// Other EC2 states are expected but unconfirmed, so anything unrecognised maps
// to yellow and is logged rather than crashing the UI.
const RED = new Set(["stopped", "hibernated", "shutting-down", "terminated", "stopping"]);
const GREEN = new Set(["running"]);

export class FireInstance {
  private cfg: FireConfig;
  private last: InstanceStatus;

  constructor(cfg: FireConfig) {
    this.cfg = cfg;
    this.last = {
      light: "grey",
      state: "not checked yet",
      sshReady: false,
      checkedAt: 0,
      instanceId: cfg.instanceId,
    };
  }

  get status(): InstanceStatus {
    return this.last;
  }

  async refresh(): Promise<InstanceStatus> {
    const { apiBase, instanceId } = this.cfg;
    if (!apiBase || !instanceId) {
      this.last = {
        light: "grey",
        state: "no fire-control configured",
        sshReady: false,
        checkedAt: Date.now(),
        instanceId,
      };
      return this.last;
    }

    let state: string | undefined;
    try {
      const res = await fetch(`${apiBase}/status/${instanceId}`, {
        signal: AbortSignal.timeout(6000),
      });
      if (res.ok) {
        const body = (await res.json()) as { state?: string };
        state = body.state;
      }
    } catch {
      // Unreachable: almost always the VPN being off, not a broken instance.
    }

    if (!state) {
      this.last = {
        light: "grey",
        state: "fire-control unreachable (VPN?)",
        sshReady: false,
        checkedAt: Date.now(),
        instanceId,
      };
      return this.last;
    }

    // Running is not the same as usable: sshd takes a while to accept after
    // the instance reports running, and that gap is exactly where the old
    // scripts failed. Amber covers it.
    const sshReady = GREEN.has(state) ? await this.probeSsh() : false;
    const light: Light = GREEN.has(state)
      ? sshReady
        ? "green"
        : "yellow"
      : RED.has(state)
        ? "red"
        : "yellow";

    this.last = { light, state, sshReady, checkedAt: Date.now(), instanceId };
    return this.last;
  }

  /** TCP-connect to port 22. Cheap, and the only honest test of "usable". */
  private probeSsh(timeoutMs = 3000): Promise<boolean> {
    const host = this.cfg.sshTarget.split("@").pop() ?? this.cfg.sshTarget;
    return new Promise((resolve) => {
      const sock = connect({ host, port: 22, timeout: timeoutMs });
      const done = (ok: boolean) => {
        sock.destroy();
        resolve(ok);
      };
      sock.once("connect", () => done(true));
      sock.once("timeout", () => done(false));
      sock.once("error", () => done(false));
    });
  }

  /** Start the instance, mirroring fire-start.sh: only when it is stopped. */
  async start(): Promise<InstanceStatus> {
    const { apiBase, instanceId } = this.cfg;
    if (!apiBase || !instanceId) throw new Error("fire-control not configured");
    const current = await this.refresh();
    if (current.light === "green") return current;
    await fetch(`${apiBase}/start/${instanceId}`, {
      signal: AbortSignal.timeout(10000),
    });
    return this.refresh();
  }
}
