import type { HostId } from "@cv/shared";
import type { Config, RemoteConfig } from "../config.ts";
import { SshHost } from "./ssh.ts";
import { LocalHost } from "./local.ts";
import type { Host } from "./types.ts";

/**
 * What the UI needs to render a host choice honestly: which hosts exist, which
 * can actually be used right now, and if not, what would make them usable.
 * "Why can I not pick SSH" should be answerable from the UI itself.
 */
export interface HostStatus {
  id: HostId;
  label: string;
  available: boolean;
  /**
   * True for every host but `local`. The browser uses this instead of comparing
   * the id to a literal, so a host it has never heard of still gets remote
   * treatment (reattach, its own colour).
   */
  remote?: boolean;
  /** Shown when unavailable. Says what to do, not just what is wrong. */
  reason?: string;
}

/** The status entry a remote gets, whether it came from config.env or the UI. */
export function hostStatusFor(remote: RemoteConfig): HostStatus {
  return {
    id: remote.id,
    label: remote.label ?? `${remote.id} (${remote.sshTarget})`,
    available: true,
    remote: true,
  };
}

export function buildHosts(config: Config): {
  hosts: Map<HostId, Host>;
  statuses: HostStatus[];
} {
  const hosts = new Map<HostId, Host>();
  hosts.set("local", new LocalHost(config.defaultShell));

  const statuses: HostStatus[] = [
    { id: "local", label: "Local", available: true },
  ];

  // A remote is available once it is configured. Sessions run inside tmux
  // there, so they survive a dropped connection or a restarted viewer.
  for (const remote of config.remotes) {
    hosts.set(remote.id, new SshHost(remote));
    statuses.push(hostStatusFor(remote));
  }

  // With nothing configured the picker would offer only "Local", which reads
  // as "this viewer cannot do remote" rather than "you have not set one up".
  if (config.remotes.length === 0) {
    statuses.push({
      id: "fire",
      label: "fire (SSH)",
      available: false,
      remote: true,
      reason:
        "Not configured. Add one from the Hosts panel, or set CV_HOST_1_ID and " +
        "CV_HOST_1_SSH_TARGET in config.env and restart the server.",
    });
  }

  return { hosts, statuses };
}
