import type { HostId, SessionInfo } from "@cv/shared";
import type { PersistedViews, Retained } from "../lib/persist.ts";

export interface HostStatus {
  id: HostId;
  label: string;
  available: boolean;
  /** True for every host but `local`. See apps/server/src/hosts/registry.ts. */
  remote?: boolean;
  reason?: string;
}

export type Activity = "working" | "waiting" | "idle" | "unknown" | "shell";

export interface SessionActivity {
  activity: Activity;
  claudeName?: string;
  waitingFor?: string;
  kind?: string;
  /** Session cost in USD, scraped from the statusline in the terminal. */
  costUsd?: number;
  /** Context window used, 0-100, scraped from the statusline in the terminal. */
  contextPct?: number;
  /** The model the running Claude reports now, scraped from the statusline. */
  liveModel?: string;
  /** Its effort level (low, medium, high, ...), from the same statusline. */
  effort?: string;
  /** Claude's own session id, the one `--resume` takes. */
  claudeSessionId?: string;
}

export interface InstanceStatus {
  light: "green" | "yellow" | "red" | "grey";
  state: string;
  sshReady: boolean;
  checkedAt: number;
}

export interface HostTally {
  host: HostId;
  terminals: number;
  interactive: number;
  background: number;
  working: number;
  waiting: number;
  idle: number;
  historical?: number;
  inactive?: number;
  subagents?: number;
  error?: string;
}

export interface Orphan {
  host: HostId;
  sessionId: string;
  pid?: number;
  cwd?: string;
  name?: string;
  kind?: string;
  activity: string;
  waitingFor?: string;
  tmuxSession?: string;
  attachable: boolean;
  /** The session running this viewer: stopping it would kill the viewer. */
  isViewer?: boolean;
}

/**
 * Node id for a live Claude session this viewer did not start. Prefixed so it
 * can never collide with a terminal id, and keyed by (host, Claude session id)
 * because that pair is the only thing that identifies such a session.
 */
export const foreignId = (o: Pick<Orphan, "host" | "sessionId">): string =>
  `foreign:${o.host}:${o.sessionId}`;

/**
 * Live sessions with no terminal of ours, minus any we have just attached to.
 *
 * After Attach the new terminal exists immediately but the server's orphan list
 * only catches up on the next status poll, so without this the same session
 * would show twice for a few seconds. The tmux name is what joins them.
 */
export function externalOrphans(
  orphans: Orphan[] | undefined,
  sessions: Record<string, SessionInfo>,
): Orphan[] {
  const ours = new Set(
    Object.values(sessions)
      .map((s) => s.tmuxSession)
      .filter(Boolean),
  );
  return (orphans ?? []).filter((o) => !(o.tmuxSession && ours.has(o.tmuxSession)));
}

export type ViewMode = "graph" | "kanban" | "history" | "agents";

export interface NodeGroup {
  id: string;
  name: string;
  /** Session ids inside the frame. */
  members: string[];
  /** Translucent fill, picked on creation so frames stay distinguishable. */
  hue: number;
}

/**
 * A markdown note on the canvas. Decoration only (issue #18, ADR 0006): it is
 * not a session, so it has no terminal, no context handles and no capability.
 * It carries its own position and size, and belongs to one view.
 */
export interface CanvasNote {
  id: string;
  text: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

export const NOTE_PREFIX = "note:";

export interface GraphTab {
  id: string;
  name: string;
  /** Node positions are per tab: the same session can sit anywhere in each. */
  positions: Record<string, NodePosition>;
  /** Frames are per view, like the layout they enclose. */
  groups?: NodeGroup[];
  /**
   * The sessions this view shows, in the order they were added. Undefined means
   * every session: that is the overview, which always exists and cannot be
   * closed. A view with a list is a subset the owner chose, and is what gets
   * saved as a preset.
   */
  members?: string[];
  notes?: CanvasNote[];
}

let idSeq = 0;
/**
 * A view or frame id. The clock alone is not unique: two created in the same
 * millisecond shared an id, so closing one closed both.
 */
export function uid(prefix: string): string {
  return `${prefix}${Date.now().toString(36)}${(idSeq++).toString(36)}`;
}

/** The overview: shows every session, and is the one view that cannot be closed. */
export const OVERVIEW_TAB = "default";

/**
 * The sessions a view shows, in creation order.
 *
 * Members that no longer exist are skipped rather than trusted, so a session
 * closed elsewhere can never leave a phantom node behind.
 */
export function viewSessionIds(
  tab: GraphTab | undefined,
  order: string[],
  sessions: Record<string, SessionInfo>,
): string[] {
  const live = order.filter((id) => sessions[id]);
  if (!tab?.members) return live;
  const wanted = new Set(tab.members);
  return live.filter((id) => wanted.has(id));
}

/** Remove sessions from every view's member list and frames. */
export function dropFromTabs(tabs: GraphTab[], ids: string[]): GraphTab[] {
  const gone = new Set(ids);
  return tabs.map((t) => ({
    ...t,
    members: t.members?.filter((m) => !gone.has(m)),
    groups: t.groups
      ?.map((g) => ({ ...g, members: g.members.filter((m) => !gone.has(m)) }))
      .filter((g) => g.members.length > 0),
  }));
}

export interface NodePosition {
  x: number;
  y: number;
}

export interface UiSlice {
  /** Show ancestor folders as nodes with containment lines. */
  showFolders: boolean;
  setShowFolders: (v: boolean) => void;
  /**
   * Which way the tree runs, taken from the last LR / TD arrange, so the
   * containment lines leave and enter nodes on the sides that face each other.
   */
  treeFlow: "LR" | "TD";
  token: string;
  hosts: HostStatus[];
  defaultCwd: string;
  setHosts: (hosts: HostStatus[], defaultCwd: string) => void;
  /** Which panel is showing: the graph canvas or the kanban board. */
  view: ViewMode;
  setView: (v: ViewMode) => void;
}

export interface SessionsSlice {
  sessions: Record<string, SessionInfo>;
  /** Order of creation, so the graph can lay new nodes out predictably. */
  order: string[];
  positions: Record<string, NodePosition>;
  /** The session whose terminal the right panel shows, or null when collapsed. */
  openSessionId: string | null;
  /**
   * Set when the panel was opened by a click, cleared when opened by Tab
   * cycling. Clicking a node means "I want to use this", so the terminal takes
   * focus; cycling means "show me each one", where stealing focus would let
   * the pty swallow the next Tab and stop the cycle dead.
   */
  focusOnOpen: boolean;
  exited: Record<string, boolean>;

  addSession: (info: SessionInfo) => void;
  /** Rebuild the graph from sessions the server already has, on page load. */
  adoptSessions: (infos: SessionInfo[]) => void;
  updateSession: (id: string, patch: Partial<SessionInfo>) => void;
  removeSession: (id: string) => void;
  markExited: (id: string) => void;
  setPosition: (id: string, pos: NodePosition) => void;
  /** Clicking a node opens its panel; clicking the open one collapses it. */
  toggleOpen: (id: string) => void;
  open: (id: string) => void;
  close: () => void;
  /** Move the open session forward or back through creation order. */
  cycle: (delta: 1 | -1) => void;

  /** Node currently asking "close this session?", or null. */
  confirmCloseId: string | null;
  askClose: (id: string | null) => void;
  /**
   * Drops the node and its local pty. With `terminate`, first ends the remote
   * tmux session too; if that fails the node stays and `closeError` says why.
   */
  killSession: (id: string, terminate?: boolean) => Promise<void>;
  /** True while a terminate request is in flight. */
  closing: boolean;
  /** Why the last terminate failed, shown in the close dialog. */
  closeError: string | null;

  /** Node whose title is being edited inline, or null. */
  renamingId: string | null;
  startRename: (id: string | null) => void;
  /** Owner's label for a session. Claude is never told about it. */
  setAlias: (id: string, alias: string) => Promise<void>;

  /**
   * Bumped per session to force the terminal pane to tear down and rebuild
   * its socket, which is how a reattach gets a live connection again.
   */
  epoch: Record<string, number>;
  reattach: (id: string) => Promise<void>;
  reattaching: string | null;

  /** Create a terminal at a specific canvas position (right-click menu). */
  createSessionAt: (host: HostId, at: NodePosition) => Promise<void>;
  /** Branch a running Claude session into a new terminal (--fork-session). */
  forkSession: (terminalId: string) => Promise<void>;
  /** Open a terminal running `claude --resume` for a past session. */
  resumeSession: (host: HostId, cwd: string, sessionId: string) => Promise<void>;
  /** Run `/compact` in a session's own terminal, submitted unattended. */
  compactSession: (terminalId: string) => Promise<void>;
  /** Drop nodes for terminals the server no longer has. */
  reconcile: (terminals: SessionInfo[]) => void;
}

export interface TabsSlice {
  /** Graph views, in the manner of terminal tabs. */
  tabs: GraphTab[];
  activeTab: string;
  /**
   * True once saved views have been loaded (or there were none). Nothing is
   * saved before this, so a client that has not loaded cannot overwrite what is
   * stored with an empty default.
   */
  viewsHydrated: boolean;
  /** Which server start this page last saw. A change means it restarted. */
  serverBootId: string | null;
  /**
   * Record the server's boot id. When it changes, everything this page holds
   * about sessions is stale (they are about to be re-adopted, often under new
   * ids), so saving stops until the saved views are loaded again.
   */
  noteBoot: (id: string | undefined) => void;
  /** Saved keys whose sessions are not here yet, re-emitted on the next save. */
  retained: Retained;
  /** Apply the saved document (or null for none) over the sessions known now. */
  hydrateViews: (doc: unknown) => void;
  /** The views as they should be written to the server. */
  serializeViews: () => PersistedViews;
  /** Bring back saved entries whose sessions have since appeared. */
  resolveRetained: () => void;
  /**
   * Resume a retained member that never came back on its own: spawns
   * `claude --resume` for its saved Claude session id and folds the new
   * session into wherever the old key was kept aside.
   */
  reconnectMember: (key: string) => Promise<void>;
  /** A new view is an empty subset: the owner picks which sessions it shows. */
  addTab: (name?: string) => void;
  /** Show more sessions on the active view. No effect on the overview. */
  addToView: (ids: string[]) => void;
  /** Stop showing sessions on the active view. The sessions keep running. */
  removeFromView: (ids: string[]) => void;
  closeTab: (id: string) => void;
  renameTab: (id: string, name: string) => void;
  setActiveTab: (id: string) => void;
  /**
   * Copy a view. "layout" reuses the same live sessions in a new arrangement;
   * "sessions" spawns a fresh set of terminals mirroring this view and wires
   * them the same way.
   */
  duplicateTab: (id: string, mode: "layout" | "sessions") => Promise<string>;
  /** Re-arrange the active view: left-to-right, top-down, or a plain grid. */
  arrange: (kind: "LR" | "TD" | "grid") => void;
  /** Enclose sessions in a named frame on the active view. */
  groupNodes: (members: string[], name?: string) => void;
  /** The sessions the active view shows, for saving into a preset. */
  activeMembers: () => string[];
  /** Frames on the active view, for saving into a preset. */
  activeGroups: () => { name: string; hue: number; members: string[] }[];
  /** Notes on the active view, for saving into a preset. */
  activeNotes: () => Omit<CanvasNote, "id">[];
  addNote: (x: number, y: number) => void;
  /**
   * Send sessions to another view, or to a new one when target is null. They
   * leave the view they are in, unless that is the overview, which always
   * shows everything. Never touches the sessions themselves.
   */
  moveToView: (ids: string[], target: string | null) => void;
  updateNote: (id: string, patch: Partial<Omit<CanvasNote, "id">>) => void;
  removeNote: (id: string) => void;
  /**
   * Open a new view holding exactly the sessions a deploy just spawned, with
   * the preset's frames around them.
   */
  adoptDeployed: (
    tabName: string,
    sessions: string[],
    groups: { name: string; hue: number; members: string[] }[],
    notes?: Omit<CanvasNote, "id">[],
  ) => void;
  renameGroup: (id: string, name: string) => void;
  ungroup: (id: string) => void;
}

export interface LinksSlice {
  /**
   * Context links, owned by the server. They are a capability: a session may
   * only be written into along a link, so they cannot live only in this tab.
   */
  links: { id: string; source: string; target: string }[];
  addLink: (source: string, target: string) => Promise<void>;
  removeLink: (id: string) => Promise<void>;
  setLinks: (links: State["links"]) => void;
  /** Type a reference to the source session into the target's terminal. */
  sendReference: (source: string, target: string) => Promise<void>;
}

export interface StatusSlice {
  /** Live status, refreshed by polling /api/status. */
  activity: Record<string, SessionActivity>;
  instance?: InstanceStatus;
  startingInstance: boolean;
  hostTallies?: HostTally[];
  /** Live Claude sessions with no terminal of ours. */
  orphans?: Orphan[];
  /**
   * Subagents per Claude session id, and when the scan behind them ran.
   * Keyed by Claude's session id, so it covers our terminals and the sessions
   * we did not start alike.
   */
  subagents?: { counts: Record<string, number>; fetchedAt: number };
  /** `at` is where the card being replaced sits, so the terminal takes its place. */
  attachAgent: (a: Orphan, at?: NodePosition) => Promise<void>;
  stopAgent: (a: Orphan) => Promise<void>;
  /** Show sessions the viewer did not start as cards on the canvas. */
  showForeign: boolean;
  setShowForeign: (v: boolean) => void;
  /** Session the owner is being asked to stop, or null. Shared by every view. */
  stopRequest: Orphan | null;
  askStop: (a: Orphan | null) => void;

  applyStatus: (payload: {
    instance?: InstanceStatus;
    sessions: (SessionActivity & { sessionId: string; cwd?: string })[];
    totals?: State["totals"];
    hosts?: HostTally[];
    terminals?: SessionInfo[];
    links?: State["links"];
    orphans?: Orphan[];
    subagents?: { counts: Record<string, number>; fetchedAt: number };
  }) => void;
  startInstance: () => Promise<void>;
  totals?: {
    liveSessions: number;
    background: number;
    waiting: number;
    working: number;
    terminals: number;
  };
}

export type State = UiSlice &
  SessionsSlice &
  TabsSlice &
  LinksSlice &
  StatusSlice;
