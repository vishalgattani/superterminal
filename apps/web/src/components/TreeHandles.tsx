import { Handle, Position } from "@xyflow/react";

/**
 * Invisible anchors for containment lines.
 *
 * Both orientations exist so the tree can run top-down or left-to-right and its
 * lines still leave and enter the sides that face each other. They are not
 * connectable: a containment line comes from the folder structure, never from
 * a drag, and must not be mistaken for a context link.
 */
const hidden: React.CSSProperties = {
  opacity: 0,
  width: 1,
  height: 1,
  minWidth: 0,
  minHeight: 0,
  border: "none",
  pointerEvents: "none",
};

export function TreeHandles() {
  return (
    <>
      <Handle id="tree-t-in" type="target" position={Position.Top} isConnectable={false} style={hidden} />
      <Handle id="tree-t-out" type="source" position={Position.Bottom} isConnectable={false} style={hidden} />
      <Handle id="tree-l-in" type="target" position={Position.Left} isConnectable={false} style={{ ...hidden, top: "30%" }} />
      <Handle id="tree-l-out" type="source" position={Position.Right} isConnectable={false} style={{ ...hidden, top: "30%" }} />
    </>
  );
}
