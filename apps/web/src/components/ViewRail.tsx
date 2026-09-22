import { useStore, type ViewMode } from "../store.ts";

/**
 * Left rail for switching views. Graph is the default; kanban answers
 * "which sessions need me?" without hunting across a canvas.
 */
const VIEWS: { key: ViewMode; glyph: string; label: string }[] = [
  { key: "graph", glyph: "◉", label: "Graph" },
  { key: "kanban", glyph: "▦", label: "Kanban" },
  { key: "agents", glyph: "◆", label: "Agents" },
  { key: "history", glyph: "◷", label: "History" },
];

export function ViewRail() {
  const view = useStore((s) => s.view);
  const setView = useStore((s) => s.setView);
  const activity = useStore((s) => s.activity);

  // Badge the kanban tab with what is waiting, so switching view is never
  // required to notice that something needs you.
  const waiting = Object.values(activity).filter(
    (a) => a.activity === "waiting",
  ).length;

  return (
    <nav style={rail}>
      {VIEWS.map((v) => {
        const active = view === v.key;
        return (
          <button
            key={v.key}
            title={v.label}
            onClick={() => setView(v.key)}
            style={{
              ...tab,
              background: active ? "#22222c" : "transparent",
              color: active ? "#e6e6e6" : "#7a7a84",
              borderLeftColor: active ? "#5b8cff" : "transparent",
            }}
          >
            <span style={{ fontSize: 15, lineHeight: 1 }}>{v.glyph}</span>
            <span style={{ fontSize: 9.5 }}>{v.label}</span>
            {v.key === "kanban" && waiting > 0 && (
              <span style={badge}>{waiting}</span>
            )}
          </button>
        );
      })}
    </nav>
  );
}

const rail: React.CSSProperties = {
  width: 54,
  flexShrink: 0,
  borderRight: "1px solid #24242a",
  background: "#0b0b0d",
  display: "flex",
  flexDirection: "column",
  paddingTop: 6,
  gap: 2,
};

const tab: React.CSSProperties = {
  position: "relative",
  border: "none",
  borderLeft: "2px solid transparent",
  padding: "9px 0",
  cursor: "pointer",
  display: "grid",
  justifyItems: "center",
  gap: 3,
  font: "inherit",
};

const badge: React.CSSProperties = {
  position: "absolute",
  top: 4,
  right: 7,
  minWidth: 14,
  height: 14,
  borderRadius: 999,
  background: "#e0a33e",
  color: "#1a1206",
  fontSize: 9,
  fontWeight: 700,
  lineHeight: "14px",
  textAlign: "center",
  padding: "0 3px",
};
