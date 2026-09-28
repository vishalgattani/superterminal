import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import type { HostId } from "@cv/shared";
import { loadConfig, type Config, type RemoteConfig, type RemoteInput } from "./config.ts";
import { FireInstance } from "./fire/instance.ts";
import { buildHosts, hostStatusFor, type HostStatus } from "./hosts/registry.ts";
import { SshHost } from "./hosts/ssh.ts";
import type { Host } from "./hosts/types.ts";
import { HostsStore } from "./hostsStore.ts";
import { createLinkStore, type LinkStore } from "./links.ts";
import { AgentPoller } from "./status/agents.ts";
import { ContextScraper } from "./status/context.ts";
import { ModelEffortScraper } from "./status/modelEffort.ts";
import { CostScraper } from "./status/cost.ts";
import { CwdTracker } from "./status/cwd.ts";
import { TranscriptIndex } from "./status/transcripts.ts";
import { PresetStore } from "./presets.ts";
import { ViewsStore } from "./views.ts";
import { PtyManager } from "./pty/manager.ts";
import { deployGraph } from "./deploy.ts";
import { reconcileRemote } from "./reconcile.ts";

/**
 * Pids this server descends from.
 *
 * The viewer is often started from inside a Claude session, which then shows
 * up as a live agent like any other. Stopping it would kill the thing running
 * the viewer, so those pids are refused. Computed once at boot, since the
 * ancestry cannot change.
 */
function ancestorPids(): Set<number> {
  const out = new Set<number>();
  let pid: number | undefined = process.pid;
  for (let i = 0; pid && pid > 1 && i < 30; i++) {
    out.add(pid);
    try {
      const res = execFileSync("ps", ["-o", "ppid=", "-p", String(pid)], {
        encoding: "utf8",
        timeout: 3000,
      }).trim();
      pid = res ? Number.parseInt(res, 10) : undefined;
    } catch {
      break;
    }
  }
  return out;
}

/**
 * Everything the route modules share, built once at boot.
 *
 * Passed explicitly rather than imported as module globals, so each route file
 * states what it touches and a second instance (a test rig) needs no tricks.
 */
export interface AppContext extends LinkStore {
  config: Config;
  hosts: Map<HostId, Host>;
  hostStatuses: HostStatus[];
  ptys: PtyManager;
  agents: AgentPoller;
  /** Keeps each terminal's `cwd` at where it is working now, not where it started. */
  cwds: CwdTracker;
  fireInstance?: FireInstance;
  transcripts: TranscriptIndex;
  presets: PresetStore;
  costs: CostScraper;
  contexts: ContextScraper;
  models: ModelEffortScraper;
  views: ViewsStore;
  /**
   * Set once boot re-adoption has finished. The browser waits for it before
   * loading saved views, because a view refers to sessions that are only known
   * after remote sessions have been re-adopted. `id` is new on every start, so a
   * page can tell the server restarted underneath it.
   */
  boot: { ready: boolean; id: string };
  /** Pids this server descends from: never signalled. */
  OWN_PIDS: Set<number>;
  reconcileRemote: () => Promise<number>;
  deployGraph: (preset: Parameters<typeof deployGraph>[1]) => ReturnType<typeof deployGraph>;
  /** Remotes added from the UI, persisted so they survive a restart. */
  hostsStore: HostsStore;
  /**
   * Add a host while the server is running: no restart, so it is usable the
   * moment the SSH target answers. Throws with a reason the route can show.
   */
  addRemoteHost: (input: RemoteInput) => RemoteConfig;
  /**
   * Remove a host this store added. Throws if it is declared in config.env
   * instead (that one survives a restart and removing it here would not), or
   * if a terminal is still open on it.
   */
  removeRemoteHost: (id: HostId) => void;
}

export function createContext(): AppContext {
  const config = loadConfig();
  // Merge before the first build, so a host added in an earlier run is there
  // from boot (and the picker's "nothing configured" placeholder does not
  // appear when the only host that exists came from here). config.env wins a
  // same-named clash, the same rule the legacy CV_FIRE_* keys already follow.
  const hostsStore = new HostsStore();
  const knownIds = new Set(config.remotes.map((r) => r.id));
  config.remotes = [
    ...config.remotes,
    ...hostsStore.list().filter((r) => !knownIds.has(r.id)),
  ];
  const { hosts, statuses: hostStatuses } = buildHosts(config);
  const ptys = new PtyManager(hosts);
  const costs = new CostScraper();
  const contexts = new ContextScraper();
  const models = new ModelEffortScraper();
  const agents = new AgentPoller(config);
  // Read the dollar figure and the context percentage the statusline already
  // prints into the terminal. One tap, since PtyManager keeps only one.
  ptys.onOutput((sessionId, text) => {
    costs.observe(sessionId, text);
    contexts.observe(sessionId, text);
    models.observe(sessionId, text);
  });

  const ctx: AppContext = {
    config,
    hosts,
    hostStatuses,
    ptys,
    agents,
    cwds: new CwdTracker(config, ptys),
    // The instance light is EC2-specific, not remote-specific: it exists only
    // for a host that declares an instance id. A plain SSH box gets no light,
    // rather than a broken one.
    fireInstance: (() => {
      const withInstance = config.remotes.find((r) => r.instanceId);
      return withInstance ? new FireInstance(withInstance) : undefined;
    })(),
    transcripts: new TranscriptIndex(config),
    presets: new PresetStore(),
    costs,
    contexts,
    models,
    views: new ViewsStore(),
    boot: { ready: false, id: randomUUID() },
    OWN_PIDS: ancestorPids(),
    ...createLinkStore(ptys),
    reconcileRemote: () => reconcileRemote(ctx),
    deployGraph: (preset) => deployGraph(ctx, preset),
    hostsStore,
    addRemoteHost: (input) => {
      // Every id in use right now, config.env-declared or added earlier,
      // "local" included: the one list a name can collide with.
      const remote = hostsStore.add(input, [...hosts.keys()]);
      // config.remotes is reassigned (safe: every reader takes it off `config`
      // rather than holding a destructured copy); `hosts` and `hostStatuses`
      // are mutated in place, because route modules destructure those two out
      // of `ctx` once at startup and would otherwise keep the stale array.
      config.remotes = [...config.remotes, remote];
      hosts.set(remote.id, new SshHost(remote));
      // The "nothing configured" placeholder no longer applies once something is.
      const placeholder = hostStatuses.findIndex((s) => s.remote && !s.available);
      if (placeholder !== -1) hostStatuses.splice(placeholder, 1);
      hostStatuses.push(hostStatusFor(remote));
      // So the card does not sit unlabelled for up to 4s waiting on the poll.
      void agents.refresh(remote.id).catch(() => {});
      return remote;
    },
    removeRemoteHost: (id) => {
      if (ptys.list().some((s) => s.host === id)) {
        throw new Error("close every terminal on this host first");
      }
      if (!hostsStore.remove(id)) {
        throw new Error(
          "this host is declared in config.env; edit or remove it there and restart",
        );
      }
      config.remotes = config.remotes.filter((r) => r.id !== id);
      hosts.delete(id);
      const idx = hostStatuses.findIndex((s) => s.id === id);
      if (idx !== -1) hostStatuses.splice(idx, 1);
    },
  };
  return ctx;
}
