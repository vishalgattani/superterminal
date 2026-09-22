import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { STATE_DIR } from "./config.ts";
import type { PtyManager } from "./pty/manager.ts";

export interface Link {
  id: string;
  source: string;
  target: string;
}

/** The server's links and the functions that keep them on disk. */
export interface LinkStore {
  links: Map<string, Link>;
  persistLinks: () => void;
  restoreLinks: () => number;
  linkExists: (source: string, target: string) => boolean;
}

export function createLinkStore(ptys: PtyManager): LinkStore {
  /**
   * Context links between terminals, owned by the server.
   *
   * They live here rather than in the browser because they are a capability,
   * not decoration: injecting text into a session is only permitted along a
   * link the owner drew. Server-side also means they survive a reload and are
   * shared by every tab.
   *
   * Many-to-many by design: a terminal may feed several others and be fed by
   * several. Only self-links and exact duplicates are refused.
   */
  const links = new Map<string, { id: string; source: string; target: string }>();

  /**
   * Links survive a restart, keyed by tmux session name.
   *
   * Terminal ids are minted fresh on every run, so storing them would restore
   * nothing: after a restart the re-adopted sessions have new uuids. The tmux
   * name is the stable identity of a remote session, so that is what goes to
   * disk. Local links are deliberately not persisted, because a local pty dies
   * with the server and there would be nothing to reconnect them to.
   */
  const LINKS_FILE = join(STATE_DIR, "links.json");

  function persistLinks(): void {
    const rows: { source: string; target: string }[] = [];
    for (const l of links.values()) {
      const s = ptys.get(l.source)?.info.tmuxSession;
      const t = ptys.get(l.target)?.info.tmuxSession;
      if (s && t) rows.push({ source: s, target: t });
    }
    try {
      mkdirSync(dirname(LINKS_FILE), { recursive: true });
      const tmp = `${LINKS_FILE}.tmp`;
      writeFileSync(tmp, JSON.stringify(rows, null, 2));
      renameSync(tmp, LINKS_FILE);
    } catch {
      // Losing the link file is cosmetic: the sessions themselves are intact.
    }
  }

  /** Rebuild links from disk once sessions have been re-adopted. */
  function restoreLinks(): number {
    let rows: { source: string; target: string }[] = [];
    try {
      if (!existsSync(LINKS_FILE)) return 0;
      rows = JSON.parse(readFileSync(LINKS_FILE, "utf8"));
    } catch {
      return 0;
    }
    const byTmux = new Map(
      ptys
        .list()
        .filter((s) => s.tmuxSession)
        .map((s) => [s.tmuxSession!, s.sessionId]),
    );
    let restored = 0;
    for (const row of rows) {
      const source = byTmux.get(row.source);
      const target = byTmux.get(row.target);
      // A link whose sessions are gone is dropped rather than kept as a
      // capability pointing at nothing.
      if (!source || !target || linkExists(source, target)) continue;
      const id = `${source}->${target}`;
      links.set(id, { id, source, target });
      restored++;
    }
    if (restored > 0) console.log(`[cv] restored ${restored} link(s)`);
    return restored;
  }

  function linkExists(source: string, target: string): boolean {
    for (const l of links.values()) {
      if (l.source === source && l.target === target) return true;
    }
    return false;
  }

  return { links, persistLinks, restoreLinks, linkExists };
}
