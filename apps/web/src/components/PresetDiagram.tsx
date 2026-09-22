import { hostPalette } from "../lib/hostColour.ts";
interface Node { host: string; cwd: string; label: string; claude: boolean }
interface Edge { from: number; to: number }

/**
 * Draw a preset as a layered graph, from its JSON.
 *
 * Rendered as inline SVG rather than an image: it stays crisp, themes with the
 * rest of the UI, and there is no PNG to manage. PlantUML text is offered
 * alongside for pasting into vault docs, which already keep .puml sources.
 */
export function PresetDiagram({
  nodes,
  edges,
  direction,
}: {
  nodes: Node[];
  edges: Edge[];
  direction: "LR" | "TD";
}) {
  // Layer by longest path from a root, so a chain like
  // vault -> testing -> virtual-generator -> controllers reads as four columns
  // rather than collapsing the middle.
  const depth = new Array(nodes.length).fill(0);
  for (let pass = 0; pass < nodes.length; pass++) {
    let moved = false;
    for (const e of edges) {
      if (depth[e.to] < depth[e.from] + 1) {
        depth[e.to] = depth[e.from] + 1;
        moved = true;
      }
    }
    if (!moved) break;
  }

  const layers = new Map<number, number[]>();
  depth.forEach((d, i) => layers.set(d, [...(layers.get(d) ?? []), i]));
  const maxDepth = Math.max(...depth, 0);

  const BOX_W = direction === "LR" ? 168 : 150;
  const BOX_H = 34;
  const GAP_MAIN = direction === "LR" ? 96 : 58;
  const GAP_CROSS = 14;
  const widest = Math.max(...[...layers.values()].map((l) => l.length), 1);

  const pos = nodes.map((_, i) => {
    const d = depth[i]!;
    const peers = layers.get(d)!;
    const k = peers.indexOf(i);
    // Centre each layer against the widest one.
    const offset = ((widest - peers.length) * (BOX_H + GAP_CROSS)) / 2;
    if (direction === "LR") {
      return {
        x: 8 + d * (BOX_W + GAP_MAIN),
        y: 8 + offset + k * (BOX_H + GAP_CROSS),
      };
    }
    const offsetX = ((widest - peers.length) * (BOX_W + GAP_CROSS)) / 2;
    return {
      x: 8 + offsetX + k * (BOX_W + GAP_CROSS),
      y: 8 + d * (BOX_H + GAP_MAIN),
    };
  });

  const width =
    direction === "LR"
      ? 16 + (maxDepth + 1) * (BOX_W + GAP_MAIN)
      : 16 + widest * (BOX_W + GAP_CROSS);
  const height =
    direction === "LR"
      ? 16 + widest * (BOX_H + GAP_CROSS)
      : 16 + (maxDepth + 1) * (BOX_H + GAP_MAIN);

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      style={{ width: "100%", height: "auto", maxHeight: 340 }}
      role="img"
      aria-label={`Preset graph, ${nodes.length} sessions, ${edges.length} connections`}
    >
      <defs>
        <marker
          id="cv-arrow"
          viewBox="0 0 8 8"
          refX="7"
          refY="4"
          markerWidth="7"
          markerHeight="7"
          orient="auto-start-reverse"
        >
          <path d="M0,0 L8,4 L0,8 z" fill="#3f5f8f" />
        </marker>
      </defs>

      {edges.map((e, i) => {
        const a = pos[e.from]!;
        const b = pos[e.to]!;
        const from =
          direction === "LR"
            ? { x: a.x + BOX_W, y: a.y + BOX_H / 2 }
            : { x: a.x + BOX_W / 2, y: a.y + BOX_H };
        const to =
          direction === "LR"
            ? { x: b.x, y: b.y + BOX_H / 2 }
            : { x: b.x + BOX_W / 2, y: b.y };
        const mid =
          direction === "LR"
            ? `${(from.x + to.x) / 2},${from.y} ${(from.x + to.x) / 2},${to.y}`
            : `${from.x},${(from.y + to.y) / 2} ${to.x},${(from.y + to.y) / 2}`;
        return (
          <path
            key={i}
            d={`M ${from.x},${from.y} C ${mid} ${to.x},${to.y}`}
            fill="none"
            stroke="#3f5f8f"
            strokeWidth="1.3"
            markerEnd="url(#cv-arrow)"
          />
        );
      })}

      {nodes.map((n, i) => {
        const p = pos[i]!;
        const palette = hostPalette(n.host);
        return (
          <g key={i}>
            <rect
              x={p.x}
              y={p.y}
              width={BOX_W}
              height={BOX_H}
              rx="7"
              fill="#15151a"
              stroke={palette.border}
            />
            <circle
              cx={p.x + 11}
              cy={p.y + BOX_H / 2}
              r="3.5"
              fill={palette.fg}
            />
            <text
              x={p.x + 21}
              y={p.y + 14}
              fill="#e6e6e6"
              fontSize="10.5"
              fontFamily="ui-sans-serif, system-ui, sans-serif"
            >
              {n.label.length > 22 ? `${n.label.slice(0, 21)}…` : n.label}
            </text>
            <text
              x={p.x + 21}
              y={p.y + 26}
              fill="#7a7a84"
              fontSize="8.5"
              fontFamily="ui-monospace, Menlo, monospace"
            >
              {n.claude ? "claude" : "shell"} · {n.host}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

/** PlantUML source for the same graph, for pasting into a vault doc. */
export function toPlantUml(name: string, nodes: Node[], edges: Edge[], dir: "LR" | "TD"): string {
  const id = (i: number) => `n${i}`;
  const lines = [
    "@startuml",
    `title ${name}`,
    dir === "LR" ? "left to right direction" : "top to bottom direction",
    "skinparam componentStyle rectangle",
    ...nodes.map(
      (n, i) => `component "${n.label}\\n${n.claude ? "claude" : "shell"} · ${n.host}" as ${id(i)}`,
    ),
    ...edges.map((e) => `${id(e.from)} --> ${id(e.to)}`),
    "@enduml",
  ];
  return lines.join("\n");
}
