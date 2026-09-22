import type { NodeProps } from "@xyflow/react";
import { TreeHandles } from "./TreeHandles.tsx";
import { hostPalette } from "../lib/hostColour.ts";

export interface FolderNodeData extends Record<string, unknown> {
  label: string;
  host: string;
  path: string;
  /** Sessions below this folder. */
  count: number;
}

/**
 * A folder that holds sessions. Drawn lighter than a session on purpose: it is
 * structure, not something you can open, close or type into, so it has no
 * buttons and no connector handles, only anchors for the lines.
 */
export function FolderNode({ data }: NodeProps) {
  const d = data as FolderNodeData;
  const host = hostPalette(d.host);
  return (
    <div
      title={`${d.host}:${d.path}`}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 7,
        padding: "5px 10px",
        borderRadius: 999,
        border: `1px solid ${host.border}`,
        background: "#111318",
        color: "#b9c2d4",
        fontSize: 12,
        whiteSpace: "nowrap",
        maxWidth: 260,
      }}
    >
      <TreeHandles />
      <FolderGlyph color={host.fg} />
      {/* The host, because two hosts each have a "~" and a "vault". */}
      <span style={{ fontSize: 9.5, color: host.fg, opacity: 0.85 }}>{d.host}</span>
      <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{d.label}</span>
      <span style={{ fontSize: 10, color: "#6a6a73", fontVariantNumeric: "tabular-nums" }}>
        {d.count}
      </span>
    </div>
  );
}

function FolderGlyph({ color }: { color: string }) {
  return (
    <svg width="14" height="12" viewBox="0 0 14 12" aria-hidden="true" style={{ flexShrink: 0 }}>
      <path
        d="M1 2.2C1 1.54 1.54 1 2.2 1h2.6c.3 0 .58.12.79.33L6.4 2.15h5.4c.66 0 1.2.54 1.2 1.2v6.45c0 .66-.54 1.2-1.2 1.2H2.2C1.54 11 1 10.46 1 9.8V2.2Z"
        fill="none"
        stroke={color}
        strokeWidth="1.1"
      />
    </svg>
  );
}
