import { useEffect, useRef, useState } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import type { HostId } from "@cv/shared";
import { useStore, type MonitorInfo } from "../store.ts";
import { TreeHandles } from "./TreeHandles.tsx";
import { hostPalette } from "../lib/hostColour.ts";
import { modelLabel } from "../lib/model.ts";
import { isStale, scanAge, subagentLabel } from "../lib/subagents.ts";

export interface SessionNodeData extends Record<string, unknown> {
  label: string;
  /** True when the label is the owner's alias rather than a fallback. */
  named: boolean;
  host: HostId;
  cwd: string;
  shell: string;
  cols: number;
  rows: number;
  startedAt: number;
  sessionId: string;
  open: boolean;
  exited: boolean;
  /** True on tmux-backed hosts, where the remote session outlives the pty. */
  canReattach: boolean;
  /** Session cost in USD, when a statusline has reported one. */
  costUsd?: number;
  /** Context window used, 0-100, when a statusline has reported one. */
  contextPct?: number;
  /** The model Claude reports now, else the one the terminal was started with. */
  model?: string;
  /** Claude's effort level, when the statusline has reported one. */
  effort?: string;
  /** Subagents of the Claude running here, from the last transcript scan. */
  subagents?: number;
  /** When that scan ran, so the count can say how much to trust it. */
  subagentsScannedAt?: number;
  /** Of `subagents`, how many are running now; absent from an older server. */
  subagentsActive?: number;
  /** Monitors this node's Claude is running now. */
  monitors?: MonitorInfo[];
  claudeName?: string;
  /** Claude's own session id, present only when a Claude is running here. */
  claudeSessionId?: string;
}

/** `/Users/me/x` and `/home/me/x` both read better as `~/x`. */
export function tildify(p: string): string {
  return p.replace(/^\/Users\/[^/]+/, "~").replace(/^\/home\/[^/]+/, "~");
}

/**
 * Shorten a path from the left, keeping the tail, which is the informative
 * end. Done here rather than with CSS `direction: rtl`, which reorders the
 * text itself: "~/vault" rendered as "vault/~".
 */
function elidePath(p: string, max = 30): string {
  const short = tildify(p);
  return short.length <= max ? short : `…${short.slice(-(max - 1))}`;
}

function ago(ms: number): string {
  const s = Math.max(0, Math.round((Date.now() - ms) / 1000));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
}

/**
 * Defined outside any component that renders the canvas, and registered once
 * in a module-level nodeTypes map, or React Flow remounts every node on each
 * state change.
 */
export function SessionNode({ id, data, selected }: NodeProps) {
  const d = data as SessionNodeData;
  const colour = hostPalette(d.host);
  const askClose = useStore((s) => s.askClose);
  const reattach = useStore((s) => s.reattach);
  const reattaching = useStore((s) => s.reattaching === id);
  const renaming = useStore((s) => s.renamingId === id);
  const startRename = useStore((s) => s.startRename);
  const setAlias = useStore((s) => s.setAlias);
  const compactSession = useStore((s) => s.compactSession);
  // An explicit toggle rather than hover: a card that appears on hover gets
  // in the way while dragging and disappears the moment you reach for it.
  const [infoOpen, setInfoOpen] = useState(false);
  const [draft, setDraft] = useState(d.label);
  const inputRef = useRef<HTMLInputElement | null>(null);

  // Compact is not idempotent mid-flight: the button goes back to enabled
  // once the next status poll actually shows the percentage drop, not on a
  // timer and not just because the click landed. The captured value is what
  // "dropped" is measured against, so a poll that lands before the terminal
  // has even echoed the command back does not clear the guard early.
  const [compacting, setCompacting] = useState(false);
  const compactStartPct = useRef<number | undefined>(undefined);
  useEffect(() => {
    if (!compacting) return;
    if (compactStartPct.current !== undefined && d.contextPct !== undefined && d.contextPct < compactStartPct.current) {
      setCompacting(false);
    }
  }, [compacting, d.contextPct]);
  // A statusline can lag or stop updating; a stuck "compacting…" forever
  // would be worse than a guard that gives up and lets the owner try again.
  useEffect(() => {
    if (!compacting) return;
    const t = setTimeout(() => setCompacting(false), 90_000);
    return () => clearTimeout(t);
  }, [compacting]);

  useEffect(() => {
    if (!renaming) return;
    setDraft(d.named ? d.label : "");
    // focus() explicitly, not just select(): the open terminal holds focus,
    // and without this the rename box appears while every keystroke still
    // goes to the shell.
    const id = requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    });
    return () => cancelAnimationFrame(id);
  }, [renaming]);

  // Every control on the node must stop propagation, or React Flow also
  // treats the click as "open/collapse this node".
  const swallow = (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
  };

  return (
    <div
      style={{
        position: "relative",
        // Sized to its content rather than a fixed 210px, which truncated
        // longer names like generator-system-simulation. Bounded so one long
        // label cannot stretch a node across the canvas.
        width: "max-content",
        minWidth: 210,
        maxWidth: 340,
        borderRadius: 10,
        border: `1px solid ${d.open ? "#5b8cff" : selected ? "#44444f" : "#2a2a32"}`,
        background: "#15151a",
        boxShadow: d.open ? "0 0 0 1px #5b8cff55" : "none",
        color: "#e6e6e6",
        opacity: d.exited ? 0.55 : 1,
      }}
    >
      <Handle type="target" position={Position.Left} id="context-in" style={handle} />
      <TreeHandles />
      <div style={{ padding: "8px 10px", display: "grid", gap: 4 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span
            style={{
              width: 7,
              height: 7,
              borderRadius: 999,
              background: d.exited ? "#6a6a73" : colour.fg,
              flexShrink: 0,
            }}
          />
          {renaming ? (
            <input
              ref={inputRef}
              className="nodrag"
              // autoFocus as well as the effect below: React Flow can remount
              // a node when its data changes, which leaves the ref-based focus
              // racing the remount. autoFocus is applied at mount either way.
              autoFocus
              value={draft}
              placeholder="name this terminal"
              onChange={(e) => setDraft(e.target.value)}
              onMouseDown={(e) => e.stopPropagation()}
              onDoubleClick={swallow}
              onBlur={() => void setAlias(id, draft)}
              onKeyDown={(e) => {
                e.stopPropagation();
                if (e.key === "Enter") void setAlias(id, draft);
                if (e.key === "Escape") startRename(null);
              }}
              style={renameInput}
            />
          ) : (
            <strong
              title="Double-click to rename"
              onDoubleClick={(e) => {
                swallow(e);
                startRename(id);
              }}
              style={{
                fontSize: 12.5,
                fontWeight: 600,
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
                flex: 1,
                // The node grows to fit, so the title only clips at the
                // maximum width rather than at a fixed one.
                minWidth: 0,
                cursor: "text",
                color: d.named ? "#e6e6e6" : "#b9b9c2",
              }}
            >
              {d.label}
            </strong>
          )}
          {!renaming && (
            <button
              title={infoOpen ? "Hide details" : "Show details"}
              aria-label="Session details"
              aria-expanded={infoOpen}
              onMouseDown={swallow}
              onClick={(e) => {
                swallow(e);
                setInfoOpen((v) => !v);
              }}
              style={{
                ...closeButton,
                color: infoOpen ? "#8fc0f0" : "#9a9aa3",
                borderColor: infoOpen ? "#2f4a6b" : "#33333d",
                fontSize: 11,
                fontStyle: "italic",
                fontFamily: "Georgia, serif",
              }}
            >
              i
            </button>
          )}
          {!renaming && (
            <button
              title="Close this session"
              aria-label="Close this session"
              onMouseDown={swallow}
              onClick={(e) => {
                swallow(e);
                askClose(id);
              }}
              style={closeButton}
            >
              ×
            </button>
          )}
        </div>
        {/* Claude's session id, shown only when a Claude is actually running
            in this terminal. It is the id --resume takes and the one another
            session can be pointed at, so it is worth surfacing. */}
        {d.claudeSessionId && (
          <div style={claudeIdLine} title={`Claude session ${d.claudeSessionId}`}>
            ◆ {d.claudeSessionId.slice(0, 8)}
            {/* A rename is viewer metadata that never reaches the running
                Claude, so once renamed its own launch-time name is stale. */}
            {d.named ? ` · ${d.label}` : d.claudeName ? ` · ${d.claudeName}` : ""}
          </div>
        )}
        {/* The folder is the thing you actually need to tell sessions apart. */}
        <div style={pathLine} title={d.cwd}>
          {elidePath(d.cwd)}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span
            style={{
              fontSize: 10,
              padding: "1px 6px",
              borderRadius: 999,
              background: colour.bg,
              color: colour.fg,
              border: `1px solid ${colour.border}`,
            }}
          >
            {d.host}
          </span>
          <span style={{ fontSize: 10.5, color: d.exited ? "#e0a33e" : "#6a6a73" }}>
            {d.exited
              ? d.canReattach
                ? "disconnected"
                : "exited"
              : `${d.cols}×${d.rows}`}
          </span>
          {/* Absent when no model was asked for, in which case Claude picked
              its own default and the viewer must not claim to know which; and
              absent while no Claude is running here, whatever the terminal was
              started with. */}
          {modelLabel(d.model, d.claudeSessionId) && (
            <span style={modelPill} title={`Model: ${d.model}`}>
              {modelLabel(d.model, d.claudeSessionId)}
            </span>
          )}
          {d.claudeSessionId !== undefined && d.effort && (
            <span style={modelPill} title="Effort, from the statusline">
              {d.effort}
            </span>
          )}
          <SubagentBadge n={d.subagents} active={d.subagentsActive} scannedAt={d.subagentsScannedAt} />
          <MonitorBadge monitors={d.monitors} />
          {/* Only shown once a statusline has actually reported a figure, so
              a missing cost reads as "unknown" rather than as zero. */}
          {d.costUsd !== undefined && (
            <span style={costPill} title="Session cost, from the statusline">
              ${d.costUsd.toFixed(2)}
            </span>
          )}
          {/* Only for a node actually running Claude, same gate the model
              pill uses: a plain shell has no context window to show. */}
          {d.claudeSessionId !== undefined && d.contextPct !== undefined && (
            <ContextRing pct={d.contextPct} />
          )}
          {d.claudeSessionId !== undefined && (
            <button
              title={
                d.contextPct === undefined
                  ? "Context usage unknown"
                  : d.contextPct < 80
                    ? "Compact once context usage reaches 80%"
                    : "Run /compact in this terminal"
              }
              onMouseDown={swallow}
              onClick={(e) => {
                swallow(e);
                if (compacting) return;
                compactStartPct.current = d.contextPct;
                setCompacting(true);
                void compactSession(id);
              }}
              disabled={compacting || d.contextPct === undefined || d.contextPct < 80}
              style={{
                ...compactButton,
                opacity: compacting || d.contextPct === undefined || d.contextPct < 80 ? 0.5 : 1,
                cursor: compacting || d.contextPct === undefined || d.contextPct < 80 ? "default" : "pointer",
              }}
            >
              {compacting ? "compacting…" : "Compact"}
            </button>
          )}
          {/* On a tmux host the pty exiting usually means the connection
              dropped while the remote work carried on, so offer to rejoin. */}
          {d.exited && d.canReattach && (
            <button
              onMouseDown={swallow}
              onClick={(e) => {
                swallow(e);
                void reattach(id);
              }}
              disabled={reattaching}
              style={reattachButton}
            >
              {reattaching ? "…" : "Reattach"}
            </button>
          )}
        </div>
      </div>
      <Handle type="source" position={Position.Right} id="context-out" style={handle} />

      {/* Hover card: the full path without truncation, plus the details that
          do not fit on the card itself. */}
      {infoOpen && !renaming && (
        <div style={hoverCard}>
          <Row k="path" v={d.cwd} mono />
          <Row k="host" v={d.host} />
          <Row k="shell" v={d.shell} mono />
          <Row k="size" v={`${d.cols} × ${d.rows}`} />
          <Row k="started" v={`${ago(d.startedAt)} ago`} />
          <Row k="session" v={d.sessionId.slice(0, 8)} mono />
          {d.costUsd !== undefined && (
            <Row k="cost" v={`$${d.costUsd.toFixed(2)} this session`} />
          )}
          {d.contextPct !== undefined && (
            <Row k="context" v={`${d.contextPct}% used`} />
          )}
          {d.claudeName && <Row k="claude" v={d.claudeName} />}
          {d.claudeSessionId && (
            <Row k="claude id" v={d.claudeSessionId} mono />
          )}
          <div style={hint}>
            Double-click the name to rename · click the node to open its
            terminal
          </div>
        </div>
      )}
    </div>
  );
}

function Row({ k, v, mono }: { k: string; v: string; mono?: boolean }) {
  return (
    <div style={{ display: "flex", gap: 8, alignItems: "baseline" }}>
      <span style={{ color: "#7a7a84", minWidth: 48, flexShrink: 0 }}>{k}</span>
      <span
        style={{
          color: "#d8d8de",
          wordBreak: "break-all",
          fontFamily: mono
            ? 'ui-monospace, SFMono-Regular, Menlo, monospace'
            : undefined,
        }}
      >
        {v}
      </span>
    </div>
  );
}

const handle: React.CSSProperties = {
  width: 8,
  height: 8,
  background: "#3a3a44",
  border: "1px solid #55555f",
};

const costPill: React.CSSProperties = {
  marginLeft: "auto",
  fontSize: 10,
  padding: "1px 6px",
  borderRadius: 999,
  background: "#1a2a1e",
  color: "#8fd0a0",
  border: "1px solid #2c4a35",
  fontVariantNumeric: "tabular-nums",
};

/** Below 50% blue, 50-80% yellow, 80%+ red — the same stops the Claude Code app uses. */
function ringColour(pct: number): string {
  return pct < 50 ? "#5b8cff" : pct < 80 ? "#e0c23e" : "#e05b5b";
}

const RING_R = 6;
const RING_C = 2 * Math.PI * RING_R;

/**
 * A tiny circular progress indicator for context-window usage, hand-rolled
 * as inline SVG rather than a chart dependency, the same call `PresetDiagram`
 * already makes for something this small.
 */
function ContextRing({ pct }: { pct: number }) {
  const clamped = Math.max(0, Math.min(100, pct));
  const offset = RING_C - (clamped / 100) * RING_C;
  return (
    <svg
      width={16}
      height={16}
      viewBox="0 0 16 16"
      role="img"
      aria-label={`${clamped}% of context window used`}
    >
      <title>{`${clamped}% of context window used`}</title>
      <circle cx={8} cy={8} r={RING_R} fill="none" stroke="#2a2a32" strokeWidth={2.5} />
      <circle
        cx={8}
        cy={8}
        r={RING_R}
        fill="none"
        stroke={ringColour(clamped)}
        strokeWidth={2.5}
        strokeDasharray={RING_C}
        strokeDashoffset={offset}
        strokeLinecap="round"
        // Start at 12 o'clock and grow clockwise, the way a percentage reads.
        transform="rotate(-90 8 8)"
      />
    </svg>
  );
}

const compactButton: React.CSSProperties = {
  background: "#241a1a",
  border: "1px solid #4a2c2c",
  color: "#e0a0a0",
  borderRadius: 4,
  padding: "1px 7px",
  cursor: "pointer",
  font: "inherit",
  fontSize: 10,
};

const reattachButton: React.CSSProperties = {
  marginLeft: "auto",
  background: "#1d2b3f",
  border: "1px solid #2f4a6b",
  color: "#8fc0f0",
  borderRadius: 4,
  padding: "1px 7px",
  cursor: "pointer",
  font: "inherit",
  fontSize: 10,
};

const closeButton: React.CSSProperties = {
  width: 17,
  height: 17,
  lineHeight: "14px",
  padding: 0,
  flexShrink: 0,
  borderRadius: 4,
  border: "1px solid #33333d",
  background: "#1c1c23",
  color: "#9a9aa3",
  cursor: "pointer",
  fontSize: 14,
};

const renameInput: React.CSSProperties = {
  flex: 1,
  minWidth: 0,
  background: "#0e0e11",
  border: "1px solid #5b8cff",
  borderRadius: 4,
  color: "#e6e6e6",
  font: "inherit",
  fontSize: 12.5,
  fontWeight: 600,
  padding: "1px 5px",
};

const claudeIdLine: React.CSSProperties = {
  fontSize: 10,
  color: "#8fc0f0",
  whiteSpace: "nowrap",
  overflow: "hidden",
  textOverflow: "ellipsis",
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
};

const pathLine: React.CSSProperties = {
  fontSize: 11,
  color: "#9a9aa3",
  whiteSpace: "nowrap",
  overflow: "hidden",
  textOverflow: "ellipsis",
};

const hoverCard: React.CSSProperties = {
  position: "absolute",
  top: "calc(100% + 8px)",
  left: 0,
  width: 280,
  padding: "9px 11px",
  borderRadius: 8,
  background: "#0e0e11f5",
  border: "1px solid #33333d",
  boxShadow: "0 10px 28px #000000aa",
  fontSize: 11,
  lineHeight: 1.5,
  display: "grid",
  gap: 2,
  zIndex: 20,
};

const hint: React.CSSProperties = {
  marginTop: 5,
  paddingTop: 5,
  borderTop: "1px solid #26262e",
  color: "#6a6a73",
  fontSize: 10,
};

const modelPill: React.CSSProperties = {
  fontSize: 10,
  padding: "1px 6px",
  borderRadius: 999,
  background: "#1b2030",
  color: "#9fb0d8",
  border: "1px solid #2f3752",
};

/**
 * A session that has fanned out into subagents.
 *
 * Shown only when there are some: "0 subagents" on every card would be noise,
 * and a scan that has not caught up yet reports zero for a fan-out that is
 * already running, so a confident zero would be a lie. The age is in the
 * tooltip always, and on the face once the count is old enough to doubt.
 */
export function SubagentBadge({
  n,
  active,
  scannedAt,
}: {
  n?: number;
  active?: number;
  scannedAt?: number;
}) {
  if (!n) return null;
  const stale = isStale(scannedAt ?? 0);
  // n is every subagent the session ever started; finished ones keep their
  // transcripts. Only `active` means work happening now.
  const running = active ?? 0;
  const known = active !== undefined;
  return (
    <span
      style={known && running === 0 ? { ...subagentPill, opacity: 0.5 } : subagentPill}
      title={`${subagentLabel(n)}${known ? `, ${running} running now` : ""} — from a transcript scan ${scanAge(scannedAt ?? 0)}`}
    >
      ⑂ {known ? (running > 0 ? `${running} running` : `${n} done`) : n}
      {stale && <span style={{ opacity: 0.55 }}> · {scanAge(scannedAt ?? 0)}</span>}
    </span>
  );
}

const subagentPill: React.CSSProperties = {
  fontSize: 10,
  padding: "1px 6px",
  borderRadius: 999,
  background: "#1e2a20",
  color: "#8fc79a",
  border: "1px solid #2f4536",
};

/** "12m left", "1h 5m left"; "no expiry" for a watch with none. */
export function timeLeft(expiresAt: number | undefined, now = Date.now()): string {
  if (expiresAt === undefined) return "no expiry";
  const min = Math.max(0, Math.round((expiresAt - now) / 60_000));
  return min >= 60 ? `${Math.floor(min / 60)}h ${min % 60}m left` : `${min}m left`;
}

/** Running Monitors, counted on the face and listed in the tooltip. */
export function MonitorBadge({ monitors }: { monitors?: MonitorInfo[] }) {
  if (!monitors?.length) return null;
  const title = monitors
    .map(
      (m) =>
        `${m.taskId} · ${timeLeft(m.expiresAt)}\n  ${m.description}` +
        (m.lastEvent ? `\n  last: ${m.lastEvent}` : ""),
    )
    .join("\n");
  return (
    <span style={monitorPill} title={`Monitors running:\n${title}`}>
      ⏱ {monitors.length}
    </span>
  );
}

const monitorPill: React.CSSProperties = {
  flexShrink: 0,
  whiteSpace: "nowrap",
  fontSize: 10,
  padding: "1px 6px",
  borderRadius: 999,
  background: "#2a2418",
  color: "#e0c080",
  border: "1px solid #4a3f28",
};
