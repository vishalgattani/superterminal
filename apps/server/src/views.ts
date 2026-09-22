import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { STATE_DIR } from "./config.ts";

/**
 * The owner's graph views, kept between page loads and viewer restarts.
 *
 * The server does not interpret them. The browser owns what a view means and
 * sends it as one document; this only checks that it is the right shape and a
 * sane size, and writes it atomically, so a bad or truncated write can never
 * replace a good file.
 */
const FILE = join(STATE_DIR, "views.json");
const MAX_BYTES = 512 * 1024;
const MAX_TABS = 100;

export class ViewsStore {
  load(): unknown | null {
    try {
      if (!existsSync(FILE)) return null;
      return JSON.parse(readFileSync(FILE, "utf8"));
    } catch {
      // A damaged file is treated as no saved views rather than an error the
      // owner can do nothing about.
      return null;
    }
  }

  /** Throws with a reason the caller can show when the document is not acceptable. */
  save(doc: unknown): void {
    if (!doc || typeof doc !== "object" || Array.isArray(doc)) {
      throw new Error("views must be an object");
    }
    const d = doc as { version?: unknown; tabs?: unknown };
    if (d.version !== 1) throw new Error("unsupported views version");
    if (!Array.isArray(d.tabs) || d.tabs.length === 0 || d.tabs.length > MAX_TABS) {
      throw new Error(`tabs must be a list of 1 to ${MAX_TABS} views`);
    }
    for (const t of d.tabs as Record<string, unknown>[]) {
      if (!t || typeof t.id !== "string" || typeof t.name !== "string") {
        throw new Error("every view needs an id and a name");
      }
    }
    const text = JSON.stringify(doc);
    if (Buffer.byteLength(text) > MAX_BYTES) throw new Error("views are too large");
    mkdirSync(dirname(FILE), { recursive: true });
    const tmp = `${FILE}.tmp`;
    writeFileSync(tmp, text);
    renameSync(tmp, FILE);
  }
}
