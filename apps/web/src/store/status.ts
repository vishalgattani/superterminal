import type { StateCreator } from "zustand";
import { foreignId } from "./model.ts";
import type { SessionActivity, State, StatusSlice } from "./model.ts";

/** Live status from polling, and actions on sessions the viewer does not own. */
export const createStatusSlice: StateCreator<State, [], [], StatusSlice> = (set, get) => ({
  monitors: [],
  setMonitors: (monitors) => set({ monitors }),
  activity: {},
  instance: undefined,
  startingInstance: false,
  attachAgent: async (a, cardAt) => {
    const { token } = get();
    // The card this replaces, so the terminal lands where the card was rather
    // than jumping to the default stack. A card the owner has not dragged has no
    // stored position, so the canvas passes its live one.
    const before = get();
    const fid = foreignId(a);
    const at =
      cardAt ??
      before.tabs.find((t) => t.id === before.activeTab)?.positions[fid] ??
      before.positions[fid];
    const res = await fetch(`/api/agents/${a.sessionId}/attach`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ host: a.host }),
    });
    const body = await res.json();
    if (!res.ok) throw new Error(body.error ?? res.statusText);
    if (body.session) {
      get().addSession(body.session);
      if (at) get().setPosition(body.session.sessionId, at);
      set({ view: "graph" });
    }
  },

  stopAgent: async (a) => {
    const { token } = get();
    const res = await fetch(`/api/agents/${a.sessionId}/stop`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ host: a.host }),
    });
    const body = await res.json();
    if (!res.ok) throw new Error(body.error ?? res.statusText);
  },

  showForeign: true,
  setShowForeign: (v) => set({ showForeign: v }),
  stopRequest: null,
  askStop: (a) => set({ stopRequest: a }),
  applyStatus: ({ instance, sessions, totals, hosts: hostTallies, links, orphans, subagents }) =>
    set((st) => {
      const activity: Record<string, SessionActivity> = {};
      const now = Date.now();
      // Only replaced when a folder actually changed, so a poll that finds
      // nothing new leaves `sessions` untouched and re-renders nothing.
      let moved = st.sessions;
      for (const s of sessions) {
        const { sessionId, cwd, ...rest } = s;
        const prev = st.activity[sessionId];
        const { updatedAt, ...prevRest } = prev ?? {};
        activity[sessionId] = {
          ...rest,
          updatedAt:
            prev && updatedAt && JSON.stringify(prevRest) === JSON.stringify(rest) ? updatedAt : now,
        };
        // The server's view of where this terminal is working now. The folder
        // tree and the label are derived from it, so a `cd` re-files the node.
        const known = moved[sessionId];
        if (cwd && known && known.cwd !== cwd) {
          moved = { ...moved, [sessionId]: { ...known, cwd } };
        }
      }
      return {
        activity,
        ...(moved !== st.sessions ? { sessions: moved } : {}),
        instance,
        totals,
        hostTallies,
        ...(links ? { links } : {}),
        ...(orphans ? { orphans } : {}),
        ...(subagents ? { subagents } : {}),
      };
    }),

  startInstance: async () => {
    const { token } = get();
    set({ startingInstance: true });
    try {
      const res = await fetch("/api/instance/start", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      const body = await res.json();
      if (body.instance) set({ instance: body.instance });
    } finally {
      set({ startingInstance: false });
    }
  },
});
