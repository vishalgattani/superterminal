import { useRef, useState } from "react";
import { useReactFlow } from "@xyflow/react";
import { useStore, type NodeGroup, type NodePosition } from "../store.ts";

// Frames pad generously because nodes size to their content and can be
// wider than the minimum.
const NODE_W = 250;
const NODE_H = 92;
const PAD = 22;

/**
 * Translucent named frames behind the nodes.
 *
 * Drawn inside the React Flow viewport so they pan and zoom with the graph,
 * and sized from their members' positions so a frame always fits what it
 * contains rather than being a fixed box the nodes drift out of.
 */
export function GroupFrames({
  groups,
  positions,
}: {
  groups: NodeGroup[];
  positions: Record<string, NodePosition>;
}) {
  const renameGroup = useStore((s) => s.renameGroup);
  const ungroup = useStore((s) => s.ungroup);
  const setPosition = useStore((s) => s.setPosition);
  const { getViewport } = useReactFlow();
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [dragging, setDragging] = useState<string | null>(null);
  const drag = useRef<{
    startX: number;
    startY: number;
    origin: Record<string, NodePosition>;
  } | null>(null);

  /**
   * Drag the label to move the whole frame.
   *
   * The label rather than the frame body: making the body interactive would
   * swallow canvas panning everywhere a frame covers, and a frame can be
   * large. Movement is divided by the zoom so the group tracks the cursor at
   * any zoom level rather than drifting.
   */
  const startDrag = (e: React.PointerEvent, g: NodeGroup) => {
    if (editing) return;
    e.stopPropagation();
    e.preventDefault();
    (e.target as Element).setPointerCapture?.(e.pointerId);
    const origin: Record<string, NodePosition> = {};
    for (const m of g.members) if (positions[m]) origin[m] = { ...positions[m]! };
    drag.current = { startX: e.clientX, startY: e.clientY, origin };
    setDragging(g.id);
  };

  const onMove = (e: React.PointerEvent) => {
    if (!drag.current || !dragging) return;
    const { zoom } = getViewport();
    const dx = (e.clientX - drag.current.startX) / zoom;
    const dy = (e.clientY - drag.current.startY) / zoom;
    for (const [id, p] of Object.entries(drag.current.origin)) {
      setPosition(id, { x: p.x + dx, y: p.y + dy });
    }
  };

  const endDrag = () => {
    drag.current = null;
    setDragging(null);
  };

  return (
    <>
      {groups.map((g) => {
        const pts = g.members.map((m) => positions[m]).filter(Boolean) as NodePosition[];
        if (pts.length === 0) return null;
        const minX = Math.min(...pts.map((p) => p.x)) - PAD;
        const minY = Math.min(...pts.map((p) => p.y)) - PAD - 18;
        const maxX = Math.max(...pts.map((p) => p.x)) + NODE_W + PAD;
        const maxY = Math.max(...pts.map((p) => p.y)) + NODE_H + PAD;

        return (
          <div
            key={g.id}
            style={{
              position: "absolute",
              left: minX,
              top: minY,
              width: maxX - minX,
              height: maxY - minY,
              borderRadius: 14,
              background: `hsla(${g.hue}, 55%, 55%, ${dragging === g.id ? 0.14 : 0.07})`,
              border: `1px solid hsla(${g.hue}, 60%, 62%, ${
                dragging === g.id ? 0.85 : 0.45
              })`,
              // Behind the nodes, and never swallowing their clicks.
              pointerEvents: "none",
              zIndex: 0,
            }}
          >
            <div
              // nopan/nodrag are React Flow's own opt-outs. Stopping
              // propagation in React is not enough: panning is a native d3
              // listener on the pane, which a synthetic stopPropagation does
              // not reach, so dragging the label panned the canvas instead.
              className="nopan nodrag"
              style={{
                position: "absolute",
                top: -1,
                left: 10,
                transform: "translateY(-50%)",
                display: "flex",
                alignItems: "center",
                gap: 6,
                pointerEvents: "all",
              }}
            >
              {editing === g.id ? (
                <input
                  className="nopan nodrag"
                  autoFocus
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onBlur={() => {
                    renameGroup(g.id, draft.trim() || g.name);
                    setEditing(null);
                  }}
                  onKeyDown={(e) => {
                    e.stopPropagation();
                    if (e.key === "Enter") {
                      renameGroup(g.id, draft.trim() || g.name);
                      setEditing(null);
                    }
                    if (e.key === "Escape") setEditing(null);
                  }}
                  style={{
                    background: "#0e0e11",
                    border: `1px solid hsla(${g.hue}, 60%, 62%, 0.8)`,
                    borderRadius: 5,
                    color: "#e6e6e6",
                    font: "inherit",
                    fontSize: 11,
                    padding: "1px 6px",
                  }}
                />
              ) : (
                <span
                  className="nopan nodrag"
                  onPointerDown={(e) => startDrag(e, g)}
                  onPointerMove={onMove}
                  onPointerUp={endDrag}
                  onPointerCancel={endDrag}
                  onDoubleClick={() => {
                    setEditing(g.id);
                    setDraft(g.name);
                  }}
                  title="Drag to move the group · double-click to rename"
                  style={{
                    background: `hsla(${g.hue}, 45%, 22%, 0.95)`,
                    border: `1px solid hsla(${g.hue}, 60%, 62%, 0.5)`,
                    color: `hsl(${g.hue}, 70%, 78%)`,
                    borderRadius: 999,
                    padding: "1px 9px",
                    fontSize: 10.5,
                    cursor: dragging === g.id ? "grabbing" : "grab",
                    whiteSpace: "nowrap",
                    userSelect: "none",
                  }}
                >
                  {g.name} · {g.members.length}
                </span>
              )}
              <button
                className="nopan nodrag"
                title="Remove this frame. The sessions are untouched."
                onClick={() => ungroup(g.id)}
                style={{
                  width: 15,
                  height: 15,
                  lineHeight: "12px",
                  padding: 0,
                  borderRadius: 4,
                  border: `1px solid hsla(${g.hue}, 60%, 62%, 0.4)`,
                  background: "#15151a",
                  color: "#9a9aa3",
                  cursor: "pointer",
                  fontSize: 11,
                }}
              >
                ×
              </button>
            </div>
          </div>
        );
      })}
    </>
  );
}
