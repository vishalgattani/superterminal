import { useStore, type MonitorInfo } from "../store.ts";
import { timeLeft } from "./SessionNode.tsx";

/**
 * Every Monitor a Claude session on this machine set up in the last day,
 * grouped by session, running first.
 *
 * Covers sessions that are not terminals here too: the watch belongs to the
 * Claude session, and a background agent's monitor is still one to know about.
 * A session that is a terminal here is named after it and opens on click.
 */
export function Monitors() {
  const monitors = useStore((s) => s.monitors);
  const sessions = useStore((s) => s.sessions);
  const activity = useStore((s) => s.activity);
  const toggleOpen = useStore((s) => s.toggleOpen);
  const setView = useStore((s) => s.setView);

  const terminalOf = (claudeSessionId: string) =>
    Object.keys(activity).find((id) => activity[id]?.claudeSessionId === claudeSessionId);

  const groups = new Map<string, MonitorInfo[]>();
  for (const m of monitors) {
    const g = groups.get(m.claudeSessionId) ?? [];
    g.push(m);
    groups.set(m.claudeSessionId, g);
  }
  const running = (g: MonitorInfo[]) => g.filter((m) => m.running).length;
  const ordered = [...groups.entries()].sort(
    ([, a], [, b]) => running(b) - running(a) || b[0]!.startedAt - a[0]!.startedAt,
  );

  return (
    <div style={page}>
      <div style={{ fontSize: 11, color: "#8a8a93" }}>
        Monitors Claude sessions set up in the last 24h, read from their transcripts. Running means
        no end seen and not past its expiry.
      </div>
      {ordered.length === 0 && <p style={empty}>No monitors in the last 24h.</p>}
      {ordered.map(([sid, list]) => {
        const term = terminalOf(sid);
        const info = term ? sessions[term] : undefined;
        const cwd = list[0]!.cwd ?? "";
        return (
          <section key={sid} style={group}>
            <header style={groupHead}>
              <strong style={{ fontSize: 12.5 }}>
                {info?.alias || cwd.split("/").filter(Boolean).pop() || "session"}
              </strong>
              <span style={idTag}>◆ {sid.slice(0, 8)}</span>
              <span style={{ color: "#6a6a73", fontSize: 11 }}>
                {running(list)} running · {list.length} total
              </span>
              <span style={{ flex: 1 }} />
              {term ? (
                <button
                  style={openBtn}
                  onClick={() => {
                    setView("graph");
                    toggleOpen(term);
                  }}
                >
                  Open terminal
                </button>
              ) : (
                <span style={{ color: "#5c5c65", fontSize: 10.5 }}>not a terminal here</span>
              )}
            </header>
            {list
              .slice()
              .sort((a, b) => Number(b.running) - Number(a.running) || b.startedAt - a.startedAt)
              .map((m) => (
                <div key={m.taskId} style={{ ...row, opacity: m.running ? 1 : 0.55 }}>
                  <span style={{ ...dot, background: m.running ? "#e0c080" : "#4f4f58" }} />
                  <code style={task}>{m.taskId}</code>
                  <span style={desc} title={m.description}>
                    {m.description}
                    {m.lastEvent && <span style={event}> — {m.lastEvent}</span>}
                  </span>
                  <span style={when}>
                    {m.running
                      ? timeLeft(m.expiresAt)
                      : m.endedAt
                        ? `ended ${clock(m.endedAt)}`
                        : `expired ${clock(m.expiresAt!)}`}
                  </span>
                  <span style={when}>started {clock(m.startedAt)}</span>
                </div>
              ))}
          </section>
        );
      })}
    </div>
  );
}

function clock(t: number): string {
  return new Date(t).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

const page: React.CSSProperties = {
  height: "100%",
  overflowY: "auto",
  padding: 12,
  boxSizing: "border-box",
  display: "grid",
  gap: 10,
  alignContent: "start",
  background: "#0e0e11",
};
const group: React.CSSProperties = {
  background: "#111113",
  border: "1px solid #24242a",
  borderRadius: 10,
  overflow: "hidden",
};
const groupHead: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  padding: "8px 10px",
  background: "#15151a",
  borderBottom: "1px solid #24242a",
};
const row: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  padding: "6px 10px",
  fontSize: 11.5,
  borderBottom: "1px solid #1b1b21",
};
const dot: React.CSSProperties = { width: 7, height: 7, borderRadius: 999, flexShrink: 0 };
const task: React.CSSProperties = { fontSize: 10.5, color: "#8fc0f0" };
const desc: React.CSSProperties = {
  flex: 1,
  minWidth: 0,
  whiteSpace: "nowrap",
  overflow: "hidden",
  textOverflow: "ellipsis",
  color: "#d0d0d8",
};
const event: React.CSSProperties = { color: "#8a8a93" };
const when: React.CSSProperties = { fontSize: 10.5, color: "#7a7a84", whiteSpace: "nowrap" };
const idTag: React.CSSProperties = {
  fontSize: 10,
  color: "#8fc0f0",
  fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
};
const openBtn: React.CSSProperties = {
  background: "#1d2b3f",
  border: "1px solid #2f4a6b",
  color: "#8fc0f0",
  borderRadius: 4,
  padding: "2px 8px",
  cursor: "pointer",
  fontSize: 10.5,
};
const empty: React.CSSProperties = { margin: 0, color: "#4f4f58", fontSize: 11 };
