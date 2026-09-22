import { create } from "zustand";
import { createLinksSlice } from "./store/links.ts";
import { createSessionsSlice } from "./store/sessions.ts";
import { createStatusSlice } from "./store/status.ts";
import { createTabsSlice } from "./store/tabs.ts";
import { createUiSlice } from "./store/ui.ts";
import type { State } from "./store/model.ts";

// Domain types and helpers are re-exported so components keep importing from
// "../store.ts" and never need to know how the store is split.
export * from "./store/model.ts";

/**
 * One store, composed from slices by area. Each slice may read any other
 * through get(): they share one State, and the split is for reading, not for
 * isolation. Add new state to the slice whose area it belongs to.
 */
export const useStore = create<State>()((...a) => ({
  ...createUiSlice(...a),
  ...createSessionsSlice(...a),
  ...createTabsSlice(...a),
  ...createLinksSlice(...a),
  ...createStatusSlice(...a),
}));
