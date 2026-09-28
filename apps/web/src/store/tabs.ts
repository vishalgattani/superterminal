import type { StateCreator } from "zustand";
import type { SessionInfo } from "@cv/shared";
import { layoutGraph } from "../lib/layout.ts";
import { buildFolderTree } from "../lib/folders.ts";
import { emptyRetained, hydrateViews, resolveRetained, serializeViews } from "../lib/persist.ts";
import { NOTE_PREFIX, OVERVIEW_TAB, externalOrphans, foreignId, uid, viewSessionIds } from "./model.ts";
import type { CanvasNote, GraphTab, NodeGroup, State, TabsSlice } from "./model.ts";

const withIds = (notes: Omit<CanvasNote, "id">[] | undefined): CanvasNote[] =>
  (notes ?? []).map((n) => ({ ...n, id: uid(NOTE_PREFIX) }));

const mapNotes = (t: GraphTab, f: (notes: CanvasNote[]) => CanvasNote[]): GraphTab => ({
  ...t,
  notes: f(t.notes ?? []),
});

/** Graph views (tabs), their layouts and group frames. */
export const createTabsSlice: StateCreator<State, [], [], TabsSlice> = (set, get) => ({
  tabs: [{ id: OVERVIEW_TAB, name: "main", positions: {} }],
  activeTab: OVERVIEW_TAB,
  viewsHydrated: false,
  serverBootId: null,
  retained: emptyRetained(),

  noteBoot: (id) => {
    if (!id) return;
    const prev = get().serverBootId;
    if (prev === id) return;
    // First sight is not a restart. A different id is: this page's sessions and
    // views are about to be rebuilt, so it must not save its half-updated state
    // over the good copy on the server. Load that copy again once boot is done.
    set(prev === null ? { serverBootId: id } : { serverBootId: id, viewsHydrated: false });
  },

  hydrateViews: (doc) =>
    set((s) => {
      const h = hydrateViews(doc, s.sessions);
      // Nothing saved, or unreadable: keep the defaults, and start saving.
      if (!h) return { viewsHydrated: true };
      for (const l of h.links) void get().addLink(l.source, l.target);
      return {
        viewsHydrated: true,
        tabs: h.tabs,
        activeTab: h.activeTab,
        // Sessions adopted so far already have default spots; saved ones win.
        positions: { ...s.positions, ...h.positions },
        showFolders: h.showFolders,
        showForeign: h.showForeign,
        treeFlow: h.treeFlow,
        retained: h.retained,
      };
    }),

  serializeViews: () => {
    const s = get();
    return serializeViews({
      tabs: s.tabs,
      activeTab: s.activeTab,
      positions: s.positions,
      showFolders: s.showFolders,
      showForeign: s.showForeign,
      treeFlow: s.treeFlow,
      sessions: s.sessions,
      activity: s.activity,
      links: s.links,
      retained: s.retained,
    });
  },

  resolveRetained: () => {
    const s = get();
    const r = resolveRetained(s.retained, s.tabs, s.positions, s.sessions);
    if (!r) return;
    set({ retained: r.retained, tabs: r.tabs, positions: r.positions });
    for (const l of r.linksToAdd) void get().addLink(l.source, l.target);
  },

  reconnectMember: async (key) => {
    const s = get();
    const meta = s.retained.meta[key];
    if (!meta?.claudeSessionId) return;
    const res = await fetch("/api/sessions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${s.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        host: meta.host ?? "local",
        cwd: meta.cwd,
        resume: meta.claudeSessionId,
        alias: meta.alias,
        cols: 100,
        rows: 30,
      }),
    });
    const body = await res.json().catch(() => ({}));
    if (!body.session) return;
    get().addSession(body.session);
    // Fold the retained key into the freshly spawned session id everywhere it
    // was parked — the same code path an automatic tmux re-adoption uses, fed
    // every currently live session (so a link to one that was never gone
    // resolves in the same pass) plus a synthetic entry whose "tmux name" is
    // the old key, standing in for the one that just reconnected.
    const after = get();
    const fake = { sessionId: body.session.sessionId, tmuxSession: key } as SessionInfo;
    const r = resolveRetained(after.retained, after.tabs, after.positions, {
      ...after.sessions,
      [body.session.sessionId]: fake,
    });
    if (r) {
      set({ retained: r.retained, tabs: r.tabs, positions: r.positions });
      for (const l of r.linksToAdd) void get().addLink(l.source, l.target);
    }
  },

  addTab: (name) =>
    set((s) => {
      const id = uid("t");
      return {
        tabs: [
          ...s.tabs,
          // Empty on purpose: a view is the sessions you chose to work with,
          // so it starts with none and the owner adds what belongs in it.
          { id, name: name ?? `view ${s.tabs.length + 1}`, positions: {}, members: [] },
        ],
        activeTab: id,
      };
    }),

  addToView: (ids) =>
    set((s) => ({
      tabs: s.tabs.map((t) => {
        // The overview already shows everything.
        if (t.id !== s.activeTab || !t.members) return t;
        const have = new Set(t.members);
        const fresh = ids.filter((id) => s.sessions[id] && !have.has(id));
        return fresh.length ? { ...t, members: [...t.members, ...fresh] } : t;
      }),
    })),

  removeFromView: (ids) =>
    set((s) => {
      const gone = new Set(ids);
      return {
        tabs: s.tabs.map((t) =>
          t.id !== s.activeTab || !t.members
            ? t
            : {
                ...t,
                members: t.members.filter((m) => !gone.has(m)),
                // A frame must not keep a member the view no longer shows.
                groups: t.groups
                  ?.map((g) => ({ ...g, members: g.members.filter((m) => !gone.has(m)) }))
                  .filter((g) => g.members.length > 0),
              },
        ),
        openSessionId:
          s.openSessionId && gone.has(s.openSessionId) ? null : s.openSessionId,
      };
    }),

  // Closing a view never touches a session: tabs are arrangements of the same
  // live terminals, not owners of them.
  closeTab: (id) =>
    set((s) => {
      // The overview is where every session is always visible; without it a
      // session dropped from every other view would have nowhere to be seen.
      if (id === OVERVIEW_TAB || s.tabs.length <= 1) return s;
      const tabs = s.tabs.filter((t) => t.id !== id);
      return {
        tabs,
        activeTab: s.activeTab === id ? tabs[0]!.id : s.activeTab,
      };
    }),

  renameTab: (id, name) =>
    set((s) => ({
      tabs: s.tabs.map((t) => (t.id === id ? { ...t, name } : t)),
    })),

  setActiveTab: (id) => set({ activeTab: id }),

  duplicateTab: async (id, mode) => {
    const s = get();
    const source = s.tabs.find((t) => t.id === id);
    if (!source) return "";
    const newId = uid("t");

    if (mode === "layout") {
      // Same sessions, new arrangement: nothing is spawned, so this is free
      // and instant. Positions are copied so the view starts identical.
      set({
        tabs: [
          ...s.tabs,
          {
            id: newId,
            name: `${source.name} copy`,
            positions: { ...source.positions },
            // Duplicating the overview freezes what it shows right now into a
            // subset, which is the useful thing to want a copy of.
            members: viewSessionIds(source, s.order, s.sessions),
          },
        ],
        activeTab: newId,
      });
      return newId;
    }

    // Clone the working set: same folders and hosts, brand new sessions.
    const ids = viewSessionIds(source, s.order, s.sessions);
    const indexOf = new Map(ids.map((sid, i) => [sid, i]));
    const nodes = ids.map((sid) => {
      const info = s.sessions[sid]!;
      return {
        host: info.host,
        cwd: info.cwd,
        label: info.alias || info.cwd.split("/").filter(Boolean).pop() || "terminal",
        // Only start Claude where one is running now, so a duplicate
        // reproduces the working set rather than inventing sessions.
        claude: Boolean(s.activity[sid]?.claudeSessionId),
      };
    });
    const edges = s.links
      .map((l) => ({ from: indexOf.get(l.source), to: indexOf.get(l.target) }))
      .filter(
        (e): e is { from: number; to: number } =>
          e.from !== undefined && e.to !== undefined,
      );

    set({
      tabs: [
        ...s.tabs,
        // Notes are not sessions, so they are copied as they are.
        {
          id: newId,
          name: `${source.name} copy`,
          positions: {},
          members: [],
          notes: withIds(source.notes),
        },
      ],
      activeTab: newId,
    });

    const groups = (source.groups ?? [])
      .map((g) => ({
        name: g.name,
        hue: g.hue,
        members: g.members
          .map((m) => indexOf.get(m))
          .filter((i): i is number => i !== undefined),
      }))
      .filter((g) => g.members.length > 0);

    const res = await fetch("/api/deploy", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${s.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ name: `${source.name} copy`, nodes, edges, groups }),
    });
    // Show exactly the sessions that were just created, and rebuild the frames
    // around them. Members not yet known to the client are skipped until the
    // next status poll adopts them.
    const body = await res.json().catch(() => ({}));
    set((cur) => ({
      tabs: cur.tabs.map((t) =>
        t.id === newId
          ? {
              ...t,
              members: Array.isArray(body.sessions) ? body.sessions : t.members,
              groups:
                Array.isArray(body.groups) && body.groups.length > 0
                  ? body.groups.map(
                      (g: { name: string; hue: number; members: string[] }, i: number) => ({
                        id: uid("g"),
                        ...g,
                      }),
                    )
                  : t.groups,
            }
          : t,
      ),
    }));
    // New sessions and links arrive on the next status poll.
    return newId;
  },

  arrange: (kind) => {
    const s = get();
    // Only what this view shows: arranging a subset must not shuffle sessions
    // it does not contain.
    const active = s.tabs.find((t) => t.id === s.activeTab);
    const ids = viewSessionIds(active, s.order, s.sessions);
    // External cards live on the overview only.
    const cards =
      s.activeTab === OVERVIEW_TAB && s.showForeign
        ? externalOrphans(s.orphans, s.sessions)
        : [];
    // With folders shown, the tree is part of the arrangement: folders (and the
    // external cards, which belong in it) take part in the layout and
    // containment counts as an edge, so parents sit above (or left of) what they
    // hold. A plain grid ignores structure, folders included.
    let layoutIds = ids;
    let layoutEdges: { source: string; target: string }[] = s.links;
    const inTree = s.showFolders && kind !== "grid";
    if (inTree) {
      const tree = buildFolderTree([
        ...ids.map((id) => ({ id, host: s.sessions[id]!.host as string, cwd: s.sessions[id]!.cwd })),
        ...cards.map((o) => ({ id: foreignId(o), host: o.host as string, cwd: o.cwd ?? "~" })),
      ]);
      // Depth-first from the roots, so a folder's children stay together within
      // a rank and their lines do not cross their neighbours'.
      const kids = new Map<string, string[]>();
      for (const e of tree.edges) kids.set(e.source, [...(kids.get(e.source) ?? []), e.target]);
      const hasParent = new Set(tree.edges.map((e) => e.target));
      const all = [
        ...tree.folders.map((f) => f.id),
        ...ids,
        ...cards.map((o) => foreignId(o)),
      ];
      const ordered: string[] = [];
      const seen = new Set<string>();
      const visit = (id: string) => {
        if (seen.has(id)) return;
        seen.add(id);
        ordered.push(id);
        (kids.get(id) ?? []).forEach(visit);
      };
      all.filter((id) => !hasParent.has(id)).forEach(visit);
      all.forEach(visit);
      layoutIds = ordered;
      layoutEdges = [...tree.edges, ...s.links];
    }
    const next = layoutGraph(layoutIds, layoutEdges, kind);
    // Without the tree, cards are not part of the graph, but leaving them where
    // they were puts them on top of what was just laid out. They go in a row of
    // their own below everything else.
    if (!inTree && cards.length > 0) {
      const bottom = Math.max(0, ...Object.values(next).map((p) => p.y)) + 170;
      cards.forEach((o, i) => {
        next[foreignId(o)] = { x: 40 + (i % 3) * 370, y: bottom + Math.floor(i / 3) * 150 };
      });
    }
    set({
      treeFlow: kind === "grid" ? s.treeFlow : kind,
      // The shared fallback positions belong to the overview; a subset keeps
      // its arrangement to itself.
      positions: s.activeTab === OVERVIEW_TAB ? { ...s.positions, ...next } : s.positions,
      tabs: s.tabs.map((t) =>
        t.id === s.activeTab ? { ...t, positions: { ...t.positions, ...next } } : t,
      ),
    });
  },

  groupNodes: (members, name) =>
    set((s) => {
      if (members.length === 0) return s;
      const id = uid("g");
      // Spread hues apart so two frames never look the same.
      const hue = (s.tabs.find((t) => t.id === s.activeTab)?.groups?.length ?? 0) * 67 + 200;
      const group: NodeGroup = {
        id,
        name: name ?? `group ${((s.tabs.find((t) => t.id === s.activeTab)?.groups?.length ?? 0) + 1)}`,
        // A session belongs to one frame per view: adding it here removes it
        // from any other, so frames cannot overlap ambiguously.
        members: [...new Set(members)],
        hue: hue % 360,
      };
      return {
        tabs: s.tabs.map((t) =>
          t.id === s.activeTab
            ? {
                ...t,
                groups: [
                  ...(t.groups ?? []).map((g) => ({
                    ...g,
                    members: g.members.filter((m) => !group.members.includes(m)),
                  })).filter((g) => g.members.length > 0),
                  group,
                ],
              }
            : t,
        ),
      };
    }),

  activeMembers: () => {
    const s = get();
    return viewSessionIds(
      s.tabs.find((t) => t.id === s.activeTab),
      s.order,
      s.sessions,
    );
  },

  activeGroups: () => {
    const s = get();
    return (s.tabs.find((t) => t.id === s.activeTab)?.groups ?? []).map((g) => ({
      name: g.name,
      hue: g.hue,
      members: g.members,
    }));
  },

  activeNotes: () => {
    const s = get();
    return (s.tabs.find((t) => t.id === s.activeTab)?.notes ?? []).map(({ id: _, ...n }) => n);
  },

  moveToView: (ids, target) =>
    set((s) => {
      const newId = target ?? uid("t");
      const tabs = target
        ? s.tabs
        : [...s.tabs, { id: newId, name: `view ${s.tabs.length + 1}`, positions: {}, members: [] }];
      const gone = new Set(ids);
      return {
        tabs: tabs.map((t) => {
          if (t.id === newId && t.members) {
            const have = new Set(t.members);
            return { ...t, members: [...t.members, ...ids.filter((id) => s.sessions[id] && !have.has(id))] };
          }
          if (t.id === s.activeTab && t.members && t.id !== newId) {
            return {
              ...t,
              members: t.members.filter((m) => !gone.has(m)),
              groups: t.groups
                ?.map((g) => ({ ...g, members: g.members.filter((m) => !gone.has(m)) }))
                .filter((g) => g.members.length > 0),
            };
          }
          return t;
        }),
        ...(target ? {} : { activeTab: newId }),
      };
    }),

  addNote: (x, y) =>
    set((s) => ({
      tabs: s.tabs.map((t) =>
        t.id === s.activeTab
          ? mapNotes(t, (ns) => [...ns, { id: uid(NOTE_PREFIX), text: "", x, y, w: 240, h: 140 }])
          : t,
      ),
    })),

  updateNote: (id, patch) =>
    set((s) => ({
      tabs: s.tabs.map((t) =>
        t.notes?.some((n) => n.id === id)
          ? mapNotes(t, (ns) => ns.map((n) => (n.id === id ? { ...n, ...patch } : n)))
          : t,
      ),
    })),

  removeNote: (id) =>
    set((s) => ({
      tabs: s.tabs.map((t) =>
        t.notes?.some((n) => n.id === id) ? mapNotes(t, (ns) => ns.filter((n) => n.id !== id)) : t,
      ),
    })),

  adoptDeployed: (tabName, sessions, groups, notes) =>
    set((s) => {
      // A deploy creates sessions, so they belong on a view of their own, holding
      // exactly what was spawned, rather than being merged into what is on screen.
      const id = uid("t");
      return {
        tabs: [
          ...s.tabs,
          {
            id,
            name: tabName,
            positions: {},
            members: sessions,
            groups: groups.map((g, i) => ({
              id: uid("g"),
              name: g.name,
              hue: g.hue,
              members: g.members,
            })),
            notes: withIds(notes),
          },
        ],
        activeTab: id,
      };
    }),

  renameGroup: (id, name) =>
    set((s) => ({
      tabs: s.tabs.map((t) =>
        t.id === s.activeTab
          ? {
              ...t,
              groups: (t.groups ?? []).map((g) => (g.id === id ? { ...g, name } : g)),
            }
          : t,
      ),
    })),

  ungroup: (id) =>
    set((s) => ({
      tabs: s.tabs.map((t) =>
        t.id === s.activeTab
          ? { ...t, groups: (t.groups ?? []).filter((g) => g.id !== id) }
          : t,
      ),
    })),
});
