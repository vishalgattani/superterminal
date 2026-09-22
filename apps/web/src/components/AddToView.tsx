import { useEffect, useMemo, useRef, useState } from "react";
import { useStore, viewSessionIds } from "../store.ts";
import { TONE, short } from "./ForeignActions.tsx";
import { hostStyle as hostColour } from "../lib/hostColour.ts";

/**
 * Choose which sessions a view shows.
 *
 * Lists every session the active view does not show yet. Sessions the viewer
 * did not start are absent on purpose: they have no terminal to put on a
 * canvas, and Attach on the overview brings one in (and into the view you are
 * on). Picking here changes only what the view shows; nothing is started,
 * stopped or moved.
 */
export function AddToView({ onClose }: { onClose: () => void }) {
  const sessions = useStore((s) => s.sessions);
  const order = useStore((s) => s.order);
  const tabs = useStore((s) => s.tabs);
  const activeTab = useStore((s) => s.activeTab);
  const activity = useStore((s) => s.activity);
  const addToView = useStore((s) => s.addToView);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState("");
  const filterRef = useRef<HTMLInputElement | null>(null);

  const tab = tabs.find((t) => t.id === activeTab);
  const candidates = useMemo(() => {
    const shown = new Set(viewSessionIds(tab, order, sessions));
    const q = query.trim().toLowerCase();
    return order
      .filter((id) => sessions[id] && !shown.has(id))
      .filter((id) => {
        if (!q) return true;
        const info = sessions[id]!;
        return `${info.alias ?? ""} ${info.cwd} ${info.host} ${activity[id]?.claudeName ?? ""}`
          .toLowerCase()
          .includes(q);
      });
  }, [tab, order, sessions, activity, query]);

  // Esc closes. Captured, so it resolves before the terminal focus handler and
  // does not also send Escape into a running session.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey, true);
    filterRef.current?.focus();
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  const toggle = (id: string) =>
    setPicked((p) => {
      const next = new Set(p);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const allPicked = candidates.length > 0 && candidates.every((id) => picked.has(id));

  return (
    <div style={backdrop} onMouseDown={onClose} role="presentation">
      <div
        style={box}
        role="dialog"
        aria-modal="true"
        aria-label="Add sessions to this view"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
          <strong style={{ fontSize: 13.5 }}>Add sessions to “{tab?.name}”</strong>
          <span style={{ flex: 1 }} />
          <button
            style={link}
            disabled={candidates.length === 0}
            onClick={() => setPicked(allPicked ? new Set() : new Set(candidates))}
          >
            {allPicked ? "Clear" : "Select all"}
          </button>
        </div>
        <input
          ref={filterRef}
          value={query}
          placeholder="filter by name, folder or host"
          onChange={(e) => setQuery(e.target.value)}
          style={filter}
        />
        <div style={list}>
          {candidates.length === 0 && (
            <p style={{ margin: 0, padding: 10, fontSize: 12, color: "#6a6a73" }}>
              {order.length === 0
                ? "No sessions yet. Create a terminal and it joins this view."
                : query
                  ? "Nothing matches."
                  : "Every session is already in this view."}
            </p>
          )}
          {candidates.map((id) => {
            const info = sessions[id]!;
            const a = activity[id];
            return (
              <label key={id} style={row}>
                <input
                  type="checkbox"
                  checked={picked.has(id)}
                  onChange={() => toggle(id)}
                />
                <span
                  style={{
                    width: 7,
                    height: 7,
                    borderRadius: 999,
                    background: TONE[a?.activity ?? "unknown"] ?? TONE.unknown,
                    flexShrink: 0,
                  }}
                />
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span style={rowTitle}>
                    {info.alias ||
                      info.cwd.split("/").filter(Boolean).pop() ||
                      "terminal"}
                  </span>
                  <span style={rowPath} title={info.cwd}>
                    {short(info.cwd)}
                    {a?.claudeName ? ` · ${a.claudeName}` : ""}
                  </span>
                </span>
                <span style={{ ...hostTag, ...hostColour(info.host) }}>{info.host}</span>
              </label>
            );
          })}
        </div>
        <p style={hint}>
          Sessions started outside the viewer are attached from the main view.
        </p>
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <button style={btn} onClick={onClose}>
            Cancel
          </button>
          <button
            style={{ ...btn, background: "#1d3a6b", borderColor: "#2f5ba8" }}
            disabled={picked.size === 0}
            onClick={() => {
              addToView([...picked]);
              onClose();
            }}
          >
            {picked.size === 0 ? "Add" : `Add ${picked.size}`}
          </button>
        </div>
      </div>
    </div>
  );
}

const backdrop: React.CSSProperties = {
  position: "fixed",
  inset: 0,
  background: "#05050799",
  backdropFilter: "blur(2px)",
  display: "grid",
  placeItems: "center",
  zIndex: 1000,
};

const box: React.CSSProperties = {
  width: "min(480px, calc(100vw - 32px))",
  maxHeight: "min(560px, calc(100vh - 48px))",
  display: "flex",
  flexDirection: "column",
  background: "#15151a",
  border: "1px solid #2f2f39",
  borderRadius: 12,
  padding: "16px 18px",
  boxShadow: "0 18px 50px #000000aa",
};

const filter: React.CSSProperties = {
  background: "#0e0e11",
  border: "1px solid #2a2a32",
  borderRadius: 6,
  color: "#e6e6e6",
  font: "inherit",
  fontSize: 12.5,
  padding: "6px 9px",
  marginBottom: 8,
};

const list: React.CSSProperties = {
  overflowY: "auto",
  minHeight: 60,
  border: "1px solid #24242a",
  borderRadius: 8,
  background: "#111113",
};

const row: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 9,
  padding: "7px 10px",
  borderBottom: "1px solid #1c1c22",
  cursor: "pointer",
};

const rowTitle: React.CSSProperties = {
  display: "block",
  fontSize: 12.5,
  fontWeight: 600,
  whiteSpace: "nowrap",
  overflow: "hidden",
  textOverflow: "ellipsis",
};

const rowPath: React.CSSProperties = {
  display: "block",
  fontSize: 11,
  color: "#80808a",
  whiteSpace: "nowrap",
  overflow: "hidden",
  textOverflow: "ellipsis",
};

const hostTag: React.CSSProperties = {
  fontSize: 10,
  padding: "1px 6px",
  borderRadius: 999,
  border: "1px solid",
  flexShrink: 0,
};

const hint: React.CSSProperties = {
  margin: "8px 0 12px",
  fontSize: 11,
  color: "#5c5c65",
};

const btn: React.CSSProperties = {
  background: "#22222a",
  border: "1px solid #33333d",
  color: "#e6e6e6",
  borderRadius: 6,
  padding: "6px 13px",
  cursor: "pointer",
  font: "inherit",
  fontSize: 12.5,
};

const link: React.CSSProperties = {
  background: "transparent",
  border: "none",
  color: "#8fc0f0",
  cursor: "pointer",
  font: "inherit",
  fontSize: 11.5,
};
