import { useCallback, useEffect, useState } from "react";
import type { HostId, SessionInfo } from "@cv/shared";
import { Agents } from "./components/Agents.tsx";
import { CommandPalette } from "./components/CommandPalette.tsx";
import { ConfirmClose } from "./components/ConfirmClose.tsx";
import { ConfirmStop } from "./components/ConfirmStop.tsx";
import { Graph } from "./components/Graph.tsx";
import { GraphTabs } from "./components/GraphTabs.tsx";
import { HostSettings } from "./components/HostSettings.tsx";
import { InstanceLight } from "./components/InstanceLight.tsx";
import { History } from "./components/History.tsx";
import { Kanban } from "./components/Kanban.tsx";
import { Presets } from "./components/Presets.tsx";
import { StatsBar } from "./components/StatsBar.tsx";
import { ViewRail } from "./components/ViewRail.tsx";
import { TerminalPane } from "./components/TerminalPane.tsx";
import type { Metrics } from "./lib/termSocket.ts";
import { externalOrphans, useStore, type HostStatus } from "./store.ts";

const debug = new URLSearchParams(location.search).has("debug");

export default function App() {
  const token = useStore((s) => s.token);
  const hosts = useStore((s) => s.hosts);
  const defaultCwd = useStore((s) => s.defaultCwd);
  const sessions = useStore((s) => s.sessions);
  const order = useStore((s) => s.order);
  // External cards count as content: the canvas is not empty if they are on it.
  const externalCount = useStore((s) =>
    s.showForeign ? externalOrphans(s.orphans, s.sessions).length : 0,
  );
  const openSessionId = useStore((s) => s.openSessionId);
  const exited = useStore((s) => s.exited);
  const setHosts = useStore((s) => s.setHosts);
  const addSession = useStore((s) => s.addSession);
  const view = useStore((s) => s.view);
  const applyStatus = useStore((s) => s.applyStatus);
  const adoptSessions = useStore((s) => s.adoptSessions);
  const reconcile = useStore((s) => s.reconcile);
  const hydrateViews = useStore((s) => s.hydrateViews);
  const noteBoot = useStore((s) => s.noteBoot);
  const removeSession = useStore((s) => s.removeSession);
  const closePanel = useStore((s) => s.close);

  const [host, setHost] = useState<HostId>("local");
  const [cwd, setCwd] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [palette, setPalette] = useState(false);
  const [busy, setBusy] = useState(false);
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [showPresets, setShowPresets] = useState(false);
  const [showHosts, setShowHosts] = useState(false);

  const api = useCallback(
    async (path: string, init?: RequestInit) => {
      const res = await fetch(path, {
        ...init,
        headers: {
          ...(init?.headers ?? {}),
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? res.statusText);
      return body;
    },
    [token],
  );

  useEffect(() => {
    if (!token) return;
    api("/api/hosts")
      .then((b: { hosts: HostStatus[]; defaultCwd: string }) =>
        setHosts(b.hosts, b.defaultCwd),
      )
      .catch((e) => setError((e as Error).message));

    // Restore sessions the server still holds. Without this a page reload
    // shows an empty graph while the shells are alive and unreachable, which
    // looks exactly like having lost them.
    api("/api/sessions")
      .then((b: { sessions: SessionInfo[] }) => adoptSessions(b.sessions))
      .catch(() => {
        /* the empty graph is a fine fallback */
      });
  }, [api, token, setHosts, adoptSessions]);

  // Poll live status: instance light plus per-session activity. 3s is a
  // compromise between noticing a session that needs input and not hammering
  // ssh on the remote host.
  useEffect(() => {
    if (!token) return;
    let stop = false;
    let loadingViews = false;
    const tick = async () => {
      try {
        const body = await api("/api/status");
        if (stop) return;
        // Before anything below reacts to the sessions the server reports: a
        // restart makes them vanish and return under new ids, and that must not
        // be saved as the owner removing them from their views.
        noteBoot(body.bootId);
        applyStatus(body);
        // Mirror the server: pick up terminals created anywhere else (another
        // tab, the API, a fork) and drop ones that no longer exist.
        if (body.terminals) {
          adoptSessions(body.terminals);
          reconcile(body.terminals);
        }
        // Load saved views once, and only after the server has finished
        // re-adopting sessions: a view names sessions that are not known before
        // then. Nothing is saved until this succeeds, so a failed load can never
        // overwrite what is stored.
        if (body.booted && !useStore.getState().viewsHydrated && !loadingViews) {
          loadingViews = true;
          try {
            const saved = await api("/api/views");
            if (!stop) hydrateViews(saved.views ?? null);
          } finally {
            loadingViews = false;
          }
        }
      } catch {
        /* a failed poll is not worth surfacing; the next one may work */
      }
    };
    void tick();
    const timer = setInterval(tick, 3000);
    return () => {
      stop = true;
      clearInterval(timer);
    };
  }, [api, token, applyStatus, adoptSessions, reconcile, hydrateViews, noteBoot]);

  // Save views as they change, shortly after the last change so a drag is one
  // write, and once more as the page goes away so the last edit is not lost.
  useEffect(() => {
    if (!token) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let last = "";
    const flush = (keepalive = false) => {
      const st = useStore.getState();
      if (!st.viewsHydrated) return;
      const body = JSON.stringify(st.serializeViews());
      if (body === last) return;
      last = body;
      fetch("/api/views", {
        method: "PUT",
        keepalive,
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body,
      }).catch(() => {
        last = ""; // try again on the next change
      });
    };
    const unsubscribe = useStore.subscribe((s, prev) => {
      if (!s.viewsHydrated) return;
      if (
        s.viewsHydrated !== prev.viewsHydrated ||
        s.tabs !== prev.tabs ||
        s.activeTab !== prev.activeTab ||
        s.positions !== prev.positions ||
        s.showFolders !== prev.showFolders ||
        s.showForeign !== prev.showForeign ||
        s.treeFlow !== prev.treeFlow
      ) {
        clearTimeout(timer);
        timer = setTimeout(() => flush(), 800);
      }
    });
    const onHide = () => flush(true);
    window.addEventListener("pagehide", onHide);
    return () => {
      clearTimeout(timer);
      unsubscribe();
      window.removeEventListener("pagehide", onHide);
    };
  }, [token]);

  const selected = hosts.find((h) => h.id === host);

  // Keyboard ownership. A focused terminal must receive every keystroke
  // untouched: Claude Code itself binds Shift+Tab to cycle permission modes,
  // so stealing it globally would break the thing we are here to run.
  // Shift+Tab cycles sessions only when the graph has focus; Esc leaves a
  // terminal and hands focus back to the graph.
  useEffect(() => {
    const inTerminal = (el: EventTarget | null) =>
      el instanceof Element && Boolean(el.closest(".xterm"));

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && inTerminal(e.target)) {
        (document.activeElement as HTMLElement | null)?.blur();
        document.getElementById("cv-graph")?.focus();
        e.preventDefault();
        return;
      }
      if (inTerminal(e.target)) return; // the pty owns it
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) {
        return; // so does a form field
      }
      if (e.key.toLowerCase() === "p" && (e.metaKey || e.ctrlKey) && !e.shiftKey) {
        // Browsers print on Cmd/Ctrl+P; from the graph it opens the palette.
        e.preventDefault();
        setPalette(true);
        return;
      }
      if (e.key === "Tab") {
        e.preventDefault();
        // Keep focus on the graph so the next Tab cycles again instead of
        // walking into the panel's buttons.
        document.getElementById("cv-graph")?.focus();
        useStore.getState().cycle(e.shiftKey ? -1 : 1);
        return;
      }
      // Enter drops into the open terminal, the deliberate hand-off of the
      // keyboard from the graph to the pty.
      if (e.key === "Enter") {
        const term = document.querySelector<HTMLTextAreaElement>(
          ".cv-pane-visible .xterm-helper-textarea",
        );
        if (term) {
          term.focus();
          e.preventDefault();
        }
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const create = useCallback(async () => {
    setError(null);
    setBusy(true);
    try {
      const { session } = (await api("/api/sessions", {
        method: "POST",
        body: JSON.stringify({
          host,
          cwd: cwd || undefined,
          cols: 80,
          rows: 45,
        }),
      })) as { session: SessionInfo };
      addSession(session);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }, [api, host, cwd, addSession]);

  const open = openSessionId ? sessions[openSessionId] : undefined;

  if (!token) {
    return (
      <div style={styles.page}>
        <p style={styles.warn}>
          No token in the URL. Start the server and open the link it prints.
        </p>
      </div>
    );
  }

  return (
    <div style={styles.page}>
      <ConfirmClose />
      {palette && <CommandPalette onClose={() => setPalette(false)} />}
      <ConfirmStop />
      {showPresets && <Presets onClose={() => setShowPresets(false)} />}
      {showHosts && <HostSettings onClose={() => setShowHosts(false)} />}
      <header style={styles.header}>
        <strong style={{ fontWeight: 600 }}>superterminal</strong>

        <select
          style={styles.input}
          value={host}
          onChange={(e) => setHost(e.target.value as HostId)}
        >
          {hosts.map((h) => (
            <option key={h.id} value={h.id} disabled={!h.available}>
              {h.label}
              {h.available ? "" : " — not available yet"}
            </option>
          ))}
        </select>

        <input
          style={{ ...styles.input, minWidth: 240 }}
          placeholder={defaultCwd ? `directory (${defaultCwd})` : "directory"}
          value={cwd}
          onChange={(e) => setCwd(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && create()}
        />
        <button
          style={styles.button}
          onClick={create}
          disabled={busy || !selected?.available}
          title={selected?.available ? undefined : selected?.reason}
        >
          {busy ? "starting…" : "New terminal"}
        </button>

        <button
          style={styles.button}
          onClick={() => setShowPresets(true)}
          title="Saved session graphs: view and deploy"
        >
          Presets
        </button>
        <button
          style={styles.button}
          onClick={() => setShowHosts(true)}
          title="Add or remove a remote host, and its SSH key, without editing config.env"
        >
          Hosts
        </button>
        <span style={{ flex: 1 }} />
        <InstanceLight />
        <span style={styles.meta}>
          Tab cycles · Enter focuses · Esc leaves
        </span>
        <span style={styles.meta}>
          {order.length} session{order.length === 1 ? "" : "s"}
        </span>
      </header>

      {/* Why a host is unavailable, said plainly rather than left to guess. */}
      {selected && !selected.available && (
        <p style={styles.note}>{selected.reason}</p>
      )}
      {error && <p style={styles.warn}>{error}</p>}
      <StatsBar />

      <div style={styles.body}>
        <ViewRail />
        <div style={styles.graph} id="cv-graph" tabIndex={-1}>
          {view === "graph" ? (
            <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
              <GraphTabs />
              <div style={{ flex: 1, minHeight: 0, position: "relative" }}>
                <Graph />
              </div>
            </div>
          ) : view === "kanban" ? (
            <Kanban />
          ) : view === "agents" ? (
            <Agents />
          ) : (
            <History />
          )}
          {/* Graph only. The kanban board says "nothing here" per column and
              the history list has its own empty state, so this would sit on
              top of both. */}
          {order.length === 0 && externalCount === 0 && view === "graph" && (
            <p style={styles.empty}>
              No sessions yet. Create one and it appears here; click it to open
              its terminal, click again to collapse.
            </p>
          )}
        </div>

        <aside
          style={{
            ...styles.panel,
            // A share of the window, not a share capped at 900px: the cap left
            // a large screen with a terminal the same size as a laptop's and
            // the rest given to the graph. The terminal refits as this moves.
            width: open ? "60vw" : 0,
            borderLeftWidth: open ? 1 : 0,
          }}
        >
          {open && (
            <div style={styles.panelHead}>
              <strong style={{ fontSize: 12.5 }}>
                {open.alias || open.shell.split("/").pop()}
              </strong>
              <span style={styles.meta} title={open.cwd}>
                {open.cwd}
              </span>
              <span style={styles.meta}>
                {open.cols}×{open.rows}
              </span>
              {exited[open.sessionId] && <span style={styles.exit}>exited</span>}
              <span style={{ flex: 1 }} />
              <button style={styles.smallButton} onClick={closePanel}>
                Collapse
              </button>
              <button
                style={styles.smallButton}
                onClick={async () => {
                  await api(`/api/sessions/${open.sessionId}`, { method: "DELETE" });
                  removeSession(open.sessionId);
                }}
              >
                Kill
              </button>
            </div>
          )}
          <div style={styles.panelBody}>
            {/* Every pane stays mounted so collapsing keeps scrollback. */}
            {order.map((id) =>
              sessions[id] ? (
                <TerminalPane
                  key={id}
                  session={sessions[id]!}
                  visible={openSessionId === id}
                  debug={debug}
                  onMetrics={setMetrics}
                />
              ) : null,
            )}
          </div>
          {debug && open && metrics && (
            <footer style={styles.debug}>
              echo {fmt(metrics.echoMs)} ms · paint {fmt(metrics.paintMs)} ms ·{" "}
              {(metrics.bytesIn / 1024).toFixed(1)} KiB in ·{" "}
              {metrics.writesPending} pending
            </footer>
          )}
        </aside>
      </div>
    </div>
  );
}

function fmt(v: number | null) {
  return v === null ? "–" : v.toFixed(1);
}

const styles: Record<string, React.CSSProperties> = {
  page: {
    height: "100vh",
    display: "flex",
    flexDirection: "column",
    background: "#0b0b0d",
    color: "#e6e6e6",
    font: '13px/1.5 ui-sans-serif, system-ui, -apple-system, sans-serif',
  },
  header: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    padding: "9px 12px",
    borderBottom: "1px solid #24242a",
    flexWrap: "wrap",
  },
  body: { flex: 1, minHeight: 0, display: "flex" },
  graph: { flex: 1, minWidth: 0, position: "relative" },
  panel: {
    borderLeft: "0 solid #24242a",
    borderLeftStyle: "solid",
    borderLeftColor: "#24242a",
    display: "flex",
    flexDirection: "column",
    transition: "width 140ms ease",
    overflow: "hidden",
    background: "#111113",
  },
  panelHead: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    padding: "7px 10px",
    borderBottom: "1px solid #24242a",
    whiteSpace: "nowrap",
  },
  panelBody: { position: "relative", flex: 1, minHeight: 0 },
  meta: {
    color: "#8a8a93",
    fontSize: 11.5,
    overflow: "hidden",
    textOverflow: "ellipsis",
  },
  exit: { color: "#e0a33e", fontSize: 11.5 },
  input: {
    background: "#15151a",
    border: "1px solid #2a2a32",
    color: "#e6e6e6",
    borderRadius: 6,
    padding: "5px 8px",
    font: "inherit",
  },
  button: {
    background: "#22222a",
    border: "1px solid #33333d",
    color: "#e6e6e6",
    borderRadius: 6,
    padding: "5px 11px",
    cursor: "pointer",
    font: "inherit",
  },
  smallButton: {
    background: "#1c1c23",
    border: "1px solid #2f2f39",
    color: "#c9c9d1",
    borderRadius: 5,
    padding: "3px 9px",
    cursor: "pointer",
    font: "inherit",
    fontSize: 12,
  },
  empty: {
    position: "absolute",
    inset: 0,
    display: "grid",
    placeItems: "center",
    color: "#6a6a73",
    pointerEvents: "none",
    padding: 24,
    textAlign: "center",
  },
  debug: {
    padding: "5px 10px",
    borderTop: "1px solid #24242a",
    color: "#8a8a93",
    fontVariantNumeric: "tabular-nums",
    fontSize: 11.5,
  },
  note: { padding: "6px 12px", color: "#8a8a93", fontSize: 12 },
  warn: { padding: "8px 12px", color: "#e0a33e" },
};
