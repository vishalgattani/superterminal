import { useEffect, useRef, useState } from "react";
import { OVERVIEW_TAB, useStore, viewSessionIds } from "../store.ts";

/**
 * Tab bar for graph views, in the manner of a macOS terminal.
 *
 * The first tab, main, is the overview and always shows every session. Any
 * other tab is a view: a subset of sessions the owner chose, with its own
 * layout and frames. A session is not owned by a tab, so closing a view never
 * touches a terminal; it only stops showing that selection.
 */
export function GraphTabs() {
  const tabs = useStore((s) => s.tabs);
  const activeTab = useStore((s) => s.activeTab);
  const setActiveTab = useStore((s) => s.setActiveTab);
  const addTab = useStore((s) => s.addTab);
  const closeTab = useStore((s) => s.closeTab);
  const renameTab = useStore((s) => s.renameTab);
  const duplicateTab = useStore((s) => s.duplicateTab);
  const [dupe, setDupe] = useState<string | null>(null);
  const order = useStore((s) => s.order);
  const sessions = useStore((s) => s.sessions);
  const activity = useStore((s) => s.activity);
  // Sessions and Claudes in the tab being duplicated, not in the whole app.
  const dupeIds = viewSessionIds(tabs.find((t) => t.id === dupe), order, sessions);
  const sessionCount = dupeIds.length;
  const claudeCount = dupeIds.filter((id) => activity[id]?.claudeSessionId).length;
  const [working, setWorking] = useState(false);

  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (editing) requestAnimationFrame(() => inputRef.current?.select());
  }, [editing]);

  const commit = () => {
    if (editing) renameTab(editing, draft.trim() || "untitled");
    setEditing(null);
  };

  return (
    <div style={bar} role="tablist">
      {tabs.map((t) => {
        const active = t.id === activeTab;
        return (
          <div
            key={t.id}
            role="tab"
            aria-selected={active}
            onClick={() => setActiveTab(t.id)}
            onDoubleClick={() => {
              setEditing(t.id);
              setDraft(t.name);
            }}
            title={
              t.id === OVERVIEW_TAB
                ? "Every session · right-click to duplicate"
                : "Double-click to rename · right-click to duplicate"
            }
            onContextMenu={(e) => {
              e.preventDefault();
              setDupe(t.id);
            }}
            style={{
              ...tab,
              background: active ? "#15151a" : "transparent",
              color: active ? "#e6e6e6" : "#80808a",
              borderBottomColor: active ? "#5b8cff" : "transparent",
            }}
          >
            {editing === t.id ? (
              <input
                ref={inputRef}
                autoFocus
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onBlur={commit}
                onKeyDown={(e) => {
                  e.stopPropagation();
                  if (e.key === "Enter") commit();
                  if (e.key === "Escape") setEditing(null);
                }}
                onClick={(e) => e.stopPropagation()}
                style={input}
              />
            ) : (
              <span style={label}>{t.name}</span>
            )}
            {/* How many sessions a subset view shows. The overview shows all of
                them, so it carries no number. */}
            {t.members && editing !== t.id && (
              <span style={badge} title="Sessions in this view">
                {viewSessionIds(t, order, sessions).length}
              </span>
            )}
            {t.id !== OVERVIEW_TAB && editing !== t.id && (
              <button
                aria-label={`Close ${t.name}`}
                title="Close this view. Sessions are not affected."
                onClick={(e) => {
                  e.stopPropagation();
                  closeTab(t.id);
                }}
                style={close}
              >
                ×
              </button>
            )}
          </div>
        );
      })}

      <button style={plus} title="New view: choose which sessions to work with" aria-label="New graph view" onClick={() => addTab()}>
        +
      </button>

      {/* Duplicating asks what to copy, because the two answers differ a lot:
          one is free and instant, the other starts real sessions. */}
      {dupe && (
        <div style={backdrop} onMouseDown={() => !working && setDupe(null)}>
          <div style={dialog} onMouseDown={(e) => e.stopPropagation()}>
            <h2 style={{ margin: "0 0 6px", fontSize: 14 }}>
              Duplicate “{tabs.find((t) => t.id === dupe)?.name}”
            </h2>
            <p style={{ margin: "0 0 14px", fontSize: 12, color: "#9a9aa3" }}>
              {sessionCount} session{sessionCount === 1 ? "" : "s"} in this view,
              {" "}{claudeCount} running Claude.
            </p>

            <button
              style={choice}
              disabled={working}
              onClick={async () => {
                setWorking(true);
                await duplicateTab(dupe, "layout");
                setWorking(false);
                setDupe(null);
              }}
            >
              <strong style={{ fontSize: 12.5 }}>Connections only</strong>
              <span style={sub}>
                A second arrangement of the same terminals. Nothing is spawned,
                so it costs nothing and is instant.
              </span>
            </button>

            <button
              style={choice}
              disabled={working}
              onClick={async () => {
                setWorking(true);
                await duplicateTab(dupe, "sessions");
                setWorking(false);
                setDupe(null);
              }}
            >
              <strong style={{ fontSize: 12.5 }}>
                {working ? "Spawning…" : "New Claude sessions"}
              </strong>
              <span style={sub}>
                Spawns {sessionCount} fresh terminal{sessionCount === 1 ? "" : "s"} in
                the same folders, starts Claude where one runs now, and rewires the
                same connections.
              </span>
            </button>

            <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 4 }}>
              <button style={cancel} disabled={working} onClick={() => setDupe(null)}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const badge: React.CSSProperties = {
  fontSize: 10,
  padding: "0 5px",
  borderRadius: 999,
  background: "#22222c",
  color: "#9a9aa3",
  fontVariantNumeric: "tabular-nums",
};

const backdrop: React.CSSProperties = {
  position: "fixed",
  inset: 0,
  background: "#05050799",
  display: "grid",
  placeItems: "center",
  zIndex: 1000,
};

const dialog: React.CSSProperties = {
  width: "min(420px, calc(100vw - 32px))",
  background: "#15151a",
  border: "1px solid #2f2f39",
  borderRadius: 12,
  padding: "16px 18px",
  display: "grid",
  gap: 8,
  textAlign: "left",
};

const choice: React.CSSProperties = {
  display: "grid",
  gap: 3,
  textAlign: "left",
  background: "#1c1c23",
  border: "1px solid #2f2f39",
  borderRadius: 8,
  padding: "9px 11px",
  cursor: "pointer",
  color: "#e6e6e6",
  font: "inherit",
};

const sub: React.CSSProperties = { fontSize: 11, color: "#9a9aa3", lineHeight: 1.4 };

const cancel: React.CSSProperties = {
  background: "transparent",
  border: "1px solid #2f2f39",
  color: "#c9c9d1",
  borderRadius: 6,
  padding: "4px 11px",
  cursor: "pointer",
  font: "inherit",
  fontSize: 11.5,
};

const bar: React.CSSProperties = {
  display: "flex",
  alignItems: "stretch",
  gap: 1,
  background: "#0b0b0d",
  borderBottom: "1px solid #24242a",
  paddingLeft: 4,
  minHeight: 29,
  overflowX: "auto",
};

const tab: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 6,
  padding: "0 9px",
  cursor: "pointer",
  fontSize: 11.5,
  borderBottom: "2px solid transparent",
  borderRight: "1px solid #1a1a20",
  whiteSpace: "nowrap",
  minWidth: 84,
  maxWidth: 190,
};

const label: React.CSSProperties = {
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
};

const close: React.CSSProperties = {
  width: 15,
  height: 15,
  lineHeight: "12px",
  padding: 0,
  borderRadius: 3,
  border: "none",
  background: "transparent",
  color: "#6a6a73",
  cursor: "pointer",
  fontSize: 13,
  flexShrink: 0,
};

const plus: React.CSSProperties = {
  width: 27,
  border: "none",
  background: "transparent",
  color: "#8a8a93",
  cursor: "pointer",
  fontSize: 15,
  flexShrink: 0,
};

const input: React.CSSProperties = {
  background: "#0e0e11",
  border: "1px solid #5b8cff",
  borderRadius: 4,
  color: "#e6e6e6",
  font: "inherit",
  fontSize: 11.5,
  padding: "1px 4px",
  width: 120,
};
