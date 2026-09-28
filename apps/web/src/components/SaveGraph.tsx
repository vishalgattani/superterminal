import { useMemo, useState } from "react";
import { useStore, viewSessionIds } from "../store.ts";

/**
 * Floppy button on the canvas: snapshot the current graph as a named preset.
 *
 * On the canvas rather than only in the Presets panel, because the moment you
 * want to save a layout is while you are looking at it.
 */
export function SaveGraph() {
  const token = useStore((s) => s.token);
  const order = useStore((s) => s.order);
  const sessions = useStore((s) => s.sessions);
  const tabs = useStore((s) => s.tabs);
  const activeTab = useStore((s) => s.activeTab);
  // What this view shows is what gets saved: a subset view saves its subset, the
  // overview saves everything.
  const members = useMemo(
    () =>
      viewSessionIds(
        tabs.find((t) => t.id === activeTab),
        order,
        sessions,
      ),
    [tabs, activeTab, order, sessions],
  );
  const count = members.length;
  const links = useStore((s) => s.links.length);
  const arrange = useStore((s) => s.arrange);
  const activeGroups = useStore((s) => s.activeGroups);
  const activeMembers = useStore((s) => s.activeMembers);
  const activeNotes = useStore((s) => s.activeNotes);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [state, setState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [message, setMessage] = useState<string | null>(null);

  const save = async () => {
    if (!name.trim()) return;
    setState("saving");
    setMessage(null);
    try {
      const res = await fetch("/api/presets", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        // Frames are part of the arrangement worth saving, so they travel
        // with the nodes and edges.
        body: JSON.stringify({
          name: name.trim(),
          groups: activeGroups(),
          members: activeMembers(),
          notes: activeNotes(),
        }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? res.statusText);
      setState("saved");
      setMessage(`Saved "${name.trim()}"`);
      setName("");
      setTimeout(() => {
        setOpen(false);
        setState("idle");
        setMessage(null);
      }, 1400);
    } catch (e) {
      setState("error");
      setMessage((e as Error).message);
    }
  };

  return (
    <div style={wrap}>
      {/* Layout presets: the graph is easier to read as a chain or a tree
          than wherever the nodes happened to land. Icons, not letters: LR is
          a horizontal double arrow (the tree grows left-right), TD a vertical
          one (top-down), grid a grid. Stacked, not in a row, to line up with
          the save button below rather than crowd it sideways. */}
      {!open && (
        <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 6 }}>
          {(["LR", "TD", "grid"] as const).map((k) => (
            <button
              key={k}
              style={fab}
              title={
                k === "LR"
                  ? "Arrange left to right"
                  : k === "TD"
                    ? "Arrange top down"
                    : "Arrange in a grid"
              }
              disabled={count === 0}
              onClick={() => arrange(k)}
              aria-label={
                k === "LR"
                  ? "Arrange left to right"
                  : k === "TD"
                    ? "Arrange top down"
                    : "Arrange in a grid"
              }
            >
              {k === "LR" ? (
                <svg width="15" height="15" viewBox="0 0 16 16" aria-hidden="true">
                  <path
                    d="M1.5 8h13M1.5 8l3-3M1.5 8l3 3M14.5 8l-3-3M14.5 8l-3 3"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.3"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              ) : k === "TD" ? (
                <svg width="15" height="15" viewBox="0 0 16 16" aria-hidden="true">
                  <path
                    d="M8 1.5v13M8 1.5l-3 3M8 1.5l3 3M8 14.5l-3-3M8 14.5l3-3"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.3"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              ) : (
                <svg width="15" height="15" viewBox="0 0 16 16" aria-hidden="true">
                  <rect x="1.5" y="1.5" width="5" height="5" rx="1" fill="none" stroke="currentColor" strokeWidth="1.3" />
                  <rect x="9.5" y="1.5" width="5" height="5" rx="1" fill="none" stroke="currentColor" strokeWidth="1.3" />
                  <rect x="1.5" y="9.5" width="5" height="5" rx="1" fill="none" stroke="currentColor" strokeWidth="1.3" />
                  <rect x="9.5" y="9.5" width="5" height="5" rx="1" fill="none" stroke="currentColor" strokeWidth="1.3" />
                </svg>
              )}
            </button>
          ))}
        </div>
      )}
      {!open ? (
        <button
          style={fab}
          title={
            count === 0
              ? "Nothing to save: the graph is empty"
              : `Save this graph as a preset (${count} sessions, ${links} connections)`
          }
          disabled={count === 0}
          onClick={() => setOpen(true)}
          aria-label="Save graph as preset"
        >
          {/* A floppy, drawn rather than an emoji so it matches the UI weight */}
          <svg width="15" height="15" viewBox="0 0 16 16" aria-hidden="true">
            <path
              d="M2 2h9l3 3v9a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1z"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.3"
            />
            <path d="M5 2v4h6V2.5" fill="none" stroke="currentColor" strokeWidth="1.3" />
            <rect x="4.5" y="9" width="7" height="5" fill="none" stroke="currentColor" strokeWidth="1.3" />
          </svg>
        </button>
      ) : (
        <div style={panel}>
          <div style={{ fontSize: 10.5, color: "#8a8a93" }}>
            {count} session{count === 1 ? "" : "s"} · {links} connection
            {links === 1 ? "" : "s"}
          </div>
          <div style={{ display: "flex", gap: 6 }}>
            <input
              autoFocus
              style={input}
              placeholder="preset name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                e.stopPropagation();
                if (e.key === "Enter") void save();
                if (e.key === "Escape") setOpen(false);
              }}
            />
            <button style={btn} disabled={state === "saving" || !name.trim()} onClick={() => void save()}>
              {state === "saving" ? "…" : "Save"}
            </button>
            <button style={btn} onClick={() => setOpen(false)}>
              ✕
            </button>
          </div>
          {message && (
            <div
              style={{
                fontSize: 10.5,
                color: state === "error" ? "#e0a33e" : "#8fd0a0",
              }}
            >
              {message}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

const wrap: React.CSSProperties = {
  position: "absolute",
  top: 10,
  right: 10,
  zIndex: 10,
};

const fab: React.CSSProperties = {
  width: 30,
  height: 30,
  display: "grid",
  placeItems: "center",
  borderRadius: 7,
  background: "#15151a",
  border: "1px solid #2f2f39",
  color: "#c9c9d1",
  cursor: "pointer",
};

const panel: React.CSSProperties = {
  background: "#15151a",
  border: "1px solid #2f2f39",
  borderRadius: 9,
  padding: 9,
  display: "grid",
  gap: 6,
  boxShadow: "0 10px 26px #000000aa",
};

const input: React.CSSProperties = {
  background: "#0e0e11",
  border: "1px solid #2a2a32",
  color: "#e6e6e6",
  borderRadius: 5,
  padding: "3px 7px",
  font: "inherit",
  fontSize: 11.5,
  width: 150,
};

const btn: React.CSSProperties = {
  background: "#1c1c23",
  border: "1px solid #2f2f39",
  color: "#c9c9d1",
  borderRadius: 5,
  padding: "3px 9px",
  cursor: "pointer",
  font: "inherit",
  fontSize: 11.5,
};
