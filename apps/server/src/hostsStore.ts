import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { STATE_DIR, buildRemote, validateHostId, type RemoteConfig, type RemoteInput } from "./config.ts";

/**
 * Remotes added from the UI, rather than by hand-editing config.env.
 *
 * `config.env` is still how a host is declared for good: it is what survives a
 * fresh clone and is the documented path (see config.example.env). This is the
 * other one, for the case that used to mean opening a text editor and
 * restarting the server: "I have a second box, let me point the viewer at it."
 * Added hosts take effect immediately, no restart, and persist across one.
 *
 * Kept separate from config.env on purpose. Writing an env file back out is
 * more ways to get wrong (quoting, comments, the CV_FIRE_* legacy keys) than
 * reading one, and a host added here should not silently start editing a file
 * the owner may be tracking by hand.
 */
const FILE = join(STATE_DIR, "hosts.json");
const MAX_HOSTS = 50;

export class HostsStore {
  private cache: RemoteInput[] | null = null;

  private read(): RemoteInput[] {
    if (this.cache) return this.cache;
    try {
      if (!existsSync(FILE)) return (this.cache = []);
      const raw = JSON.parse(readFileSync(FILE, "utf8"));
      this.cache = Array.isArray(raw) ? raw : [];
    } catch {
      // A damaged file is treated as no added hosts, not an error the owner
      // can do nothing about; config.env-declared hosts are unaffected.
      this.cache = [];
    }
    return this.cache;
  }

  private write(rows: RemoteInput[]): void {
    mkdirSync(dirname(FILE), { recursive: true });
    const tmp = `${FILE}.tmp`;
    writeFileSync(tmp, JSON.stringify(rows, null, 2));
    renameSync(tmp, FILE);
    this.cache = rows;
  }

  /** Every added remote, built through the same defaults a config.env slot gets. */
  list(): RemoteConfig[] {
    return this.read().map((r) => buildRemote(r));
  }

  /**
   * Add a host. `existingIds` is every id already in use (config.env hosts
   * plus this store's own), so a name already spoken for by either source is
   * refused with the same message either way.
   */
  add(input: RemoteInput, existingIds: string[]): RemoteConfig {
    const id = input.id.trim();
    const err = validateHostId(id, existingIds);
    if (err) throw new Error(err);
    const sshTarget = input.sshTarget.trim();
    if (!sshTarget) throw new Error("an SSH target is required (user@host)");
    const rows = this.read();
    if (rows.length >= MAX_HOSTS) throw new Error(`at most ${MAX_HOSTS} added hosts`);
    const row: RemoteInput = { ...input, id, sshTarget };
    this.write([...rows, row]);
    return buildRemote(row);
  }

  /** True if a host by this id was removed; false if it was never one of ours. */
  remove(id: string): boolean {
    const rows = this.read();
    const next = rows.filter((r) => r.id !== id);
    if (next.length === rows.length) return false;
    this.write(next);
    return true;
  }
}
