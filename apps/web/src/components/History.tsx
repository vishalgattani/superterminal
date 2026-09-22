import { useCallback, useEffect, useMemo, useState } from "react";
import type { HostId } from "@cv/shared";
import { useStore } from "../store.ts";

interface TranscriptRow {
  sessionId: string;
  path: string;
  cwd?: string;
  gitBranch?: string;
  title?: string;
  firstPrompt?: string;
  lastModified: number;
  bytes: number;
  recentUserTurns: number;
  subagents: number;
  host: HostId;
  /** True when a Claude process is running this session right now. */
  live?: boolean;
  liveStatus?: string;
  liveKind?: string;
}

interface Usage {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  models: string[];
}

interface Entry {
  role: string;
  text?: string;
  tool?: string;
  ts?: string;
}

const short = (p?: string) =>
  (p ?? "?").replace(/^\/(Users|home)\/[^/]+/, "~");

function when(ms: number): string {
  const mins = Math.round((Date.now() - ms) / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return new Date(ms).toLocaleDateString();
}

const fmt = (n: number) =>
  n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}K` : String(n);

/**
 * Browse past sessions.
 *
 * Sessions only: subagent transcripts are counted against their parent, never
 * listed as sessions. Counting every .jsonl would show 365 "sessions" on fire
 * where there are 48.
 */
export function History() {
  const token = useStore((s) => s.token);
  const hosts = useStore((s) => s.hosts);
  const resumeSession = useStore((s) => s.resumeSession);

  const [host, setHost] = useState<HostId>("local");
  const [rows, setRows] = useState<TranscriptRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [only, setOnly] = useState<"all" | "active" | "inactive">("all");
  const [selected, setSelected] = useState<TranscriptRow | null>(null);
  const [entries, setEntries] = useState<Entry[] | null>(null);
  const [usage, setUsage] = useState<Usage | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const load = useCallback(
    async (h: HostId, refresh = false) => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(
          `/api/transcripts?host=${h}${refresh ? "&refresh=1" : ""}`,
          { headers: { Authorization: `Bearer ${token}` } },
        );
        const body = await res.json();
        setRows(body.sessions ?? []);
        setTotal(body.total ?? 0);
        if (body.error) setError(body.error);
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setLoading(false);
      }
    },
    [token],
  );

  useEffect(() => {
    void load(host);
  }, [host, load]);

  const openDetail = useCallback(
    async (row: TranscriptRow) => {
      setSelected(row);
      setEntries(null);
      setUsage(null);
      setDetailLoading(true);
      try {
        const res = await fetch(
          `/api/transcripts/detail?host=${row.host}&path=${encodeURIComponent(row.path)}`,
          { headers: { Authorization: `Bearer ${token}` } },
        );
        const body = await res.json();
        setEntries(body.entries ?? []);
        setUsage(body.usage ?? null);
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setDetailLoading(false);
      }
    },
    [token],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter((r) => {
      if (only === "active" && !r.live) return false;
      if (only === "inactive" && r.live) return false;
      if (!q) return true;
      return [r.title, r.firstPrompt, r.cwd, r.gitBranch, r.sessionId]
        .filter(Boolean)
        .some((v) => v!.toLowerCase().includes(q));
    });
  }, [rows, query, only]);

  const liveCount = rows.filter((r) => r.live).length;

  return (
    <div style={wrap}>
      {/* The list takes the full width until a session is picked: opening an
          empty reading pane just to say "pick something" wastes half the
          screen and makes the list harder to scan. */}
      <div style={{ ...listPane, width: selected ? "min(42%, 460px)" : "100%", borderRight: selected ? "1px solid #24242a" : "none" }}>
        <div style={toolbar}>
          <select
            value={host}
            onChange={(e) => setHost(e.target.value as HostId)}
            style={input}
          >
            {hosts.map((h) => (
              <option key={h.id} value={h.id}>
                {h.id}
              </option>
            ))}
          </select>
          <input
            style={{ ...input, flex: 1 }}
            placeholder="search prompt, title, folder, branch…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <button style={button} onClick={() => void load(host, true)}>
            {loading ? "…" : "Rescan"}
          </button>
        </div>
        <div style={filterRow}>
          {(["all", "active", "inactive"] as const).map((k) => (
            <button
              key={k}
              onClick={() => setOnly(k)}
              style={{
                ...chip,
                background: only === k ? "#22222c" : "transparent",
                color: only === k ? "#e6e6e6" : "#7a7a84",
                borderColor: only === k ? "#3a3a46" : "#24242a",
              }}
            >
              {k}
              <span style={{ color: "#6a6a73", marginLeft: 5 }}>
                {k === "all"
                  ? rows.length
                  : k === "active"
                    ? liveCount
                    : rows.length - liveCount}
              </span>
            </button>
          ))}
        </div>
        <div style={countLine}>
          {loading
            ? "scanning…"
            : `${filtered.length} of ${total} session${total === 1 ? "" : "s"}` +
              (rows.reduce((n, r) => n + r.subagents, 0)
                ? ` · ${rows.reduce((n, r) => n + r.subagents, 0)} subagent transcripts`
                : "")}
        </div>
        {error && <p style={warn}>{error}</p>}

        <div style={list}>
          {filtered.map((r) => (
            <article
              key={r.sessionId}
              onClick={() => void openDetail(r)}
              style={{
                ...row,
                borderColor:
                  selected?.sessionId === r.sessionId ? "#5b8cff" : "#24242a",
              }}
            >
              <div style={rowTop}>
                {r.live && (
                  <span
                    style={liveDot}
                    title={`running now${r.liveStatus ? `: ${r.liveStatus}` : ""}`}
                  />
                )}
                <strong style={rowTitle}>
                  {r.title || r.firstPrompt?.split("\n")[0] || r.sessionId.slice(0, 8)}
                </strong>
                <span style={{ color: "#6a6a73", fontSize: 10.5 }}>
                  {when(r.lastModified)}
                </span>
              </div>
              <div style={rowMeta}>
                <span title={r.cwd}>{short(r.cwd)}</span>
                {r.gitBranch && <span style={branch}>{r.gitBranch}</span>}
                {r.subagents > 0 && (
                  <span style={{ color: "#8a8a93" }}>{r.subagents} subagents</span>
                )}
                <span style={{ color: "#4f4f58" }}>{(r.bytes / 1024).toFixed(0)} KB</span>
              </div>
            </article>
          ))}
          {!loading && filtered.length === 0 && (
            <p style={{ color: "#5c5c65", fontSize: 12, padding: 10 }}>
              No sessions match.
            </p>
          )}
        </div>
      </div>

      {selected && (
        <div style={detailPane}>
          <>
            <div style={detailHead}>
              <div style={{ minWidth: 0 }}>
                <strong style={{ fontSize: 13 }}>
                  {selected.title || selected.sessionId.slice(0, 8)}
                </strong>
                <div style={{ color: "#80808a", fontSize: 11 }} title={selected.cwd}>
                  {selected.host} · {short(selected.cwd)}
                  {selected.gitBranch ? ` · ${selected.gitBranch}` : ""}
                </div>
              </div>
              <span style={{ flex: 1 }} />
              <button
                style={button}
                onClick={() =>
                  void resumeSession(selected.host, selected.cwd ?? "", selected.sessionId)
                }
                title="Open a terminal running claude --resume for this session"
              >
                Resume
              </button>
              <button
                style={button}
                onClick={() => {
                  setSelected(null);
                  setEntries(null);
                  setUsage(null);
                }}
                title="Back to the full list"
              >
                Close
              </button>
            </div>

            {usage && (
              <div style={usageBar}>
                <span title="Fresh input tokens">in {fmt(usage.input)}</span>
                <span title="Output tokens">out {fmt(usage.output)}</span>
                <span title="Cache reads, far cheaper than fresh input">
                  cache read {fmt(usage.cacheRead)}
                </span>
                <span title="Cache writes">cache write {fmt(usage.cacheWrite)}</span>
                {usage.models.filter((m) => !m.startsWith("<")).map((m) => (
                  <span key={m} style={modelPill}>
                    {m}
                  </span>
                ))}
              </div>
            )}

            <div style={entriesBox}>
              {detailLoading && <p style={{ color: "#6a6a73" }}>reading…</p>}
              {entries?.map((e, i) => (
                <div key={i} style={entryRow}>
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
                    <span style={entryText}>{e.text}</span>
                  )}
                </div>
              ))}
              {entries?.length === 0 && (
                <p style={{ color: "#6a6a73" }}>Nothing readable in this transcript.</p>
              )}
            </div>
          </>
        </div>
      )}
    </div>
  );
}

const wrap: React.CSSProperties = { display: "flex", height: "100%", minHeight: 0 };
const listPane: React.CSSProperties = {
  width: "min(42%, 460px)",
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
const toolbar: React.CSSProperties = {
  display: "flex",
  gap: 6,
  padding: 8,
  borderBottom: "1px solid #24242a",
};
const countLine: React.CSSProperties = {
  padding: "5px 10px",
  fontSize: 11,
  color: "#7a7a84",
  borderBottom: "1px solid #1c1c22",
};
const list: React.CSSProperties = { overflowY: "auto", padding: 8, display: "grid", gap: 6 };
const row: React.CSSProperties = {
  border: "1px solid #24242a",
  borderRadius: 8,
  padding: "7px 9px",
  background: "#15151a",
  cursor: "pointer",
  display: "grid",
  gap: 3,
};
const rowTop: React.CSSProperties = { display: "flex", gap: 8, alignItems: "baseline" };
const rowTitle: React.CSSProperties = {
  fontSize: 12,
  flex: 1,
  whiteSpace: "nowrap",
  overflow: "hidden",
  textOverflow: "ellipsis",
};
const rowMeta: React.CSSProperties = {
  display: "flex",
  gap: 8,
  fontSize: 10.5,
  color: "#9a9aa3",
  flexWrap: "wrap",
};
const branch: React.CSSProperties = { color: "#d29a7f" };
const liveDot: React.CSSProperties = {
  width: 7,
  height: 7,
  borderRadius: 999,
  background: "#7fd28c",
  flexShrink: 0,
};
const filterRow: React.CSSProperties = {
  display: "flex",
  gap: 6,
  padding: "6px 8px 0",
};
const chip: React.CSSProperties = {
  border: "1px solid #24242a",
  borderRadius: 999,
  padding: "2px 9px",
  cursor: "pointer",
  font: "inherit",
  fontSize: 11,
};
const detailHead: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 10,
  padding: "9px 12px",
  borderBottom: "1px solid #24242a",
};
const usageBar: React.CSSProperties = {
  display: "flex",
  gap: 12,
  flexWrap: "wrap",
  padding: "6px 12px",
  borderBottom: "1px solid #1c1c22",
  fontSize: 11,
  color: "#8a8a93",
  fontVariantNumeric: "tabular-nums",
};
const modelPill: React.CSSProperties = {
  color: "#c3c3cb",
  background: "#1c1c23",
  border: "1px solid #2f2f39",
  borderRadius: 999,
  padding: "0 7px",
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
const entryRow: React.CSSProperties = { display: "flex", gap: 9, alignItems: "baseline" };
const roleTag: React.CSSProperties = {
  fontSize: 10,
  minWidth: 44,
  flexShrink: 0,
  textTransform: "uppercase",
  letterSpacing: 0.3,
};
const entryText: React.CSSProperties = {
  whiteSpace: "pre-wrap",
  wordBreak: "break-word",
  color: "#d0d0d8",
};
const input: React.CSSProperties = {
  background: "#15151a",
  border: "1px solid #2a2a32",
  color: "#e6e6e6",
  borderRadius: 6,
  padding: "4px 7px",
  font: "inherit",
  fontSize: 12,
};
const button: React.CSSProperties = { ...input, cursor: "pointer" };
const warn: React.CSSProperties = { padding: "6px 10px", color: "#e0a33e", fontSize: 11 };
