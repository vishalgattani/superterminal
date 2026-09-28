import type { SessionInfo } from "@cv/shared";
import type { CanvasNote, GraphTab, NodeGroup, NodePosition } from "../store/model.ts";

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

export interface PersistedViews {
  version: 1;
  activeTab: string;
  showFolders: boolean;
  showForeign: boolean;
  treeFlow: "LR" | "TD";
  positions: Record<string, NodePosition>;
  tabs: PersistedTab[];
}

/** Saved keys with no live session yet, kept so they are not lost on the next save. */
export interface Retained {
  tabs: Record<string, { members: string[]; positions: Record<string, NodePosition> }>;
  positions: Record<string, NodePosition>;
}

export const emptyRetained = (): Retained => ({ tabs: {}, positions: {} });

const OVERVIEW = "default";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const sessionKey = (info: Pick<SessionInfo, "sessionId" | "tmuxSession">): string =>
  info.tmuxSession ?? info.sessionId;

/** A key that could belong to a session that is not here yet. */
const isDurable = (key: string) => !UUID.test(key);

/** Ids that are already stable strings and pass through unchanged. */
const isPassThrough = (id: string) => id.startsWith("folder:");

/** Cards for sessions the viewer did not start come and go; their spots are not saved. */
const isTransient = (id: string) => id.startsWith("foreign:");

export function serializeViews(input: {
  tabs: GraphTab[];
  activeTab: string;
  positions: Record<string, NodePosition>;
  showFolders: boolean;
  showForeign: boolean;
  treeFlow: "LR" | "TD";
  sessions: Record<string, SessionInfo>;
  retained: Retained;
}): PersistedViews {
  const { sessions, retained } = input;
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
  };
}

export interface Hydrated {
  tabs: GraphTab[];
  activeTab: string;
  positions: Record<string, NodePosition>;
  showFolders: boolean;
  showForeign: boolean;
  treeFlow: "LR" | "TD";
  retained: Retained;
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
      else if (park && isDurable(k) && !isTransient(k)) park[k] = p;
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
        else if (isDurable(k)) park.members.push(k);
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

  return {
    tabs,
    activeTab,
    positions: positionsOf(doc.positions, retained.positions),
    showFolders: doc.showFolders === true,
    showForeign: doc.showForeign !== false,
    treeFlow: doc.treeFlow === "LR" ? "LR" : "TD",
    retained,
  };
}

/**
 * Bring retained keys back when their session shows up (fire came up after the
 * viewer did, or a tmux session was re-adopted later). Returns null when there
 * is nothing to do, so the common case costs one lookup.
 */
export function resolveRetained(
  retained: Retained,
  tabs: GraphTab[],
  positions: Record<string, NodePosition>,
  sessions: Record<string, SessionInfo>,
): { retained: Retained; tabs: GraphTab[]; positions: Record<string, NodePosition> } | null {
  const hasAny =
    Object.keys(retained.positions).length > 0 || Object.keys(retained.tabs).length > 0;
  if (!hasAny) return null;

  const byKey = new Map<string, string>();
  for (const info of Object.values(sessions)) byKey.set(sessionKey(info), info.sessionId);

  let changed = false;
  const nextRetained: Retained = { tabs: {}, positions: {} };
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

  if (!changed) return null;
  return { retained: nextRetained, tabs: nextTabs, positions: nextPositions };
}
