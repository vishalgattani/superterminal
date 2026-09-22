import type { StateCreator } from "zustand";
import { OVERVIEW_TAB, dropFromTabs, viewSessionIds } from "./model.ts";
import type { SessionsSlice, State } from "./model.ts";

/** Terminals: the registry, the open panel, close, rename, reattach and creation. */
export const createSessionsSlice: StateCreator<State, [], [], SessionsSlice> = (set, get) => ({
  sessions: {},
  order: [],
  positions: {},
  openSessionId: null,
  focusOnOpen: false,
  exited: {},

  addSession: (info) =>
    set((s) => {
      const index = s.order.length;
      return {
        sessions: { ...s.sessions, [info.sessionId]: info },
        order: [...s.order, info.sessionId],
        positions: {
          ...s.positions,
          // Stagger new nodes so they never land exactly on top of each other.
          [info.sessionId]: {
            x: 40 + (index % 3) * 240,
            y: 40 + Math.floor(index / 3) * 130,
          },
        },
        // A session created, attached, forked or resumed while a subset view is
        // active belongs in it: you made it to work with it. The overview
        // shows everything already, and other views are left alone.
        tabs: s.tabs.map((t) =>
          t.id === s.activeTab && t.members
            ? { ...t, members: [...t.members, info.sessionId] }
            : t,
        ),
        openSessionId: info.sessionId,
        // A terminal you just created is one you want to type into.
        focusOnOpen: true,
      };
    }),

  adoptSessions: (infos) => {
    set((s) => {
      const fresh = infos.filter((i) => !s.sessions[i.sessionId]);
      if (fresh.length === 0) return s;
      const sessions = { ...s.sessions };
      const positions = { ...s.positions };
      const order = [...s.order];
      for (const info of fresh) {
        sessions[info.sessionId] = info;
        const index = order.length;
        positions[info.sessionId] = s.positions[info.sessionId] ?? {
          x: 40 + (index % 3) * 240,
          y: 40 + Math.floor(index / 3) * 130,
        };
        order.push(info.sessionId);
      }
      // Adopted sessions do not open a panel or steal focus: restoring the
      // graph should not decide what you were looking at.
      return { sessions, positions, order };
    });
    // A session that has just appeared may be one a saved view was waiting for.
    get().resolveRetained();
  },

  updateSession: (id, patch) =>
    set((s) =>
      s.sessions[id]
        ? { sessions: { ...s.sessions, [id]: { ...s.sessions[id], ...patch } } }
        : s,
    ),

  removeSession: (id) =>
    set((s) => {
      const sessions = { ...s.sessions };
      delete sessions[id];
      const positions = { ...s.positions };
      delete positions[id];
      const exited = { ...s.exited };
      delete exited[id];
      return {
        sessions,
        positions,
        exited,
        // A closed session must leave every view that lists it.
        tabs: dropFromTabs(s.tabs, [id]),
        order: s.order.filter((x) => x !== id),
        openSessionId: s.openSessionId === id ? null : s.openSessionId,
      };
    }),

  markExited: (id) => set((s) => ({ exited: { ...s.exited, [id]: true } })),

  setPosition: (id, pos) =>
    set((s) => ({
      // The shared fallback belongs to the overview: a drag inside a subset
      // view must not also move the node there.
      positions:
        s.activeTab === OVERVIEW_TAB ? { ...s.positions, [id]: pos } : s.positions,
      tabs: s.tabs.map((t) =>
        t.id === s.activeTab
          ? { ...t, positions: { ...t.positions, [id]: pos } }
          : t,
      ),
    })),

  toggleOpen: (id) =>
    set({
      openSessionId: get().openSessionId === id ? null : id,
      focusOnOpen: true,
    }),

  open: (id) => set({ openSessionId: id, focusOnOpen: true }),

  close: () => set({ openSessionId: null, focusOnOpen: false }),

  cycle: (delta) => {
    const st = get();
    const { openSessionId } = st;
    // Cycle through what the active view shows, not through everything.
    const order = viewSessionIds(
      st.tabs.find((t) => t.id === st.activeTab),
      st.order,
      st.sessions,
    );
    if (order.length === 0) return;
    const at = openSessionId ? order.indexOf(openSessionId) : -1;
    // Nothing open yet: forward starts at the first, back at the last.
    const next =
      at === -1
        ? delta === 1
          ? 0
          : order.length - 1
        : (at + delta + order.length) % order.length;
    set({ openSessionId: order[next]!, focusOnOpen: false });
  },
  confirmCloseId: null,
  askClose: (id) => set({ confirmCloseId: id, closeError: null }),

  killSession: async (id, terminate = false) => {
    const { token } = get();
    const url = `/api/sessions/${id}${terminate ? "?terminate=1" : ""}`;
    if (terminate) {
      // Unlike a plain close, this must not drop the node on failure: the
      // remote session is still running, and hiding the node would hide that.
      set({ closing: true, closeError: null });
      try {
        const res = await fetch(url, {
          method: "DELETE",
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          set({ closeError: body.error ?? res.statusText });
          return;
        }
      } catch (err) {
        set({ closeError: (err as Error).message });
        return;
      } finally {
        set({ closing: false });
      }
      set({ confirmCloseId: null, closeError: null });
      get().removeSession(id);
      return;
    }
    try {
      await fetch(url, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
    } finally {
      // Drop the node even if the request failed: the alternative is a node
      // that cannot be dismissed. The reaper cleans up any stragglers.
      set({ confirmCloseId: null, closeError: null });
      get().removeSession(id);
    }
  },

  closing: false,
  closeError: null,
  renamingId: null,
  // Renaming takes the keyboard. Clear focusOnOpen too, or the pane's focus
  // effect re-runs from the same double-click and hands focus back to the
  // terminal, so the rename box appears while every keystroke goes to the shell.
  startRename: (id) => set({ renamingId: id, focusOnOpen: id ? false : true }),

  setAlias: async (id, alias) => {
    const { token } = get();
    const trimmed = alias.trim().slice(0, 60);
    // Update locally first so the rename feels instant, then persist. The
    // server holds the registry, so a reload should show the same name.
    get().updateSession(id, { alias: trimmed || undefined });
    set({ renamingId: null });
    try {
      await fetch(`/api/sessions/${id}`, {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ alias: trimmed }),
      });
    } catch {
      // A failed rename is cosmetic: the label is viewer metadata, and the
      // session itself is unaffected.
    }
  },

  epoch: {},
  reattach: async (id) => {
    const { token } = get();
    set({ reattaching: id });
    try {
      const res = await fetch(`/api/sessions/${id}/reattach`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error((await res.json()).error ?? res.statusText);
      const { session } = await res.json();
      set((s) => ({
        sessions: { ...s.sessions, [id]: session },
        exited: { ...s.exited, [id]: false },
        // New pty, so the old socket is dead: force a rebuild.
        epoch: { ...s.epoch, [id]: (s.epoch[id] ?? 0) + 1 },
        openSessionId: id,
        focusOnOpen: true,
      }));
    } finally {
      set({ reattaching: null });
    }
  },

  reattaching: null,
  createSessionAt: async (host, at) => {
    const { token, defaultCwd } = get();
    const res = await fetch("/api/sessions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      // Only the local host gets the local default directory. Sending
      // /Users/... to the Linux box would land the terminal in a path that
      // does not exist there.
      body: JSON.stringify({
        host,
        cwd: host === "local" ? defaultCwd || undefined : undefined,
        cols: 80,
        rows: 45,
      }),
    });
    const body = await res.json();
    if (!body.session) return;
    get().addSession(body.session);
    // Drop it where the click was, not in the default stack.
    get().setPosition(body.session.sessionId, at);
  },

  forkSession: async (terminalId) => {
    const { token, sessions, activity, positions } = get();
    const from = sessions[terminalId];
    const claudeId = activity[terminalId]?.claudeSessionId;
    // Only meaningful when a Claude is actually running here: there is
    // nothing to fork from a plain shell.
    if (!from || !claudeId) return;

    const res = await fetch("/api/sessions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        host: from.host,
        cwd: from.cwd,
        resume: claudeId,
        fork: true,
        cols: 80,
        rows: 45,
      }),
    });
    const body = await res.json();
    if (!body.session) return;
    get().addSession({
      ...body.session,
      alias: from.alias ? `${from.alias} (fork)` : undefined,
    });
    // Place the fork beside its parent, so the lineage is visible.
    const at = positions[terminalId];
    if (at) get().setPosition(body.session.sessionId, { x: at.x + 240, y: at.y + 70 });
    // Record where it came from: a fork is a context link by definition.
    void get().addLink(terminalId, body.session.sessionId);
  },

  resumeSession: async (host, cwd, sessionId) => {
    const { token } = get();
    const res = await fetch("/api/sessions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ host, cwd, resume: sessionId, cols: 100, rows: 30 }),
    });
    const body = await res.json();
    if (body.session) {
      get().addSession(body.session);
      // Jump to the graph: the resumed terminal is the thing to look at now.
      set({ view: "graph" });
    }
  },

  compactSession: async (terminalId) => {
    const { token } = get();
    await fetch(`/api/sessions/${terminalId}/compact`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
    });
  },

  reconcile: (terminals) =>
    set((s) => {
      const alive = new Set(terminals.map((t) => t.sessionId));
      const gone = s.order.filter((id) => !alive.has(id));
      if (gone.length === 0) return s;
      const sessions = { ...s.sessions };
      const positions = { ...s.positions };
      const exited = { ...s.exited };
      for (const id of gone) {
        delete sessions[id];
        delete positions[id];
        delete exited[id];
      }
      return {
        sessions,
        positions,
        exited,
        tabs: dropFromTabs(s.tabs, gone),
        order: s.order.filter((id) => alive.has(id)),
        openSessionId:
          s.openSessionId && gone.includes(s.openSessionId) ? null : s.openSessionId,
        // Links are the server's; it drops them when a session dies.
      };
    }),
});
