import { useEffect, useMemo, useRef, useState } from "react";
import { rankItems, type PaletteItem } from "../lib/palette.ts";
import { useStore } from "../store.ts";

interface Hit {
  sessionId: string;
  text: string;
  linesAgo: number;
}

/**
 * Cmd/Ctrl+P: jump to a session or view, start a terminal, act on a session,
 * or search every terminal's recent output at once (issue #17).
 *
 * Opened only from the graph, never from inside a terminal: the pty owns
 * every keystroke while it has focus (App.tsx's keyboard rule).
 */
export function CommandPalette({ onClose }: { onClose: () => void }) {
  const s = useStore();
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<Hit[]>([]);
  const [cursor, setCursor] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  const nameOf = (id: string) => {
    const info = s.sessions[id];
    return info ? info.alias || info.cwd.split("/").filter(Boolean).pop() || "~" : id.slice(0, 8);
  };

  // Show a session wherever it is: the active view if it is there, else main.
  const reveal = (id: string) => {
    const tab = s.tabs.find((t) => t.id === s.activeTab);
    if (tab?.members && !tab.members.includes(id)) s.setActiveTab("default");
    s.open(id);
  };

  const items = useMemo<PaletteItem[]>(() => {
    const out: PaletteItem[] = [];
    for (const id of s.order) {
      const info = s.sessions[id];
      if (!info) continue;
      const claude = s.activity[id]?.claudeSessionId;
      const detail = [info.host, info.cwd, claude?.slice(0, 8)].filter(Boolean).join(" · ");
      out.push({ id: `go:${id}`, group: "session", label: nameOf(id), detail, run: () => reveal(id) });
      if (claude) {
        out.push({ id: `fork:${id}`, group: "action", label: `Fork session: ${nameOf(id)}`, detail, run: () => void s.forkSession(id) });
      }
      out.push({ id: `close:${id}`, group: "action", label: `Close session: ${nameOf(id)}`, detail, run: () => s.askClose(id) });
    }
    for (const t of s.tabs) {
      out.push({ id: `view:${t.id}`, group: "view", label: `View: ${t.name}`, run: () => s.setActiveTab(t.id) });
    }
    for (const h of s.hosts.filter((h) => h.available)) {
      out.push({
        id: `new:${h.id}`,
        group: "action",
        label: `New terminal on ${h.label}`,
        run: () => void s.createSessionAt(h.id, { x: 40, y: 40 }),
      });
    }
    return out;
  }, [s.order, s.sessions, s.activity, s.tabs, s.hosts, s.activeTab]);

  // Output search goes to the server, which holds every terminal's recent text.
  useEffect(() => {
    if (query.trim().length < 3) {
      setHits([]);
      return;
    }
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(query.trim())}`, {
          headers: { Authorization: `Bearer ${s.token}` },
        });
        setHits(((await res.json()).hits ?? []) as Hit[]);
      } catch {
        setHits([]);
      }
    }, 150);
    return () => clearTimeout(t);
  }, [query, s.token]);

  const shown = useMemo(() => {
    const ranked = rankItems(items, query).slice(0, 30);
    const output: PaletteItem[] = hits.slice(0, 20).map((h, i) => ({
      id: `hit:${i}`,
      group: "output",
      label: h.text,
      detail: `${nameOf(h.sessionId)} · ${h.linesAgo === 0 ? "latest line" : `${h.linesAgo} lines ago`}`,
      run: () => reveal(h.sessionId),
    }));
    return [...ranked, ...output];
  }, [items, query, hits]);

  useEffect(() => setCursor(0), [query]);
  useEffect(() => {
    listRef.current?.children[cursor]?.scrollIntoView({ block: "nearest" });
  }, [cursor]);

  const choose = (it: PaletteItem | undefined) => {
    if (!it) return;
    onClose();
    it.run();
  };

  return (
    <div style={backdrop} onMouseDown={onClose}>
      <div style={box} onMouseDown={(e) => e.stopPropagation()}>
        <input
          autoFocus
          value={query}
          placeholder="Jump to a session or view, run an action, or search terminal output…"
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") onClose();
            else if (e.key === "ArrowDown") setCursor((c) => Math.min(c + 1, shown.length - 1));
            else if (e.key === "ArrowUp") setCursor((c) => Math.max(c - 1, 0));
            else if (e.key === "Enter") choose(shown[cursor]);
            else return;
            e.preventDefault();
            e.stopPropagation();
          }}
          style={input}
        />
        <div ref={listRef} style={list}>
          {shown.length === 0 && <div style={{ ...row, color: "#6a6a73" }}>No matches</div>}
          {shown.map((it, i) => (
            <div
              key={it.id}
              style={{ ...row, background: i === cursor ? "#23283a" : "transparent" }}
              onMouseEnter={() => setCursor(i)}
              onClick={() => choose(it)}
            >
              <span style={tag}>{it.group}</span>
              <span style={it.group === "output" ? mono : undefined}>{it.label}</span>
              {it.detail && <span style={detail}>{it.detail}</span>}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

const backdrop: React.CSSProperties = {
  position: "fixed",
  inset: 0,
  background: "#0008",
  zIndex: 1000,
  display: "flex",
  justifyContent: "center",
  paddingTop: "12vh",
};
const box: React.CSSProperties = {
  width: "min(640px, calc(100vw - 32px))",
  maxHeight: "60vh",
  display: "flex",
  flexDirection: "column",
  background: "#16161b",
  border: "1px solid #2e2e36",
  borderRadius: 8,
  overflow: "hidden",
  boxShadow: "0 12px 40px #000a",
};
const input: React.CSSProperties = {
  background: "#0f0f13",
  border: "none",
  borderBottom: "1px solid #2e2e36",
  color: "#e6e6e6",
  padding: "10px 12px",
  fontSize: 13,
  outline: "none",
};
const list: React.CSSProperties = { overflowY: "auto" };
const row: React.CSSProperties = {
  display: "flex",
  gap: 8,
  alignItems: "baseline",
  padding: "6px 12px",
  fontSize: 12.5,
  color: "#d6d6dc",
  cursor: "pointer",
  whiteSpace: "nowrap",
  overflow: "hidden",
};
const tag: React.CSSProperties = { fontSize: 10, color: "#7a8199", minWidth: 48 };
const detail: React.CSSProperties = { fontSize: 11, color: "#6a6a73", overflow: "hidden", textOverflow: "ellipsis" };
const mono: React.CSSProperties = { fontFamily: "ui-monospace, Menlo, monospace", overflow: "hidden", textOverflow: "ellipsis" };
