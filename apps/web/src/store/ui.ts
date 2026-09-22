import type { StateCreator } from "zustand";
import type { State, UiSlice } from "./model.ts";

/** Which host and view the app is showing. */
export const createUiSlice: StateCreator<State, [], [], UiSlice> = (set) => ({
  token: new URLSearchParams(location.search).get("token") ?? "",
  hosts: [],
  defaultCwd: "",
  showFolders: false,
  treeFlow: "TD",
  setShowFolders: (v) => set({ showFolders: v }),
  setHosts: (hosts, defaultCwd) => set({ hosts, defaultCwd }),

  view: "graph",
  // Switching view collapses the terminal panel. The board needs the width
  // (three or four columns do not fit beside a 60vw panel), and the two modes
  // answer different questions: the board is for surveying, the panel is for
  // typing. Clicking a card opens it again.
  setView: (v) =>
    set((s) => (s.view === v ? s : { view: v, openSessionId: null })),
});
