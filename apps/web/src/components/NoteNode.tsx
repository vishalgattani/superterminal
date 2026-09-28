import { useState, type ReactNode } from "react";
import { NodeResizer, type NodeProps } from "@xyflow/react";
import { useStore } from "../store.ts";

export interface NoteNodeData {
  text: string;
  [key: string]: unknown;
}

/**
 * A markdown note on the canvas (issue #18).
 *
 * Decoration only, per ADR 0006: no handles, so it can never be an end of a
 * context link and never gains the right to write into a terminal.
 * Double-click to edit; clicking away saves.
 */
export function NoteNode({ id, data, selected }: NodeProps) {
  const { text } = data as NoteNodeData;
  const updateNote = useStore((s) => s.updateNote);
  const removeNote = useStore((s) => s.removeNote);
  const [draft, setDraft] = useState<string | null>(text ? null : "");

  return (
    <div style={box} onDoubleClick={() => draft === null && setDraft(text)}>
      <NodeResizer
        isVisible={selected}
        minWidth={140}
        minHeight={70}
        lineStyle={{ borderColor: "#5b6b8f" }}
        handleStyle={{ width: 7, height: 7, borderRadius: 2 }}
      />
      <button
        style={close}
        title="Delete note"
        onClick={(e) => {
          e.stopPropagation();
          removeNote(id);
        }}
      >
        ×
      </button>
      {draft !== null ? (
        <textarea
          // nodrag/nowheel: typing and scrolling here must not move the canvas.
          className="nodrag nowheel"
          autoFocus
          value={draft}
          placeholder="Markdown: # heading, - item, **bold**, `code`"
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => {
            updateNote(id, { text: draft });
            setDraft(null);
          }}
          onKeyDown={(e) => {
            // Esc leaves the editor, same as it leaves a terminal.
            if (e.key === "Escape") (e.target as HTMLTextAreaElement).blur();
            e.stopPropagation();
          }}
          style={editor}
        />
      ) : (
        <div className="nowheel" style={body}>
          {text ? renderMarkdown(text) : <span style={{ color: "#6a6a73" }}>Double-click to edit</span>}
        </div>
      )}
    </div>
  );
}

/**
 * A deliberately small markdown subset, built as React elements rather than
 * HTML so note text can never inject markup: headings, bullets, bold, code.
 */
export function renderMarkdown(text: string): ReactNode[] {
  return text.split("\n").map((line, i) => {
    const h = /^(#{1,3})\s+(.*)$/.exec(line);
    if (h) {
      const size = [0, 15, 13.5, 12.5][h[1]!.length];
      return (
        <div key={i} style={{ fontWeight: 600, fontSize: size, margin: "2px 0" }}>
          {inline(h[2]!)}
        </div>
      );
    }
    const li = /^\s*[-*]\s+(.*)$/.exec(line);
    if (li) return <div key={i} style={{ paddingLeft: 10 }}>• {inline(li[1]!)}</div>;
    return <div key={i} style={{ minHeight: "1em" }}>{inline(line)}</div>;
  });
}

function inline(s: string): ReactNode[] {
  return s.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).map((part, i) =>
    part.startsWith("**") && part.endsWith("**") && part.length > 4 ? (
      <strong key={i}>{part.slice(2, -2)}</strong>
    ) : part.startsWith("`") && part.endsWith("`") && part.length > 2 ? (
      <code key={i} style={code}>{part.slice(1, -1)}</code>
    ) : (
      part
    ),
  );
}

const box: React.CSSProperties = {
  width: "100%",
  height: "100%",
  background: "#1d1c16",
  border: "1px solid #3a3726",
  borderRadius: 6,
  color: "#dcd8c4",
  fontSize: 12,
  position: "relative",
  boxSizing: "border-box",
};
const body: React.CSSProperties = {
  padding: "8px 10px",
  height: "100%",
  overflow: "auto",
  boxSizing: "border-box",
  lineHeight: 1.45,
};
const editor: React.CSSProperties = {
  width: "100%",
  height: "100%",
  background: "transparent",
  color: "inherit",
  border: "none",
  outline: "none",
  resize: "none",
  padding: "8px 10px",
  font: "12px ui-monospace, Menlo, monospace",
  boxSizing: "border-box",
};
const close: React.CSSProperties = {
  position: "absolute",
  top: 2,
  right: 4,
  background: "none",
  border: "none",
  color: "#7a7660",
  cursor: "pointer",
  fontSize: 14,
  lineHeight: 1,
  zIndex: 1,
};
const code: React.CSSProperties = {
  background: "#2a281d",
  padding: "0 3px",
  borderRadius: 3,
  fontFamily: "ui-monospace, Menlo, monospace",
};
