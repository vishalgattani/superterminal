import { Handle, Position, type NodeProps } from "@xyflow/react";
import type { Orphan } from "../store.ts";
import { ForeignActions, TONE, short } from "./ForeignActions.tsx";
import { TreeHandles } from "./TreeHandles.tsx";
import { hostPalette } from "../lib/hostColour.ts";
import { SubagentBadge } from "./SessionNode.tsx";

export interface ForeignNodeData extends Record<string, unknown> {
  orphan: Orphan;
  /** Subagents of this session, from the last transcript scan. */
  subagents?: number;
  /** When that scan ran, so the count can say how much to trust it. */
  subagentsScannedAt?: number;
}

/**
 * A live Claude session the viewer did not start.
 *
 * Deliberately not a terminal: it has no pty, so it cannot be *written into*
 * and clicking it does nothing. It does get a **source** handle, though, and
 * only a source handle — a session the viewer did not start can still drive
 * one it did, and the missing target handle is what says it cannot be driven
 * back. That asymmetry is the whole capability, drawn.
 * The dashed border is what tells it apart from a session that is ours. It is
 * here so a session waiting on input is a card you can see, not a number.
 */
export function ForeignNode({ data, positionAbsoluteX, positionAbsoluteY }: NodeProps) {
  const d = data as ForeignNodeData;
  const o = d.orphan;
  const tone = TONE[o.activity] ?? TONE.unknown!;
  const waiting = o.activity === "waiting";
  const host = hostPalette(o.host);

  return (
    <div
      style={{
        width: "max-content",
        minWidth: 210,
        maxWidth: 340,
        borderRadius: 10,
        border: `1px dashed ${waiting ? tone : "#3a3a46"}`,
        background: "#131318",
        boxShadow: waiting ? `0 0 0 1px ${tone}44` : "none",
        color: "#e6e6e6",
        padding: "8px 10px",
        display: "grid",
        gap: 4,
      }}
    >
      <TreeHandles />
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <span
          style={{ width: 7, height: 7, borderRadius: 999, background: tone, flexShrink: 0 }}
        />
        <strong style={title} title={o.name || o.sessionId}>
          {o.name || o.sessionId.slice(0, 8)}
        </strong>
        {o.kind === "background" && <span style={tag}>background</span>}
        {o.isViewer && <span style={tag}>this viewer</span>}
      </div>
      <div style={path} title={o.cwd}>
        {short(o.cwd)}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 10.5 }}>
        <span
          style={{
            fontSize: 10,
            padding: "1px 6px",
            borderRadius: 999,
            background: host.bg,
            color: host.fg,
            border: `1px solid ${host.border}`,
          }}
        >
          {o.host}
        </span>
        <span style={{ color: tone }}>
          {o.waitingFor ? `waiting: ${o.waitingFor}` : o.activity}
        </span>
        <SubagentBadge n={d.subagents} scannedAt={d.subagentsScannedAt} />
        <span style={{ marginLeft: "auto", color: "#5c5c65" }}>external</span>
      </div>
      <ForeignActions o={o} at={{ x: positionAbsoluteX, y: positionAbsoluteY }} />
      <Handle type="source" position={Position.Right} id="context-out" style={foreignHandle} />
    </div>
  );
}

const title: React.CSSProperties = {
  fontSize: 12.5,
  fontWeight: 600,
  whiteSpace: "nowrap",
  overflow: "hidden",
  textOverflow: "ellipsis",
  flex: 1,
  minWidth: 0,
  color: "#b9b9c2",
};

const path: React.CSSProperties = {
  fontSize: 11,
  color: "#9a9aa3",
  whiteSpace: "nowrap",
  overflow: "hidden",
  textOverflow: "ellipsis",
};

const tag: React.CSSProperties = {
  fontSize: 9.5,
  padding: "0 5px",
  borderRadius: 999,
  border: "1px solid #33333d",
  color: "#8a8a93",
  flexShrink: 0,
};

/** Dashed-card styling: the handle matches the border it sits on. */
const foreignHandle: React.CSSProperties = {
  width: 9,
  height: 9,
  background: "#15151a",
  border: "1.5px solid #4a4a55",
};
