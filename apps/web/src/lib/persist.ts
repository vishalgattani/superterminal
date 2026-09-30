import type { HostId, SessionInfo } from "@cv/shared";
import type { CanvasNote, GraphTab, NodeGroup, NodePosition, SessionActivity } from "../store/model.ts";

/**
 * Saved views, and how they survive a reload and a restart.
 *
 * A view names sessions by id, but ids do not survive: a page reload keeps them
 * while a viewer restart mints new ones for every re-adopted terminal. So a
 * session is saved under a KEY that does survive: its tmux name when it has one
 * (a re-adopted terminal keeps the tmux session it is attached to), otherwise
 * its id. A local terminal has no tmux name and dies with the server, so its key
 * only ever resolves across a page reload, which is exactly when it should.
 *
 * Keys that resolve to no live session are handled by what they look like. A
 * tmux name may belong to a session that comes back later (fire was off when the
 * viewer started), so it is kept aside and re-emitted on the next save. A local
 * id is dead for good and is dropped.
 */

export interface PersistedTab {
  id: string;
  name: string;
  members?: string[];
  positions: Record<string, NodePosition>;
  groups?: { id: string; name: string; hue: number; members: string[] }[];
  /** Notes hold no session, so they need no key: saved exactly as they are. */
  notes?: CanvasNote[];
}

/**
 * What a saved member was called and how to bring it back. Kept once per
 * durable key at the top level (like `positions`) rather than per tab: a
 * session's alias and Claude conversation id are facts about the session, not
 * about which view happens to show it, so there is nothing to duplicate.
 */
export interface PersistedMember {
  alias?: string;
  /** Claude's own session id, the one `--resume` takes. */
  claudeSessionId?: string;
  /** Needed to spawn the reconnect: which host and folder to resume into. */
  host?: HostId;
  cwd?: string;
}

export interface PersistedViews {
  version: 1;
  activeTab: string;
  showFolders: boolean;
  showForeign: boolean;
  treeFlow: "LR" | "TD";
  positions: Record<string, NodePosition>;
  tabs: PersistedTab[];
  /** Per saved member, keyed the same way as `positions` and `members`. */
  meta?: Record<string, PersistedMember>;
  /** Context links, saved by the same durable key so a resume can restore them. */
  links?: { source: string; target: string }[];
}

/** Saved keys with no live session yet, kept so they are not lost on the next save. */
export interface Retained {
  tabs: Record<string, { members: string[]; positions: Record<string, NodePosition> }>;
  positions: Record<string, NodePosition>;
  meta: Record<string, PersistedMember>;
  links: { source: string; target: string }[];
}

export const emptyRetained = (): Retained => ({ tabs: {}, positions: {}, meta: {}, links: [] });

const OVERVIEW = "default";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const sessionKey = (info: Pick<SessionInfo, "sessionId" | "tmuxSession">): string =>
  info.tmuxSession ?? info.sessionId;

/** A key that could belong to a session that is not here yet. */
const isDurable = (key: string) => !UUID.test(key);

/**
 * A key worth keeping aside even though it is not durable on its own: a local
 * terminal's id dies with the process, but if it was running Claude the
 * conversation itself survives and can be resumed, so its key is kept until
 * the owner clicks "reconnect" rather than dropped like an ordinary dead id.
 */
const canRetain = (key: string, meta: Record<string, PersistedMember>) =>
  isDurable(key) || Boolean(meta[key]?.claudeSessionId);

/** Ids that are already stable strings and pass through unchanged. */
const isPassThrough = (id: string) => id.startsWith("folder:");

/**
 * Cards for sessions the viewer did not start come and go, and so do
 * reconnect cards (their canvas id is a `reconnect:` wrapper around the real
 * key, which is what actually gets saved, via `retained`) — neither has a
 * position of its own worth saving under its synthetic id.
 */
const isTransient = (id: string) => id.startsWith("foreign:") || id.startsWith("reconnect:");

export function serializeViews(input: {
  tabs: GraphTab[];
  activeTab: string;
  positions: Record<string, NodePosition>;
  showFolders: boolean;
  showForeign: boolean;
  treeFlow: "LR" | "TD";
  sessions: Record<string, SessionInfo>;
  activity: Record<string, SessionActivity>;
  links: { source: string; target: string }[];
  retained: Retained;
}): PersistedViews {
  const { sessions, activity, retained } = input;
  const key = (id: string): string | undefined =>
    sessions[id] ? sessionKey(sessions[id]!) : isPassThrough(id) ? id : undefined;

  const keyPositions = (
    positions: Record<string, NodePosition>,
    keep: Record<string, NodePosition>,
  ) => {
    const out: Record<string, NodePosition> = { ...keep };
    for (const [id, p] of Object.entries(positions)) {
      if (isTransient(id)) continue;
      const k = key(id);
      if (k) out[k] = p;
    }
    return out;
  };

  // Alias and Claude session id, captured from the live session at save time.
  // Kept aside (retained.meta) for a key that is not resolvable right now, and
  // skipped for a session with neither an alias nor a Claude id: there is
  // nothing about it worth remembering across a reload.
  const meta: Record<string, PersistedMember> = { ...retained.meta };
  for (const info of Object.values(sessions)) {
    const claudeSessionId = activity[info.sessionId]?.claudeSessionId;
    if (!info.alias && !claudeSessionId) continue;
    meta[sessionKey(info)] = {
      ...(info.alias ? { alias: info.alias } : {}),
      ...(claudeSessionId ? { claudeSessionId } : {}),
      host: info.host,
      cwd: info.cwd,
    };
  }

  // Links, by the same durable key as everything else, so a resumed session
  // (a new id for the same conversation) can have them re-created once it
  // reappears — see resolveRetained.
  const links = [...retained.links];
  const seenLinks = new Set(links.map((l) => `${l.source}->${l.target}`));
  for (const l of input.links) {
    const source = key(l.source);
    const target = key(l.target);
    if (!source || !target) continue;
    const id = `${source}->${target}`;
    if (seenLinks.has(id)) continue;
    seenLinks.add(id);
    links.push({ source, target });
  }

  return {
    version: 1,
    activeTab: input.activeTab,
    showFolders: input.showFolders,
    showForeign: input.showForeign,
    treeFlow: input.treeFlow,
    positions: keyPositions(input.positions, retained.positions),
    tabs: input.tabs.map((t) => {
      const keep = retained.tabs[t.id];
      const members = t.members
        ? [
            ...new Set([
              ...t.members.map(key).filter((k): k is string => Boolean(k)),
              ...(keep?.members ?? []),
            ]),
          ]
        : undefined;
      const groups = t.groups
        ?.map((g) => ({
          id: g.id,
          name: g.name,
          hue: g.hue,
          members: g.members.map(key).filter((k): k is string => Boolean(k)),
        }))
        .filter((g) => g.members.length > 0);
      return {
        id: t.id,
        name: t.name,
        ...(members ? { members } : {}),
        positions: keyPositions(t.positions, keep?.positions ?? {}),
        ...(groups && groups.length ? { groups } : {}),
        ...(t.notes?.length ? { notes: t.notes } : {}),
      };
    }),
    ...(Object.keys(meta).length ? { meta } : {}),
    ...(links.length ? { links } : {}),
  };
}

/** The parts of the store that `serializeViews` writes from. */
type Saveable = Pick<
  Parameters<typeof serializeViews>[0],
  "tabs" | "activeTab" | "positions" | "showFolders" | "showForeign" | "treeFlow" | "sessions" | "activity"
>;

/** Each terminal's alias and Claude session id: what `meta` is saved from. */
const metaSignature = (s: Saveable): string =>
  Object.keys(s.sessions)
    .sort()
    .map((id) => `${id}:${s.sessions[id]!.alias ?? ""}:${s.activity[id]?.claudeSessionId ?? ""}`)
    .join("|");

/**
 * Whether a store change is worth writing to the saved views.
 *
 * Includes a terminal's Claude session id or alias arriving or changing, not
 * just layout. A reconnected (or new) terminal is saved before the status poll
 * has matched it to its Claude, so without this its id was never written: the
 * next restart found a dead terminal with no Claude to resume, dropped it as a
 * plain shell, and saved the empty result (issue #60). Activity alone
 * (working, idle, cost) is not saved, so it does not count.
 */
export function viewsNeedSave(s: Saveable, prev: Saveable): boolean {
  return (
    s.tabs !== prev.tabs ||
    s.activeTab !== prev.activeTab ||
    s.positions !== prev.positions ||
    s.showFolders !== prev.showFolders ||
    s.showForeign !== prev.showForeign ||
    s.treeFlow !== prev.treeFlow ||
    ((s.sessions !== prev.sessions || s.activity !== prev.activity) &&
      metaSignature(s) !== metaSignature(prev))
  );
}

export interface Hydrated {
  tabs: GraphTab[];
  activeTab: string;
  positions: Record<string, NodePosition>;
  showFolders: boolean;
  showForeign: boolean;
  treeFlow: "LR" | "TD";
  retained: Retained;
  /** Links whose endpoints both already resolve; the caller re-creates them. */
  links: { source: string; target: string }[];
}

const isObj = (v: unknown): v is Record<string, unknown> =>
  Boolean(v) && typeof v === "object" && !Array.isArray(v);

/** Turn a saved document back into tabs over the sessions that exist now. */
export function hydrateViews(
  doc: unknown,
  sessions: Record<string, SessionInfo>,
): Hydrated | null {
  if (!isObj(doc) || doc.version !== 1 || !Array.isArray(doc.tabs)) return null;

  const byKey = new Map<string, string>();
  for (const info of Object.values(sessions)) byKey.set(sessionKey(info), info.sessionId);
  const retained = emptyRetained();

  const meta: Record<string, PersistedMember> = {};
  if (isObj((doc as { meta?: unknown }).meta)) {
    for (const [k, v] of Object.entries((doc as { meta: Record<string, unknown> }).meta)) {
      if (!isObj(v)) continue;
      meta[k] = {
        ...(typeof v.alias === "string" ? { alias: v.alias } : {}),
        ...(typeof v.claudeSessionId === "string" ? { claudeSessionId: v.claudeSessionId } : {}),
        ...(typeof v.host === "string" ? { host: v.host } : {}),
        ...(typeof v.cwd === "string" ? { cwd: v.cwd } : {}),
      };
    }
  }

  const id = (k: string): string | undefined =>
    byKey.get(k) ?? (isPassThrough(k) ? k : undefined);

  const positionsOf = (
    raw: unknown,
    park?: Record<string, NodePosition>,
  ): Record<string, NodePosition> => {
    const out: Record<string, NodePosition> = {};
    if (!isObj(raw)) return out;
    for (const [k, v] of Object.entries(raw)) {
      if (!isObj(v) || typeof v.x !== "number" || typeof v.y !== "number") continue;
      const p = { x: v.x, y: v.y };
      const resolved = id(k);
      if (resolved) out[resolved] = p;
      else if (park && canRetain(k, meta) && !isTransient(k)) park[k] = p;
    }
    return out;
  };

  const tabs: GraphTab[] = [];
  for (const raw of doc.tabs as unknown[]) {
    if (!isObj(raw) || typeof raw.id !== "string" || typeof raw.name !== "string") continue;
    const isOverview = raw.id === OVERVIEW;
    const park = { members: [] as string[], positions: {} as Record<string, NodePosition> };
    let members: string[] | undefined;
    // The overview always shows everything, whatever a file says.
    if (!isOverview && Array.isArray(raw.members)) {
      members = [];
      for (const k of raw.members) {
        if (typeof k !== "string") continue;
        const resolved = id(k);
        if (resolved) members.push(resolved);
        else if (canRetain(k, meta)) park.members.push(k);
      }
    }
    const groups: NodeGroup[] = [];
    if (Array.isArray(raw.groups)) {
      for (const g of raw.groups) {
        if (!isObj(g) || typeof g.id !== "string" || !Array.isArray(g.members)) continue;
        const ms = g.members
          .map((k) => (typeof k === "string" ? id(k) : undefined))
          .filter((x): x is string => Boolean(x));
        if (ms.length > 0) {
          groups.push({
            id: g.id,
            name: typeof g.name === "string" ? g.name : "group",
            hue: typeof g.hue === "number" ? g.hue : 210,
            members: ms,
          });
        }
      }
    }
    const notes: CanvasNote[] = [];
    if (Array.isArray(raw.notes)) {
      for (const n of raw.notes) {
        if (!isObj(n) || typeof n.id !== "string" || typeof n.text !== "string") continue;
        const [x, y, w, h] = [n.x, n.y, n.w, n.h];
        if (![x, y, w, h].every((v) => typeof v === "number" && Number.isFinite(v))) continue;
        notes.push({ id: n.id, text: n.text, x: x as number, y: y as number, w: w as number, h: h as number });
      }
    }
    tabs.push({
      id: raw.id,
      name: raw.name,
      positions: positionsOf(raw.positions, park.positions),
      ...(members ? { members } : {}),
      ...(groups.length ? { groups } : {}),
      ...(notes.length ? { notes } : {}),
    });
    if (park.members.length || Object.keys(park.positions).length) {
      retained.tabs[raw.id] = { members: park.members, positions: park.positions };
    }
  }
  if (!tabs.some((t) => t.id === OVERVIEW)) {
    tabs.unshift({ id: OVERVIEW, name: "main", positions: {} });
  }

  const activeTab =
    typeof doc.activeTab === "string" && tabs.some((t) => t.id === doc.activeTab)
      ? doc.activeTab
      : OVERVIEW;

  const positions = positionsOf(doc.positions, retained.positions);

  // Keep meta only for keys actually parked somewhere above; a key that
  // resolved needs nothing carried aside for it.
  const parkedKeys = new Set([
    ...Object.keys(retained.positions),
    ...Object.values(retained.tabs).flatMap((t) => t.members),
  ]);
  for (const k of parkedKeys) if (meta[k]) retained.meta[k] = meta[k];

  // Links, resolved where both ends already exist, kept aside where either
  // (or both) are still waiting on a reconnect or a late re-adoption.
  const hydratedLinks: { source: string; target: string }[] = [];
  if (Array.isArray((doc as { links?: unknown }).links)) {
    for (const raw of (doc as { links: unknown[] }).links) {
      if (!isObj(raw) || typeof raw.source !== "string" || typeof raw.target !== "string") continue;
      const source = id(raw.source);
      const target = id(raw.target);
      if (source && target) hydratedLinks.push({ source, target });
      else if (canRetain(raw.source, meta) && canRetain(raw.target, meta)) {
        retained.links.push({ source: raw.source, target: raw.target });
      }
    }
  }

  return {
    tabs,
    activeTab,
    positions,
    showFolders: doc.showFolders === true,
    showForeign: doc.showForeign !== false,
    treeFlow: doc.treeFlow === "LR" ? "LR" : "TD",
    retained,
    links: hydratedLinks,
  };
}

/**
 * Bring retained keys back when their session shows up (fire came up after the
 * viewer did, a tmux session was re-adopted later, or a "reconnect" click
 * resumed a Claude session under a new id — the caller passes a one-entry
 * `sessions` map whose synthetic `tmuxSession` is the old key, so the same
 * matching logic folds an explicit reconnect and a passive re-adoption into
 * one code path). Returns null when there is nothing to do, so the common
 * case costs one lookup.
 */
export function resolveRetained(
  retained: Retained,
  tabs: GraphTab[],
  positions: Record<string, NodePosition>,
  sessions: Record<string, SessionInfo>,
): {
  retained: Retained;
  tabs: GraphTab[];
  positions: Record<string, NodePosition>;
  /** Links whose two ends just both became resolvable; re-create these. */
  linksToAdd: { source: string; target: string }[];
} | null {
  const hasAny =
    Object.keys(retained.positions).length > 0 ||
    Object.keys(retained.tabs).length > 0 ||
    retained.links.length > 0;
  if (!hasAny) return null;

  const byKey = new Map<string, string>();
  for (const info of Object.values(sessions)) byKey.set(sessionKey(info), info.sessionId);

  let changed = false;
  const nextRetained: Retained = { tabs: {}, positions: {}, meta: {}, links: [] };
  const nextPositions = { ...positions };
  for (const [k, p] of Object.entries(retained.positions)) {
    const sid = byKey.get(k);
    if (sid) {
      nextPositions[sid] = p;
      changed = true;
    } else nextRetained.positions[k] = p;
  }

  const nextTabs = tabs.map((t) => {
    const keep = retained.tabs[t.id];
    if (!keep) return t;
    const members = [...(t.members ?? [])];
    const tabPositions = { ...t.positions };
    const left = { members: [] as string[], positions: {} as Record<string, NodePosition> };
    for (const k of keep.members) {
      const sid = byKey.get(k);
      if (sid && t.members && !members.includes(sid)) {
        members.push(sid);
        changed = true;
      } else if (!sid) left.members.push(k);
    }
    for (const [k, p] of Object.entries(keep.positions)) {
      const sid = byKey.get(k);
      if (sid) {
        tabPositions[sid] = p;
        changed = true;
      } else left.positions[k] = p;
    }
    if (left.members.length || Object.keys(left.positions).length) nextRetained.tabs[t.id] = left;
    return t.members ? { ...t, members, positions: tabPositions } : { ...t, positions: tabPositions };
  });
  // Retained entries for a view that no longer exists are dropped.

  // Meta for a key that just resolved is no longer needed: the live session
  // carries its own alias and the next status poll picks up its Claude id.
  for (const [k, m] of Object.entries(retained.meta)) {
    if (!byKey.has(k)) nextRetained.meta[k] = m;
  }

  const linksToAdd: { source: string; target: string }[] = [];
  for (const l of retained.links) {
    const source = byKey.get(l.source);
    const target = byKey.get(l.target);
    if (source && target) {
      linksToAdd.push({ source, target });
      changed = true;
    } else nextRetained.links.push(l);
  }

  if (!changed) return null;
  return { retained: nextRetained, tabs: nextTabs, positions: nextPositions, linksToAdd };
}
