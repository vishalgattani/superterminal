/**
 * The folder tree over a set of sessions.
 *
 * Every session is a node named after its cwd. This adds a node for each
 * ancestor folder and a containment edge from each folder to what it holds, so
 * sessions that live near each other are visibly near each other.
 *
 * Rules that keep it honest:
 *  - Folders are per host. `~/vault` on fire and a local `~/vault` are different
 *    places and never share a node.
 *  - A session already stands for its own folder. If one sits at `~/repos` and
 *    another at `~/repos/api`, the second hangs under the first, not under a
 *    duplicate `repos` node.
 *  - A chain of folders that only lead to one thing is one node (`~/repos`,
 *    not `~` then `repos`), so a deep path does not become a ladder.
 *  - The tree is derived, never stored. It cannot drift from the sessions.
 */
export interface FolderItem {
  /** Node id of the session (or card) this cwd belongs to. */
  id: string;
  host: string;
  cwd: string;
}

export interface FolderNodeInfo {
  id: string;
  /** What the node shows: the folder name, or a merged run like `~/repos`. */
  label: string;
  host: string;
  /** Full path of the deepest folder this node stands for. */
  path: string;
  /** Sessions anywhere below it. */
  count: number;
}

export interface FolderTree {
  folders: FolderNodeInfo[];
  /** Containment: parent (folder or session) to child (folder or session). */
  edges: { source: string; target: string }[];
}

const HOME = /^\/(Users|home)\/[^/]+/;

/**
 * A path as `[root, ...segments]`. Home is the root `~` on each host so that a
 * remote `~`, `/home/me` and `/home/me/x` all share it; anything else roots at `/`.
 */
function segmentsOf(cwd: string): string[] {
  const p = cwd.trim();
  if (!p || p === "~") return ["~"];
  if (p.startsWith("~/")) {
    return ["~", ...p.slice(2).split("/").filter(Boolean)];
  }
  const home = HOME.exec(p);
  if (home) {
    return ["~", ...p.slice(home[0].length).split("/").filter(Boolean)];
  }
  return ["/", ...p.split("/").filter(Boolean)];
}

const keyOf = (host: string, segs: string[]) => `${host}:${segs.join("/")}`;

export function buildFolderTree(items: FolderItem[]): FolderTree {
  // Sessions grouped by where they are, in the order they were given.
  const at = new Map<string, FolderItem[]>();
  const segsByItem = new Map<string, string[]>();
  for (const it of items) {
    const segs = segmentsOf(it.cwd);
    segsByItem.set(it.id, segs);
    const k = keyOf(it.host, segs);
    at.set(k, [...(at.get(k) ?? []), it]);
  }

  interface F {
    id: string;
    label: string;
    host: string;
    path: string;
    /** Children in insertion order: session ids and folder ids. */
    kids: string[];
  }
  const folders = new Map<string, F>(); // by key
  const folderById = new Map<string, F>();
  const parentOf = new Map<string, string>(); // child id -> parent id

  /** The node that stands for a path: its first session, or a folder made on demand. */
  const containerOf = (host: string, segs: string[]): string => {
    const k = keyOf(host, segs);
    const first = at.get(k)?.[0];
    if (first) return first.id;
    let f = folders.get(k);
    if (!f) {
      const last = segs[segs.length - 1]!;
      f = {
        id: `folder:${k}`,
        label: last,
        host,
        path: segs[0] === "/" ? `/${segs.slice(1).join("/")}` : segs.join("/"),
        kids: [],
      };
      folders.set(k, f);
      folderById.set(f.id, f);
      if (segs.length > 1) link(containerOf(host, segs.slice(0, -1)), f.id);
    }
    return f.id;
  };

  const link = (parent: string, child: string) => {
    if (parentOf.has(child)) return;
    parentOf.set(child, parent);
    folderById.get(parent)?.kids.push(child);
  };
  const sessionKids = new Map<string, string[]>(); // session container -> children
  const attach = (parent: string, child: string) => {
    if (folderById.has(parent)) link(parent, child);
    else if (!parentOf.has(child)) {
      parentOf.set(child, parent);
      sessionKids.set(parent, [...(sessionKids.get(parent) ?? []), child]);
    }
  };

  for (const it of items) {
    const segs = segsByItem.get(it.id)!;
    if (segs.length <= 1) continue; // a root: nothing above it
    attach(containerOf(it.host, segs.slice(0, -1)), it.id);
  }
  // Folders made on demand link to their parent through `link`, but a parent
  // that is a session (not a folder) records the edge here instead.
  for (const f of folders.values()) {
    const p = parentOf.get(f.id);
    if (p && !folderById.has(p) && !(sessionKids.get(p) ?? []).includes(f.id)) {
      sessionKids.set(p, [...(sessionKids.get(p) ?? []), f.id]);
    }
  }

  const kidsOf = (id: string): string[] => folderById.get(id)?.kids ?? sessionKids.get(id) ?? [];

  // Merge a folder into its only child when that child is also a folder.
  let merged = true;
  while (merged) {
    merged = false;
    for (const f of [...folderById.values()]) {
      if (!folderById.has(f.id)) continue;
      if (f.kids.length !== 1) continue;
      const c = folderById.get(f.kids[0]!);
      if (!c) continue; // a session: it keeps its own node
      f.label = f.label === "/" ? `/${c.label}` : `${f.label}/${c.label}`;
      f.path = c.path;
      f.kids = c.kids;
      for (const k of c.kids) parentOf.set(k, f.id);
      folderById.delete(c.id);
      parentOf.delete(c.id);
      merged = true;
    }
  }

  const edges: { source: string; target: string }[] = [];
  const count = (id: string): number => {
    const kids = folderById.has(id) ? folderById.get(id)!.kids : kidsOf(id);
    return kids.reduce((n, k) => n + (folderById.has(k) ? count(k) : 1 + countSessions(k)), 0);
  };
  const countSessions = (id: string): number =>
    (sessionKids.get(id) ?? []).reduce(
      (n, k) => n + (folderById.has(k) ? count(k) : 1 + countSessions(k)),
      0,
    );

  for (const [child, parent] of parentOf) {
    if (folderById.has(parent) || items.some((i) => i.id === parent)) {
      edges.push({ source: parent, target: child });
    }
  }

  return {
    folders: [...folderById.values()].map((f) => ({
      id: f.id,
      label: f.label,
      host: f.host,
      path: f.path,
      count: count(f.id),
    })),
    edges,
  };
}
