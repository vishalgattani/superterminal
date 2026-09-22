import type { Activity, Orphan } from "../store.ts";
import { externalOrphans, useStore } from "../store.ts";
import { ForeignActions, short } from "./ForeignActions.tsx";
import { hostStyle as hostColour } from "../lib/hostColour.ts";
import { isRemoteHost } from "@cv/shared";

/**
 * Sessions grouped by what they are doing.
 *
 * Three columns, matching the question "which of these needs me?".
 * Deliberately not a column for the instance light: that is one value for the
 * whole machine, so it lives in the header and cannot sort sessions.
 *
 * A fourth column appears only when needed, for terminals with no Claude in
 * them. Hiding those would make sessions vanish from the board.
 */
const COLUMNS: { key: Activity | "shell"; title: string; hint: string; accent: string }[] = [
  { key: "waiting", title: "Waiting for input", hint: "needs you", accent: "#e0a33e" },
  { key: "working", title: "Working", hint: "Claude is busy", accent: "#5b8cff" },
  { key: "idle", title: "Idle", hint: "finished, no prompt", accent: "#7fd28c" },
  { key: "shell", title: "Shell", hint: "no Claude running", accent: "#6a6a73" },
];

export function Kanban() {
  const sessions = useStore((s) => s.sessions);
  const order = useStore((s) => s.order);
  const activity = useStore((s) => s.activity);
  const exited = useStore((s) => s.exited);
  const openSessionId = useStore((s) => s.openSessionId);
  const toggleOpen = useStore((s) => s.toggleOpen);
  const askClose = useStore((s) => s.askClose);
  const reattach = useStore((s) => s.reattach);
  const orphans = useStore((s) => s.orphans);
  // Live sessions the viewer did not start. They belong on this board more than
  // anywhere: "which of these needs me" is the question it answers, and a
  // background agent blocked on input is exactly such a session.
  const external = externalOrphans(orphans, sessions);
  const externalBucket = (o: Orphan): Activity =>
    o.activity === "waiting" || o.activity === "working" ? o.activity : "idle";

  const bucket = (id: string): Activity | "shell" => {
    if (exited[id]) return "shell";
    return activity[id]?.activity ?? "unknown";
  };

  const columns = COLUMNS.filter(
    (c) => c.key !== "shell" || order.some((id) => bucket(id) === "shell"),
  );

  return (
    <div style={board}>
      {columns.map((col) => {
        const foreign = external.filter((o) => externalBucket(o) === col.key);
        const ids = order.filter(
          (id) =>
            bucket(id) === col.key ||
            // "unknown" means we have not heard yet; park it with idle rather
            // than inventing a column for a transient state.
            (col.key === "idle" && bucket(id) === "unknown"),
        );
        return (
          <section key={col.key} style={column}>
            <header style={{ ...columnHead, borderColor: col.accent }}>
              <strong style={{ fontSize: 12 }}>{col.title}</strong>
              <span style={{ color: "#6a6a73", fontSize: 11 }}>
                {ids.length + foreign.length}
              </span>
              <span style={{ flex: 1 }} />
              <span style={{ color: "#5c5c65", fontSize: 10.5 }}>{col.hint}</span>
            </header>
            <div style={cards}>
              {ids.length + foreign.length === 0 && <p style={empty}>nothing here</p>}
              {ids.map((id) => {
                const info = sessions[id];
                if (!info) return null;
                const act = activity[id];
                const isOpen = openSessionId === id;
                return (
                  <article
                    key={id}
                    onClick={() => toggleOpen(id)}
                    style={{
                      ...card,
                      borderColor: isOpen ? "#5b8cff" : "#2a2a32",
                      opacity: exited[id] ? 0.6 : 1,
                    }}
                  >
                    <div style={cardTop}>
                      <span
                        style={{
                          ...dot,
                          background: exited[id] ? "#6a6a73" : col.accent,
                        }}
                      />
                      <strong style={cardTitle}>
                        {info.alias || info.cwd.split("/").filter(Boolean).pop()}
                      </strong>
                      <button
                        title="Close this session"
                        onClick={(e) => {
                          e.stopPropagation();
                          askClose(id);
                        }}
                        style={closeBtn}
                      >
                        ×
                      </button>
                    </div>
                    <div style={cardPath} title={info.cwd}>
                      {info.cwd.replace(/^\/(Users|home)\/[^/]+/, "~")}
                    </div>
                    <div style={cardMeta}>
                      <span style={{ ...hostPill, ...hostColour(info.host) }}>
                        {info.host}
                      </span>
                      {act?.waitingFor && (
                        <span style={{ color: "#e0a33e" }}>{act.waitingFor}</span>
                      )}
                      {act?.kind === "background" && (
                        <span style={{ color: "#8a8a93" }}>background</span>
                      )}
                      {exited[id] && isRemoteHost(info.host) && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            void reattach(id);
                          }}
                          style={reattachBtn}
                        >
                          Reattach
                        </button>
                      )}
                    </div>
                    {/* Claude's own title, when it differs from the alias.
                        Useful because Claude names a session after the work. */}
                    {act?.claudeName && act.claudeName !== info.alias && (
                      <div style={claudeName} title={act.claudeName}>
                        {act.claudeName}
                      </div>
                    )}
                  </article>
                );
              })}
              {foreign.map((o) => (
                <article
                  key={`${o.host}:${o.sessionId}`}
                  style={{ ...card, cursor: "default", borderStyle: "dashed", background: "#131318" }}
                >
                  <div style={cardTop}>
                    <span style={{ ...dot, background: col.accent }} />
                    <strong style={cardTitle}>{o.name || o.sessionId.slice(0, 8)}</strong>
                    <span style={extTag}>external</span>
                  </div>
                  <div style={cardPath} title={o.cwd}>
                    {short(o.cwd)}
                  </div>
                  <div style={cardMeta}>
                    <span style={{ ...hostPill, ...hostColour(o.host) }}>{o.host}</span>
                    {o.waitingFor && <span style={{ color: "#e0a33e" }}>{o.waitingFor}</span>}
                    {o.kind === "background" && (
                      <span style={{ color: "#8a8a93" }}>background</span>
                    )}
                    {o.isViewer && <span style={{ color: "#8a8a93" }}>this viewer</span>}
                  </div>
                  <ForeignActions o={o} />
                </article>
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}

const board: React.CSSProperties = {
  display: "flex",
  gap: 12,
  padding: 12,
  height: "100%",
  boxSizing: "border-box",
  overflowX: "auto",
  background: "#0e0e11",
};

const column: React.CSSProperties = {
  flex: "1 1 0",
  minWidth: 220,
  display: "flex",
  flexDirection: "column",
  background: "#111113",
  border: "1px solid #24242a",
  borderRadius: 10,
  overflow: "hidden",
};

const columnHead: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 7,
  padding: "8px 10px",
  borderBottom: "2px solid",
  background: "#15151a",
};

const cards: React.CSSProperties = {
  padding: 8,
  display: "grid",
  gap: 8,
  alignContent: "start",
  overflowY: "auto",
  flex: 1,
};

const card: React.CSSProperties = {
  background: "#15151a",
  border: "1px solid #2a2a32",
  borderRadius: 8,
  padding: "8px 10px",
  cursor: "pointer",
  display: "grid",
  gap: 4,
};

const cardTop: React.CSSProperties = { display: "flex", alignItems: "center", gap: 6 };
const dot: React.CSSProperties = { width: 7, height: 7, borderRadius: 999, flexShrink: 0 };
const cardTitle: React.CSSProperties = {
  fontSize: 12.5,
  flex: 1,
  whiteSpace: "nowrap",
  overflow: "hidden",
  textOverflow: "ellipsis",
};
const cardPath: React.CSSProperties = {
  fontSize: 11,
  color: "#9a9aa3",
  whiteSpace: "nowrap",
  overflow: "hidden",
  textOverflow: "ellipsis",
};
const cardMeta: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 6,
  fontSize: 10.5,
  flexWrap: "wrap",
};
const claudeName: React.CSSProperties = {
  fontSize: 10.5,
  color: "#7a7a84",
  fontStyle: "italic",
  whiteSpace: "nowrap",
  overflow: "hidden",
  textOverflow: "ellipsis",
};
const hostPill: React.CSSProperties = {
  fontSize: 10,
  padding: "1px 6px",
  borderRadius: 999,
  border: "1px solid",
};
const closeBtn: React.CSSProperties = {
  width: 17,
  height: 17,
  lineHeight: "14px",
  padding: 0,
  borderRadius: 4,
  border: "1px solid #33333d",
  background: "#1c1c23",
  color: "#9a9aa3",
  cursor: "pointer",
  fontSize: 14,
};
const reattachBtn: React.CSSProperties = {
  background: "#1d2b3f",
  border: "1px solid #2f4a6b",
  color: "#8fc0f0",
  borderRadius: 4,
  padding: "1px 7px",
  cursor: "pointer",
  font: "inherit",
  fontSize: 10,
};
const extTag: React.CSSProperties = {
  fontSize: 9.5,
  padding: "0 5px",
  borderRadius: 999,
  border: "1px solid #33333d",
  color: "#8a8a93",
};
const empty: React.CSSProperties = {
  margin: 0,
  padding: "10px 2px",
  color: "#4f4f58",
  fontSize: 11,
};
