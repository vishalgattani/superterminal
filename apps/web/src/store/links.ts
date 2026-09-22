import type { StateCreator } from "zustand";
import type { LinksSlice, State } from "./model.ts";

/** Context links between terminals, owned by the server. */
export const createLinksSlice: StateCreator<State, [], [], LinksSlice> = (set, get) => ({
  links: [],

  addLink: async (source, target) => {
    if (source === target) return;
    const { token } = get();
    const res = await fetch("/api/links", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ source, target }),
    });
    const body = await res.json();
    if (body.links) set({ links: body.links });
  },

  removeLink: async (id) => {
    const { token } = get();
    const res = await fetch(`/api/links/${encodeURIComponent(id)}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    });
    const body = await res.json();
    if (body.links) set({ links: body.links });
  },

  setLinks: (links) => set({ links }),

  sendReference: async (source, target) => {
    const { token, sessions, activity } = get();
    const from = sessions[source];
    const fromClaude = activity[source]?.claudeSessionId;
    if (!from) return;

    // Point the target at the source by Claude session id, which is what
    // --resume and the transcript are keyed on. Sent as text for a human to
    // read and act on, never as a command: the target decides what to do.
    const lines = [
      `Context from another session I have open:`,
      `  folder:  ${from.cwd}`,
      `  host:    ${from.host}`,
      fromClaude ? `  claude session id: ${fromClaude}` : null,
      fromClaude
        ? `  transcript: ~/.claude/projects/${from.cwd.replaceAll("/", "-")}/${fromClaude}.jsonl`
        : null,
      from.alias ? `  I call it: ${from.alias}` : null,
    ].filter(Boolean);

    const res = await fetch(`/api/sessions/${target}/input`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      // `from` is required: the server only accepts this along a link the
      // owner drew. Not submitted, because injecting and running something in
      // a live session unasked is the surprise this tool should not spring.
      body: JSON.stringify({ from: source, text: lines.join("\n"), submit: false }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      console.warn("[cv] could not send context:", body.error);
      return;
    }
    set({ openSessionId: target, focusOnOpen: true });
  },
});
