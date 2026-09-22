import { useEffect, useRef, useState } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import type { HostId } from "@cv/shared";
import { useStore } from "../store.ts";
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
  /** The Claude model this terminal was started with, when one was asked for. */
  model?: string;
  /** Subagents of the Claude running here, from the last transcript scan. */
  subagents?: number;
  /** When that scan ran, so the count can say how much to trust it. */
  subagentsScannedAt?: number;
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
  // An explicit toggle rather than hover: a card that appears on hover gets
  // in the way while dragging and disappears the moment you reach for it.
  const [infoOpen, setInfoOpen] = useState(false);
  const [draft, setDraft] = useState(d.label);
  const inputRef = useRef<HTMLInputElement | null>(null);

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
            {d.claudeName ? ` · ${d.claudeName}` : ""}
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
            <span style={modelPill} title={`Started with --model ${d.model}`}>
              {modelLabel(d.model, d.claudeSessionId)}
            </span>
          )}
          <SubagentBadge n={d.subagents} scannedAt={d.subagentsScannedAt} />
          {/* Only shown once a statusline has actually reported a figure, so
              a missing cost reads as "unknown" rather than as zero. */}
          {d.costUsd !== undefined && (
            <span style={costPill} title="Session cost, from the statusline">
              ${d.costUsd.toFixed(2)}
            </span>
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
export function SubagentBadge({ n, scannedAt }: { n?: number; scannedAt?: number }) {
  if (!n) return null;
  const stale = isStale(scannedAt ?? 0);
  return (
    <span
      style={subagentPill}
      title={`${subagentLabel(n)} — from a transcript scan ${scanAge(scannedAt ?? 0)}`}
    >
      ⑂ {n}
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
