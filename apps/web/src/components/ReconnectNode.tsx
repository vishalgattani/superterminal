import { useState } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import type { PersistedMember } from "../lib/persist.ts";
import { useStore } from "../store.ts";
import { TreeHandles } from "./TreeHandles.tsx";
import { hostPalette } from "../lib/hostColour.ts";
import { short } from "./ForeignActions.tsx";

export interface ReconnectNodeData extends Record<string, unknown> {
  key: string;
  meta: PersistedMember;
}

/**
 * A saved node whose session did not come back: the terminal is gone (a
 * server restart lost a local pty, or a remote one was never re-adopted) but
 * its Claude conversation was recorded, so it can be resumed. Distinct from
 * `ForeignNode` (a session that exists but the viewer did not start) — this
 * one exists nowhere until the owner clicks Reconnect, which is deliberate:
 * see `docs/adr` and issue #2 for why nothing resumes automatically on load.
 */
export function ReconnectNode({ data }: NodeProps) {
  const d = data as ReconnectNodeData;
  const meta = d.meta;
  const reconnectMember = useStore((s) => s.reconnectMember);
  const [busy, setBusy] = useState(false);
  const host = hostPalette(meta.host ?? "local");

  return (
    <div
      style={{
        width: "max-content",
        minWidth: 190,
        maxWidth: 300,
        borderRadius: 10,
        border: "1px dashed #4a3a2a",
        background: "#191510",
        color: "#e6e6e6",
        padding: "8px 10px",
        display: "grid",
        gap: 4,
      }}
    >
      <TreeHandles />
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <span style={{ width: 7, height: 7, borderRadius: 999, background: "#c98a3a", flexShrink: 0 }} />
        <strong style={title} title={meta.alias || d.key}>
          {meta.alias || "(unnamed)"}
        </strong>
      </div>
      {meta.cwd && (
        <div style={path} title={meta.cwd}>
          {short(meta.cwd)}
        </div>
      )}
      <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 10.5 }}>
        {meta.host && (
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
            {meta.host}
          </span>
        )}
        <span style={{ color: "#c98a3a" }}>gone</span>
      </div>
      <button
        type="button"
        disabled={busy}
        onClick={() => {
          setBusy(true);
          void reconnectMember(d.key).finally(() => setBusy(false));
        }}
        style={{
          fontSize: 11,
          padding: "4px 8px",
          borderRadius: 6,
          border: "1px solid #4a3a2a",
          background: busy ? "#232019" : "#2a2015",
          color: "#e6c9a0",
          cursor: busy ? "default" : "pointer",
        }}
        title={`claude --resume ${meta.claudeSessionId?.slice(0, 8)}`}
      >
        {busy ? "reconnecting…" : "reconnect"}
      </button>
      <Handle type="source" position={Position.Right} id="context-out" style={{ width: 9, height: 9, background: "#191510", border: "1.5px solid #4a3a2a" }} />
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
  color: "#e6c9a0",
};

const path: React.CSSProperties = {
  fontSize: 11,
  color: "#9a9aa3",
  whiteSpace: "nowrap",
  overflow: "hidden",
  textOverflow: "ellipsis",
};
