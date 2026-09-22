import { useCallback, useEffect, useState } from "react";
import { useStore, type Orphan } from "../store.ts";
import { hostStyle as hostColour } from "../lib/hostColour.ts";

interface Entry {
  role: string;
  text?: string;
  tool?: string;
}

const short = (p?: string) => (p ?? "?").replace(/^\/(Users|home)\/[^/]+/, "~");

const TONE: Record<string, string> = {
  waiting: "#e0a33e",
  working: "#5b8cff",
  idle: "#7fd28c",
  unknown: "#6a6a73",
};

/**
 * Every live Claude session on every host, including ones this viewer never
 * started, with what it is doing and what it has been saying.
 *
 * These were previously only a number in the stats bar, so a background agent
 * blocked on input was countable but unreachable.
 */
export function Agents() {
  const token = useStore((s) => s.token);
  const orphans = useStore((s) => s.orphans ?? []);
  const sessions = useStore((s) => s.sessions);
  const activity = useStore((s) => s.activity);
  const attachAgent = useStore((s) => s.attachAgent);
  const askStop = useStore((s) => s.askStop);

  const [selected, setSelected] = useState<Orphan | null>(null);
  const [entries, setEntries] = useState<Entry[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Sessions the viewer owns, shown alongside so the panel is the full list.
  const owned = Object.values(sessions)
    .map((s) => {
      const a = activity[s.sessionId];
      if (!a?.claudeSessionId) return null;
      return {
        host: s.host,
        sessionId: a.claudeSessionId,
        cwd: s.cwd,
        name: a.claudeName,
        kind: a.kind,
        activity: a.activity,
        waitingFor: a.waitingFor,
        attachable: true,
        owned: true,
        terminalId: s.sessionId,
      } as Orphan & { owned: true; terminalId: string };
    })
    .filter(Boolean) as (Orphan & { owned: true; terminalId: string })[];

  const all = [...owned, ...orphans];

  const readTranscript = useCallback(
    async (a: Orphan) => {
      setSelected(a);
      setEntries(null);
      setError(null);
      setLoading(true);
      try {
        // Ask by session id: the server resolves the real path from its
        // transcript index, rather than us reconstructing the layout.
        const res = await fetch(
          `/api/transcripts/detail?host=${a.host}&sessionId=${encodeURIComponent(a.sessionId)}`,
          { headers: { Authorization: `Bearer ${token}` } },
        );
        const body = await res.json();
        if (body.error) setError(body.error);
        setEntries(body.entries ?? []);
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setLoading(false);
      }
    },
    [token],
  );

  useEffect(() => {
    if (!selected) return;
    // Keep the open transcript fresh while the agent keeps working.
    const t = setInterval(() => void readTranscript(selected), 8000);
    return () => clearInterval(t);
  }, [selected?.sessionId]);

  return (
    <div style={wrap}>
      <div style={listPane}>
        <div style={head}>
          <strong style={{ fontSize: 12 }}>Live Claude sessions</strong>
          <span style={{ color: "#6a6a73", fontSize: 11 }}>{all.length}</span>
        </div>
        {error && <p style={warn}>{error}</p>}
        <div style={list}>
          {all.length === 0 && (
            <p style={{ color: "#5c5c65", fontSize: 12, padding: 10 }}>
              No Claude sessions running on any host.
            </p>
          )}
          {all.map((a) => (
            <article
              key={`${a.host}:${a.sessionId}`}
              onClick={() => void readTranscript(a)}
              style={{
                ...row,
                borderColor:
                  selected?.sessionId === a.sessionId ? "#5b8cff" : "#24242a",
              }}
            >
              <div style={rowTop}>
                <span
                  style={{
                    ...dot,
                    background: TONE[a.activity] ?? TONE.unknown,
                  }}
                />
                <strong style={rowTitle}>
                  {a.name || a.sessionId.slice(0, 8)}
                </strong>
                {a.isViewer && <span style={selfTag}>this viewer</span>}
                {a.kind === "background" && <span style={bgTag}>background</span>}
              </div>
              <div style={meta} title={a.cwd}>
                <span style={{ ...hostTag, ...hostColour(a.host) }}>{a.host}</span>
                {short(a.cwd)}
              </div>
              <div style={metaRow}>
                <span style={{ color: TONE[a.activity] ?? "#8a8a93" }}>
                  {a.waitingFor ? `waiting: ${a.waitingFor}` : a.activity}
                </span>
                <span style={{ flex: 1 }} />
                {"owned" in a ? (
                  <span style={{ color: "#6a6a73", fontSize: 10 }}>open here</span>
                ) : (
                  <>
                    {a.attachable && (
                      <button
                        style={btn}
                        disabled={busy === a.sessionId}
                        onClick={(e) => {
                          e.stopPropagation();
                          setBusy(a.sessionId);
                          void attachAgent(a).finally(() => setBusy(null));
                        }}
                      >
                        Attach
                      </button>
                    )}
                    <button
                      style={{
                        ...btn,
                        color: a.isViewer ? "#5c5c65" : "#e08a8a",
                        cursor: a.isViewer ? "not-allowed" : "pointer",
                      }}
                      disabled={a.isViewer}
                      title={
                        a.isViewer
                          ? "This is the session running the viewer"
                          : "Send SIGTERM so Claude can shut down cleanly"
                      }
                      onClick={(e) => {
                        e.stopPropagation();
                        askStop(a);
                      }}
                    >
                      Stop
                    </button>
                  </>
                )}
              </div>
            </article>
          ))}
        </div>
      </div>

      <div style={detailPane}>
        {!selected && (
          <p style={{ color: "#5c5c65", fontSize: 12, padding: 14 }}>
            Pick a session to see what it is doing.
          </p>
        )}
        {selected && (
          <>
            <div style={head}>
              <strong style={{ fontSize: 12.5 }}>
                {selected.name || selected.sessionId.slice(0, 8)}
              </strong>
              <span style={{ color: "#80808a", fontSize: 11 }}>
                {selected.host} · {short(selected.cwd)}
              </span>
              <span style={{ flex: 1 }} />
              <span style={{ color: "#6a6a73", fontSize: 10.5 }}>
                refreshes every 8s
              </span>
            </div>
            <div style={entriesBox}>
              {loading && !entries && <p style={{ color: "#6a6a73" }}>reading…</p>}
              {entries?.map((e, i) => (
                <div key={i} style={{ display: "flex", gap: 9 }}>
                  <span
                    style={{
                      ...roleTag,
                      color: e.role === "user" ? "#7fd28c" : "#8fc0f0",
                    }}
                  >
                    {e.role === "user" ? "you" : "claude"}
                  </span>
                  {e.tool ? (
                    <span style={{ color: "#9a7fd2" }}>⚙ {e.tool}</span>
                  ) : (
                    <span style={text}>{e.text}</span>
                  )}
                </div>
              ))}
              {entries?.length === 0 && !loading && (
                <p style={{ color: "#6a6a73" }}>
                  No transcript found for this session yet.
                </p>
              )}
            </div>
          </>
        )}
      </div>

    </div>
  );
}

const wrap: React.CSSProperties = { display: "flex", height: "100%", minHeight: 0 };
const listPane: React.CSSProperties = {
  width: "min(44%, 470px)",
  borderRight: "1px solid #24242a",
  display: "flex",
  flexDirection: "column",
  minHeight: 0,
};
const detailPane: React.CSSProperties = {
  flex: 1,
  minWidth: 0,
  display: "flex",
  flexDirection: "column",
  minHeight: 0,
};
const head: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 9,
  padding: "8px 11px",
  borderBottom: "1px solid #24242a",
};
const list: React.CSSProperties = {
  overflowY: "auto",
  padding: 8,
  display: "grid",
  gap: 7,
  alignContent: "start",
};
const row: React.CSSProperties = {
  border: "1px solid #24242a",
  borderRadius: 8,
  padding: "8px 10px",
  background: "#15151a",
  cursor: "pointer",
  display: "grid",
  gap: 5,
};
const rowTop: React.CSSProperties = { display: "flex", alignItems: "center", gap: 7 };
const dot: React.CSSProperties = { width: 7, height: 7, borderRadius: 999, flexShrink: 0 };
const rowTitle: React.CSSProperties = {
  fontSize: 12.5,
  whiteSpace: "nowrap",
  overflow: "hidden",
  textOverflow: "ellipsis",
};
const meta: React.CSSProperties = {
  display: "flex",
  gap: 7,
  alignItems: "center",
  fontSize: 11,
  color: "#9a9aa3",
  whiteSpace: "nowrap",
  overflow: "hidden",
  textOverflow: "ellipsis",
};
const metaRow: React.CSSProperties = {
  display: "flex",
  gap: 7,
  alignItems: "center",
  fontSize: 11,
};
const hostTag: React.CSSProperties = {
  fontSize: 10,
  padding: "1px 6px",
  borderRadius: 999,
  border: "1px solid",
};
const selfTag: React.CSSProperties = {
  fontSize: 9.5,
  color: "#8fc0f0",
  border: "1px solid #2f4a6b",
  background: "#1d2b3f",
  borderRadius: 999,
  padding: "0 6px",
};
const bgTag: React.CSSProperties = {
  fontSize: 9.5,
  color: "#9a9aa3",
  border: "1px solid #33333d",
  borderRadius: 999,
  padding: "0 6px",
};
const btn: React.CSSProperties = {
  background: "#1c1c23",
  border: "1px solid #2f2f39",
  color: "#c9c9d1",
  borderRadius: 5,
  padding: "2px 9px",
  cursor: "pointer",
  font: "inherit",
  fontSize: 11,
};
const entriesBox: React.CSSProperties = {
  overflowY: "auto",
  padding: 12,
  display: "grid",
  gap: 9,
  alignContent: "start",
  fontSize: 12,
  lineHeight: 1.5,
};
const roleTag: React.CSSProperties = {
  fontSize: 10,
  minWidth: 44,
  flexShrink: 0,
  textTransform: "uppercase",
};
const text: React.CSSProperties = {
  whiteSpace: "pre-wrap",
  wordBreak: "break-word",
  color: "#d0d0d8",
};
const warn: React.CSSProperties = { padding: "6px 10px", color: "#e0a33e", fontSize: 11 };
