import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  ReactFlow,
  type Connection,
  type Edge,
  type EdgeChange,
  type Node,
  type NodeChange,
  type NodeMouseHandler,
  useReactFlow,
  ReactFlowProvider,
  ViewportPortal,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { AddToView } from "./AddToView.tsx";
import { FolderNode, type FolderNodeData } from "./FolderNode.tsx";
import { ForeignNode, type ForeignNodeData } from "./ForeignNode.tsx";
import { GroupFrames } from "./GroupFrames.tsx";
import { NoteNode } from "./NoteNode.tsx";
import { ReconnectNode, type ReconnectNodeData } from "./ReconnectNode.tsx";
import { SaveGraph } from "./SaveGraph.tsx";
import { SessionNode, type SessionNodeData } from "./SessionNode.tsx";
import { buildFolderTree } from "../lib/folders.ts";
import { externalOrphans, foreignId, useStore, viewSessionIds, OVERVIEW_TAB } from "../store.ts";
import { NOTE_PREFIX } from "../store/model.ts";
import { hostPalette } from "../lib/hostColour.ts";
import { isRemoteHost } from "@cv/shared";
import { canvasEnd } from "../lib/edgeEnds.ts";

/** Stable identity: a fresh {} each render would re-render the canvas forever. */
const EMPTY_COUNTS: Record<string, number> = {};

// Registered once at module level: inlining this remounts every node on each
// render.
const nodeTypes = {
  session: SessionNode,
  foreign: ForeignNode,
  folder: FolderNode,
  reconnect: ReconnectNode,
  note: NoteNode,
};

/** Last path segment, or "~" for a home directory. */
function folderName(cwd: string): string {
  if (!cwd || cwd === "~") return "~";
  if (/^\/(Users|home)\/[^/]+\/?$/.test(cwd)) return "~";
  return cwd.split("/").filter(Boolean).pop() || "~";
}

/** Right-click the canvas to start a terminal where you clicked. */
interface Menu {
  x: number;
  y: number;
  flowX: number;
  flowY: number;
}

export function Graph() {
  // The provider is needed for screenToFlowPosition, which turns a right-click
  // into canvas coordinates so a new node lands under the cursor.
  return (
    <ReactFlowProvider>
      <GraphInner />
    </ReactFlowProvider>
  );
}

function GraphInner() {
  const sessions = useStore((s) => s.sessions);
  const order = useStore((s) => s.order);
  const positions = useStore((s) => s.positions);
  const tabs = useStore((s) => s.tabs);
  const activeTab = useStore((s) => s.activeTab);
  // Each tab keeps its own layout; a node not yet placed in this tab falls
  // back to its default position rather than stacking at the origin.
  const activeTabObj = tabs.find((t) => t.id === activeTab);
  const tabPositions = activeTabObj?.positions ?? {};
  // The overview shows everything; any other view shows the sessions it lists.
  const isSubset = Boolean(activeTabObj?.members);
  const viewIds = useMemo(
    () => viewSessionIds(activeTabObj, order, sessions),
    [activeTabObj, order, sessions],
  );
  const [adding, setAdding] = useState(false);
  const showFolders = useStore((s) => s.showFolders);
  const setShowFolders = useStore((s) => s.setShowFolders);
  const treeFlow = useStore((s) => s.treeFlow);
  const removeFromView = useStore((s) => s.removeFromView);
  const openSessionId = useStore((s) => s.openSessionId);
  const exited = useStore((s) => s.exited);
  const subagentCounts = useStore((s) => s.subagents?.counts ?? EMPTY_COUNTS);
  const subagentsFetchedAt = useStore((s) => s.subagents?.fetchedAt ?? 0);
  const activity = useStore((s) => s.activity);
  const setPosition = useStore((s) => s.setPosition);
  const toggleOpen = useStore((s) => s.toggleOpen);
  const links = useStore((s) => s.links);
  const addLink = useStore((s) => s.addLink);
  const removeLink = useStore((s) => s.removeLink);
  const sendReference = useStore((s) => s.sendReference);
  const hosts = useStore((s) => s.hosts);
  const createAt = useStore((s) => s.createSessionAt);
  const [menu, setMenu] = useState<Menu | null>(null);
  const [nodeMenu, setNodeMenu] = useState<{ x: number; y: number; id: string } | null>(null);
  const [edgeMenu, setEdgeMenu] = useState<{ x: number; y: number; id: string } | null>(null);
  // React Flow only drags a group if the nodes are actually marked selected,
  // and it expects us to apply its select changes. Without this, Cmd+click
  // highlighted nothing and every drag moved a single node.
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  // Kept apart from selectedIds: a note is not a session, so it must never be
  // swept into a frame or a preset's member list.
  const [selectedNote, setSelectedNote] = useState<string | null>(null);
  const addNote = useStore((s) => s.addNote);
  const updateNote = useStore((s) => s.updateNote);
  const groupNodes = useStore((s) => s.groupNodes);
  const groups = tabs.find((t) => t.id === activeTab)?.groups ?? [];
  const forkSession = useStore((s) => s.forkSession);
  const askClose = useStore((s) => s.askClose);
  const startRename = useStore((s) => s.startRename);
  const moveToView = useStore((s) => s.moveToView);
  const toggleOpenFn = useStore((s) => s.toggleOpen);
  const closePanel = useStore((s) => s.close);
  const { screenToFlowPosition, fitView, getNode, setCenter, getZoom } = useReactFlow();
  const orphans = useStore((s) => s.orphans);
  const showForeign = useStore((s) => s.showForeign);
  const setShowForeign = useStore((s) => s.setShowForeign);
  const external = useMemo(() => externalOrphans(orphans, sessions), [orphans, sessions]);

  // Sessions the viewer did not start, drawn as read-only cards. They sit in a
  // block below the terminals until dragged, and a dragged position is kept per
  // view like any other node's. The block starts one slot past the terminal
  // grid so a terminal added next cannot land on top of a card. Slots are wider
  // than a terminal's because a card can grow to 340px.
  const foreignNodes: Node<ForeignNodeData>[] = useMemo(() => {
    // External cards belong to the overview: a subset view is the sessions you
    // chose, and attaching one from the overview adds it to the view you are in.
    if (!showForeign || isSubset) return [];
    const top = 40 + Math.ceil((viewIds.length + 1) / 3) * 130 + 30;
    return external.map((o, i) => {
      const id = foreignId(o);
      return {
        id,
        type: "foreign",
        position: tabPositions[id] ??
          positions[id] ?? { x: 40 + (i % 3) * 370, y: top + Math.floor(i / 3) * 150 },
        // Not selectable: they cannot be grouped, linked or saved into a preset,
        // so a selection box sweeping over one must not pick it up.
        selectable: false,
        data: {
          orphan: o,
          // An external session's fan-out is the least visible of all: it has
          // no terminal here, so the transcript scan is the only thing that
          // knows about it.
          subagents: subagentCounts[o.sessionId],
          subagentsScannedAt: subagentsFetchedAt,
        },
      };
    });
  }, [external, showForeign, isSubset, viewIds.length, positions, tabPositions]);

  const retained = useStore((s) => s.retained);

  // Saved members whose sessions did not come back, shown as actionable
  // "reconnect" cards. Scoped like everything else: the overview shows keys
  // parked at the top level, a subset view shows only the ones that were
  // parked for it specifically.
  const reconnectNodes: Node<ReconnectNodeData>[] = useMemo(() => {
    const isOverview = activeTab === OVERVIEW_TAB;
    const keys = isOverview
      ? Object.keys(retained.positions)
      : (retained.tabs[activeTab]?.members ?? []);
    const posSource = isOverview ? retained.positions : (retained.tabs[activeTab]?.positions ?? {});
    const top = 40 + Math.ceil((viewIds.length + 1) / 3) * 130 + 200;
    return keys
      .filter((k) => retained.meta[k]?.claudeSessionId)
      .map((k, i) => ({
        id: `reconnect:${k}`,
        type: "reconnect",
        position: posSource[k] ?? { x: 40 + (i % 3) * 260, y: top + Math.floor(i / 3) * 130 },
        selectable: false,
        data: { key: k, meta: retained.meta[k]! },
      }));
  }, [retained, activeTab, viewIds.length]);

  const baseNodes: Node[] = useMemo(
    () => [
      ...foreignNodes,
      ...reconnectNodes,
      ...viewIds
        .map((id, i) => {
          const info = sessions[id]!;
          return {
            id,
            type: "session",
            // A subset view lays out its own sessions from the start; the
            // shared fallback positions belong to the overview.
            position:
              tabPositions[id] ??
              (isSubset
                ? { x: 40 + (i % 3) * 240, y: 40 + Math.floor(i / 3) * 130 }
                : (positions[id] ?? { x: 40, y: 40 })),
            selected: selectedIds.has(id),
            data: {
              // Alias first, then the folder. The folder is short and is what
              // actually identifies a session; the full command is long
              // (a fire session's is "ssh user@host · tmux cv-xxxx") and
              // belongs in the hover card, not on a 210px card.
              label: info.alias || folderName(info.cwd),
              named: Boolean(info.alias),
              host: info.host,
              cwd: info.cwd,
              shell: info.shell,
              cols: info.cols,
              rows: info.rows,
              startedAt: info.startedAt,
              sessionId: info.sessionId,
              open: openSessionId === id,
              selected: selectedIds.has(id),
              exited: Boolean(exited[id]),
              // Only tmux-backed hosts can rejoin an existing remote session,
              // which is every host but local.
              canReattach: isRemoteHost(info.host),
              model: activity[id]?.liveModel ?? info.model,
              effort: activity[id]?.effort,
              costUsd: activity[id]?.costUsd,
              contextPct: activity[id]?.contextPct,
              claudeName: activity[id]?.claudeName,
              claudeSessionId: activity[id]?.claudeSessionId,
              // Keyed by Claude's session id, not the terminal's: subagents
              // belong to the Claude, and a re-adopted terminal has a new id.
              subagents: subagentCounts[activity[id]?.claudeSessionId ?? ""],
              subagentsScannedAt: subagentsFetchedAt,
            },
          };
        }),
    ],
    [
      foreignNodes,
      reconnectNodes,
      sessions,
      viewIds,
      isSubset,
      positions,
      tabPositions,
      openSessionId,
      exited,
      activity,
      selectedIds,
    ],
  );

  // The folder tree over what this view shows (and the external cards, when they
  // are shown). Derived on every render from the sessions, never stored.
  const tree = useMemo(() => {
    if (!showFolders) return null;
    const items = viewIds.map((id) => ({
      id,
      host: sessions[id]!.host as string,
      cwd: sessions[id]!.cwd,
    }));
    if (showForeign && !isSubset) {
      for (const o of external) items.push({ id: foreignId(o), host: o.host, cwd: o.cwd ?? "~" });
    }
    return buildFolderTree(items);
  }, [showFolders, viewIds, sessions, showForeign, isSubset, external]);

  // A folder sits above what it holds (or to its left in a left-to-right tree)
  // until it is dragged or arranged, so it follows its sessions when they move.
  const folderNodes: Node<FolderNodeData>[] = useMemo(() => {
    if (!tree) return [];
    const drawn = new Map(baseNodes.map((n) => [n.id, n.position]));
    const kids = new Map<string, string[]>();
    for (const e of tree.edges) kids.set(e.source, [...(kids.get(e.source) ?? []), e.target]);
    const isFolder = new Set(tree.folders.map((f) => f.id));
    const placed = new Map<string, { x: number; y: number }>();
    const place = (id: string): { x: number; y: number } => {
      const known = placed.get(id) ?? tabPositions[id];
      if (known) return known;
      const below = (kids.get(id) ?? [])
        .map((k) => (isFolder.has(k) ? place(k) : drawn.get(k)))
        .filter((p): p is { x: number; y: number } => Boolean(p));
      const at =
        below.length === 0
          ? { x: 40, y: 40 }
          : treeFlow === "LR"
            ? {
                x: Math.min(...below.map((p) => p.x)) - 260,
                y: below.reduce((n, p) => n + p.y, 0) / below.length,
              }
            : {
                x: below.reduce((n, p) => n + p.x, 0) / below.length,
                y: Math.min(...below.map((p) => p.y)) - 130,
              };
      placed.set(id, at);
      return at;
    };
    return tree.folders.map((f) => ({
      id: f.id,
      type: "folder",
      position: place(f.id),
      // Structure, not a session: it cannot be grouped, linked or saved.
      selectable: false,
      data: { label: f.label, host: f.host, path: f.path, count: f.count },
    }));
  }, [tree, baseNodes, tabPositions, treeFlow]);

  const noteNodes: Node[] = useMemo(
    () =>
      (activeTabObj?.notes ?? []).map((n) => ({
        id: n.id,
        type: "note",
        position: { x: n.x, y: n.y },
        width: n.w,
        height: n.h,
        selected: selectedNote === n.id,
        data: { text: n.text },
      })),
    [activeTabObj?.notes, selectedNote],
  );

  const nodes: Node[] = useMemo(
    () => [...noteNodes, ...folderNodes, ...baseNodes],
    [noteNodes, folderNodes, baseNodes],
  );

  // Turning the tree on puts folders above the sessions, usually off the top of
  // the screen, so bring everything into view. Only on the toggle: not on every
  // change, or the view would jump while you work.
  const wasShowing = useRef(showFolders);
  useEffect(() => {
    if (showFolders && !wasShowing.current) {
      const t = setTimeout(() => void fitView({ padding: 0.15, duration: 250 }), 80);
      wasShowing.current = showFolders;
      return () => clearTimeout(t);
    }
    wasShowing.current = showFolders;
  }, [showFolders, fitView]);

  // Opening a terminal (click, palette, Shift+Tab, a new session) pans the
  // graph to its node, keeping the zoom. Deferred so a view switch from the
  // palette has rendered the node before we look it up.
  useEffect(() => {
    if (!openSessionId) return;
    const t = setTimeout(() => {
      const n = getNode(openSessionId);
      if (!n) return;
      const w = n.measured?.width ?? 210;
      const h = n.measured?.height ?? 80;
      void setCenter(n.position.x + w / 2, n.position.y + h / 2, {
        zoom: getZoom(),
        duration: 250,
      });
    }, 80);
    return () => clearTimeout(t);
  }, [openSessionId, activeTab, getNode, setCenter, getZoom]);

  // Where each session is actually drawn, so frames enclose what is on screen
  // (a subset view's default slots are not in any stored map).
  const framePositions = useMemo(
    () =>
      Object.fromEntries(
        nodes.filter((n) => n.type === "session").map((n) => [n.id, n.position]),
      ),
    [nodes],
  );

  // An edge means "the target may refer to the source", so it is directional
  // and labelled. Creating one immediately offers to tell the target about it.
  const edges: Edge[] = useMemo(
    () => {
      // A link's ends are session ids. A terminal's canvas id is its session
      // id, but a session the viewer did not start is a `foreign:` card, so
      // both ends are resolved rather than used raw — otherwise an edge from
      // an observed session points at a node that does not exist and is
      // silently not drawn.
      const termIds = new Set(viewIds);
      return links
        .map((l) => ({
          link: l,
          source: canvasEnd(l.source, termIds, external),
          target: canvasEnd(l.target, termIds, external),
        }))
        .filter(
          (e): e is { link: typeof e.link; source: string; target: string } =>
            Boolean(e.source && e.target),
        )
        .map(({ link: l, source, target }) => ({
        id: l.id,
        source,
        target,
        sourceHandle: "context-out",
        targetHandle: "context-in",
        animated: true,
        label: "context",
        labelStyle: { fill: "#8fc0f0", fontSize: 10 },
        labelBgStyle: { fill: "#15151a" },
        style: { stroke: "#3f5f8f" },
      }));
    },
    [links, viewIds, external],
  );

  // Containment lines are a different kind of edge on purpose: faint, dashed,
  // headless and unlabelled, so a folder holding a session never reads as a
  // context link (which is a capability). They cannot be selected or removed.
  const treeEdges: Edge[] = useMemo(
    () =>
      (tree?.edges ?? []).map((e) => ({
        id: `contain:${e.source}>${e.target}`,
        source: e.source,
        target: e.target,
        sourceHandle: treeFlow === "LR" ? "tree-l-out" : "tree-t-out",
        targetHandle: treeFlow === "LR" ? "tree-l-in" : "tree-t-in",
        type: "smoothstep",
        selectable: false,
        focusable: false,
        deletable: false,
        zIndex: -1,
        style: {
          stroke: "#7f93b5",
          strokeOpacity: 0.35,
          strokeWidth: 1.2,
          strokeDasharray: "2 5",
        },
      })),
    [tree, treeFlow],
  );

  const onConnect = useCallback(
    async (c: Connection) => {
      if (!c.source || !c.target) return;
      // The link must exist server-side before the reference is sent: the
      // server refuses input that does not travel along one.
      await addLink(c.source, c.target);
      await sendReference(c.source, c.target);
    },
    [addLink, sendReference],
  );

  const onEdgesChange = useCallback(
    (changes: EdgeChange[]) => {
      for (const c of changes) {
        // Containment lines are derived from the folders and are not links.
        if (c.type === "remove" && !c.id.startsWith("contain:")) void removeLink(c.id);
      }
    },
    [removeLink],
  );

  const onNodesChange = useCallback(
    (changes: NodeChange[]) => {
      let nextSelection: Set<string> | undefined;
      for (const c of changes) {
        if ("id" in c && c.id.startsWith(NOTE_PREFIX)) {
          if (c.type === "position" && c.position) updateNote(c.id, c.position);
          // Only a resize the owner made; React Flow's own measuring reports
          // dimensions too, and must not overwrite the saved size.
          else if (c.type === "dimensions" && c.resizing && c.dimensions) {
            updateNote(c.id, { w: c.dimensions.width, h: c.dimensions.height });
          } else if (c.type === "select") setSelectedNote(c.selected ? c.id : null);
          continue;
        }
        if (c.type === "position" && c.position) {
          // Fires for every node in a multi-node drag, so the whole
          // selection moves together.
          setPosition(c.id, c.position);
        } else if (c.type === "select") {
          nextSelection = nextSelection ?? new Set(selectedIds);
          if (c.selected) nextSelection.add(c.id);
          else nextSelection.delete(c.id);
        }
      }
      if (nextSelection) setSelectedIds(nextSelection);
    },
    [setPosition, selectedIds, updateNote],
  );

  // Click a node to open its terminal; click the open one again to collapse.
  const onNodeClick: NodeMouseHandler = useCallback(
    (e, node) => {
      // A modifier click is about selection, not opening: Cmd/Ctrl extends the
      // selection and Shift box-selects, so neither should also swap the
      // terminal panel under you.
      const ev = e as unknown as MouseEvent;
      if (ev.metaKey || ev.ctrlKey || ev.shiftKey) return;
      // Only a session has a terminal to open; cards and folders do not.
      if (node.type !== "session") return;
      toggleOpen(node.id);
    },
    [toggleOpen],
  );

  return (
    <>
    {/* Save the current graph as a preset without leaving the canvas. */}
    <SaveGraph />
    <div style={toolbar}>
      {selectedIds.size > 1 && (
        <button
          style={pill}
          title={`Enclose ${selectedIds.size} selected sessions in a named frame`}
          onClick={() => {
            groupNodes([...selectedIds]);
            setSelectedIds(new Set());
          }}
        >
          Group {selectedIds.size}
        </button>
      )}
      <button
        style={{ ...pill, color: showFolders ? "#e6e6e6" : "#80808a" }}
        aria-pressed={showFolders}
        title={
          showFolders
            ? "Hide the folder tree"
            : "Show the folders these sessions live in, joined by faint lines"
        }
        onClick={() => setShowFolders(!showFolders)}
      >
        Folders
      </button>
      {isSubset && (
        <button
          style={pill}
          title="Choose which sessions this view shows"
          onClick={() => setAdding(true)}
        >
          + Add sessions
        </button>
      )}
      {!isSubset && external.length > 0 && (
        <button
          style={{ ...pill, color: showForeign ? "#e6e6e6" : "#80808a" }}
          aria-pressed={showForeign}
          title={
            showForeign
              ? "Hide live Claude sessions this viewer did not start"
              : "Show live Claude sessions this viewer did not start"
          }
          onClick={() => setShowForeign(!showForeign)}
        >
          {showForeign ? "External" : "External, hidden"} · {external.length}
        </button>
      )}
    </div>
    {adding && <AddToView onClose={() => setAdding(false)} />}
    {isSubset && viewIds.length === 0 && order.length > 0 && !adding && (
      <div style={emptyView}>
        <strong style={{ fontSize: 13 }}>This view is empty</strong>
        <span style={{ fontSize: 12, color: "#80808a" }}>
          A view shows only the sessions you choose. The main view keeps showing all
          of them.
        </span>
        <button
          style={{ ...pill, pointerEvents: "auto" }}
          onClick={() => setAdding(true)}
        >
          + Add sessions
        </button>
      </div>
    )}
    <ReactFlow
      nodes={nodes}
      edges={[...treeEdges, ...edges]}
      nodeTypes={nodeTypes}
      onNodesChange={onNodesChange}
      onEdgesChange={onEdgesChange}
      onConnect={onConnect}
      onNodeClick={onNodeClick}
      proOptions={{ hideAttribution: false }}
      fitView={false}
      minZoom={0.3}
      maxZoom={2}
      // Double-click renames a node, so the canvas must not also zoom on it.
      // Otherwise every rename jumps the viewport.
      zoomOnDoubleClick={false}
      // Cmd on a Mac, Ctrl elsewhere, for adding to a selection. Shift-drag
      // on empty canvas draws a selection box.
      multiSelectionKeyCode={["Meta", "Control"]}
      selectionKeyCode="Shift"
      // A click on a node should select it, so a following Cmd+click extends
      // that selection rather than starting over.
      selectNodesOnDrag
      deleteKeyCode={null}
      onPaneContextMenu={(e) => {
        e.preventDefault();
        const ev = e as React.MouseEvent;
        setNodeMenu(null);
        setEdgeMenu(null);
        setMenu({
          x: ev.clientX,
          y: ev.clientY,
          // Remember where on the canvas the click landed, so the new node
          // appears under the cursor rather than in the default stack.
          ...(() => {
            const p = screenToFlowPosition({ x: ev.clientX, y: ev.clientY });
            return { flowX: p.x, flowY: p.y };
          })(),
        });
      }}
      onPaneClick={() => {
        setMenu(null);
        setNodeMenu(null);
        setEdgeMenu(null);
        // Empty canvas means "back to the graph": give it the room until a
        // node is clicked again. A pan is a drag, not a click, so it keeps
        // the pane open.
        closePanel();
      }}
      onMoveStart={() => {
        setMenu(null);
        setNodeMenu(null);
        setEdgeMenu(null);
      }}
      onNodeContextMenu={(e, node) => {
        e.preventDefault();
        // The node menu is about terminals (rename, fork, close); an external
        // card has its own buttons and a folder has none.
        if (node.type !== "session") return;
        const ev = e as React.MouseEvent;
        setMenu(null);
        setEdgeMenu(null);
        setNodeMenu({ x: ev.clientX, y: ev.clientY, id: node.id });
      }}
      // deleteKeyCode is off so a stray Backspace cannot close a terminal,
      // which also leaves no keyboard way to delete a link: this menu is it.
      onEdgeContextMenu={(e, edge) => {
        e.preventDefault();
        if (edge.id.startsWith("contain:")) return;
        setMenu(null);
        setNodeMenu(null);
        setEdgeMenu({ x: e.clientX, y: e.clientY, id: edge.id });
      }}
      colorMode="dark"
      style={{ background: "#0e0e11" }}
    >
      {/* Inside the viewport so frames pan and zoom with the nodes. */}
      <ViewportPortal>
        <GroupFrames
          groups={groups}
          positions={framePositions}
        />
      </ViewportPortal>
      <Background variant={BackgroundVariant.Dots} gap={18} size={1} color="#26262e" />
      <Controls showInteractive={false} />
      <MiniMap
        pannable
        zoomable
        style={{ background: "#15151a" }}
        maskColor="#0e0e11cc"
        nodeColor={(n) => {
          // External cards carry their host inside the orphan record.
          if (n.type === "folder") return "#4a5468";
          if (n.type === "note") return "#5a5538";
          const host =
            n.type === "foreign"
              ? (n.data as ForeignNodeData).orphan.host
              : (n.data as SessionNodeData)?.host;
          return hostPalette(host).fg;
        }}
      />
    </ReactFlow>

    {nodeMenu && (
      <>
      <div
        style={backdrop}
        onMouseDown={() => setNodeMenu(null)}
        onContextMenu={(e) => {
          e.preventDefault();
          setNodeMenu(null);
        }}
      />
      <div
        style={{ ...menuBox, left: nodeMenu.x, top: nodeMenu.y }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div style={menuTitle}>
          {sessions[nodeMenu.id]?.alias || folderName(sessions[nodeMenu.id]?.cwd ?? "")}
        </div>
        <button
          style={menuItem}
          onClick={() => {
            const id = nodeMenu.id;
            setNodeMenu(null);
            toggleOpenFn(id);
          }}
        >
          Open terminal
        </button>
        <button
          style={menuItem}
          onClick={() => {
            const id = nodeMenu.id;
            setNodeMenu(null);
            startRename(id);
          }}
        >
          Rename
        </button>
        {/* Fork only means something when a Claude session is running here:
            there is nothing to branch from a plain shell, so it is shown but
            disabled rather than hidden, with the reason in the tooltip. */}
        <button
          style={{
            ...menuItem,
            opacity: activity[nodeMenu.id]?.claudeSessionId ? 1 : 0.4,
            cursor: activity[nodeMenu.id]?.claudeSessionId ? "pointer" : "not-allowed",
          }}
          disabled={!activity[nodeMenu.id]?.claudeSessionId}
          title={
            activity[nodeMenu.id]?.claudeSessionId
              ? "Branch this Claude session into a new terminal (--fork-session)"
              : "No Claude session running in this terminal"
          }
          onClick={() => {
            const id = nodeMenu.id;
            setNodeMenu(null);
            void forkSession(id);
          }}
        >
          Fork session
        </button>
        <div style={menuTitle}>Move to view</div>
        {tabs
          // The overview shows every session already, so it is never a target.
          .filter((t) => t.id !== activeTab && t.members)
          .map((t) => (
            <button
              key={t.id}
              style={menuItem}
              onClick={() => {
                const id = nodeMenu.id;
                setNodeMenu(null);
                moveToView([id], t.id);
              }}
            >
              {t.name}
            </button>
          ))}
        <button
          style={menuItem}
          onClick={() => {
            const id = nodeMenu.id;
            setNodeMenu(null);
            moveToView([id], null);
          }}
        >
          New view
        </button>
        {/* Leaving a view is not closing a session: this only stops showing it
            here, and it stays on the overview and in every other view. */}
        {isSubset && (
          <button
            style={menuItem}
            title="Stop showing this session in this view. It keeps running."
            onClick={() => {
              const id = nodeMenu.id;
              setNodeMenu(null);
              removeFromView([id]);
            }}
          >
            Remove from this view
          </button>
        )}
        <button
          style={{ ...menuItem, color: "#e08a8a" }}
          onClick={() => {
            const id = nodeMenu.id;
            setNodeMenu(null);
            askClose(id);
          }}
        >
          Close session…
        </button>
      </div>
      </>
    )}

    {edgeMenu && (
      <>
      <div
        style={backdrop}
        onMouseDown={() => setEdgeMenu(null)}
        onContextMenu={(e) => {
          e.preventDefault();
          setEdgeMenu(null);
        }}
      />
      <div
        style={{ ...menuBox, left: edgeMenu.x, top: edgeMenu.y }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div style={menuTitle}>Context link</div>
        <button
          style={{ ...menuItem, color: "#e08a8a" }}
          onClick={() => {
            const id = edgeMenu.id;
            setEdgeMenu(null);
            void removeLink(id);
          }}
        >
          Disconnect
        </button>
      </div>
      </>
    )}

    {menu && (
      <>
      {/* A full-screen backdrop closes the menu on any outside click.
          onMouseLeave was unreliable: moving the cursor toward an item could
          exit the box and unmount it before the click landed. */}
      <div style={backdrop} onMouseDown={() => setMenu(null)} onContextMenu={(e) => { e.preventDefault(); setMenu(null); }} />
      <div
        style={{ ...menuBox, left: menu.x, top: menu.y }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div style={menuTitle}>New terminal</div>
        {hosts.map((h) => (
          <button
            key={h.id}
            disabled={!h.available}
            title={h.available ? undefined : h.reason}
            onClick={() => {
              setMenu(null);
              void createAt(h.id, { x: menu.flowX, y: menu.flowY });
            }}
            style={{ ...menuItem, opacity: h.available ? 1 : 0.45 }}
          >
            {h.label}
          </button>
        ))}
        <div style={menuTitle}>Annotate</div>
        <button
          style={menuItem}
          onClick={() => {
            setMenu(null);
            addNote(menu.flowX, menu.flowY);
          }}
        >
          Add note
        </button>
      </div>
      </>
    )}
    </>
  );
}

const backdrop: React.CSSProperties = {
  position: "fixed",
  inset: 0,
  zIndex: 49,
};

const toolbar: React.CSSProperties = {
  position: "absolute",
  top: 10,
  left: 10,
  zIndex: 10,
  display: "flex",
  gap: 6,
};

const emptyView: React.CSSProperties = {
  position: "absolute",
  inset: 0,
  zIndex: 5,
  display: "grid",
  placeContent: "center",
  justifyItems: "center",
  gap: 8,
  textAlign: "center",
  maxWidth: 360,
  margin: "0 auto",
  pointerEvents: "none",
};

const pill: React.CSSProperties = {
  background: "#22222c",
  border: "1px solid #3a3a46",
  color: "#e6e6e6",
  borderRadius: 7,
  padding: "5px 11px",
  cursor: "pointer",
  font: "inherit",
  fontSize: 11.5,
};

const menuBox: React.CSSProperties = {
  position: "fixed",
  zIndex: 50,
  minWidth: 190,
  background: "#15151a",
  border: "1px solid #33333d",
  borderRadius: 8,
  padding: 4,
  boxShadow: "0 12px 30px #000000aa",
};

const menuTitle: React.CSSProperties = {
  fontSize: 10,
  color: "#6a6a73",
  padding: "4px 8px 5px",
  textTransform: "uppercase",
  letterSpacing: 0.4,
};

const menuItem: React.CSSProperties = {
  display: "block",
  width: "100%",
  textAlign: "left",
  background: "transparent",
  border: "none",
  color: "#e6e6e6",
  padding: "5px 8px",
  borderRadius: 5,
  cursor: "pointer",
  font: "inherit",
  fontSize: 12,
};
