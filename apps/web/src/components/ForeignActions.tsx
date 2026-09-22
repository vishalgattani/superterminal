import { useState } from "react";
import { useStore, type NodePosition, type Orphan } from "../store.ts";

/** Colour per activity, shared by every place a foreign session is drawn. */
export const TONE: Record<string, string> = {
  waiting: "#e0a33e",
  working: "#5b8cff",
  idle: "#7fd28c",
  unknown: "#6a6a73",
};

export const short = (p?: string) => (p ?? "?").replace(/^\/(Users|home)\/[^/]+/, "~");

/**
 * Attach and Stop for a live session the viewer did not start.
 *
 * Attach is only offered where there is something to attach to: a session
 * running in tmux. Anything else can be watched and stopped but not typed into,
 * and says so rather than showing a button that would fail.
 */
export function ForeignActions({ o, at }: { o: Orphan; at?: NodePosition }) {
  const attachAgent = useStore((s) => s.attachAgent);
  const askStop = useStore((s) => s.askStop);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  return (
    // nodrag: on the canvas these sit inside a draggable node, and a press on
    // a button must not start a drag or pan.
    <div className="nodrag nopan" style={{ display: "grid", gap: 4 }}>
      <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
        {o.attachable ? (
          <button
            style={btn}
            disabled={busy}
            title="Open a terminal on this session's tmux pane"
            onClick={(e) => {
              e.stopPropagation();
              setBusy(true);
              setErr(null);
              attachAgent(o, at)
                .catch((x) => setErr((x as Error).message))
                .finally(() => setBusy(false));
            }}
          >
            {busy ? "…" : "Attach"}
          </button>
        ) : (
          <span
            style={{ fontSize: 10, color: "#6a6a73" }}
            title="Not running inside tmux, so there is no terminal to attach to. It can still be watched and stopped."
          >
            not in tmux
          </span>
        )}
        <button
          style={{
            ...btn,
            color: o.isViewer ? "#5c5c65" : "#e08a8a",
            cursor: o.isViewer ? "not-allowed" : "pointer",
          }}
          disabled={o.isViewer}
          title={
            o.isViewer
              ? "This is the session running the viewer"
              : "Send SIGTERM so Claude can shut down cleanly"
          }
          onClick={(e) => {
            e.stopPropagation();
            askStop(o);
          }}
        >
          Stop
        </button>
      </div>
      {err && (
        <div role="alert" style={{ fontSize: 10, color: "#f19aa5" }}>
          {err}
        </div>
      )}
    </div>
  );
}

const btn: React.CSSProperties = {
  background: "#1d2b3f",
  border: "1px solid #2f4a6b",
  color: "#8fc0f0",
  borderRadius: 4,
  padding: "1px 8px",
  cursor: "pointer",
  font: "inherit",
  fontSize: 10.5,
};
