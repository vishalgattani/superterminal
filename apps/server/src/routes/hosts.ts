import { execFile } from "node:child_process";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import type { FastifyInstance } from "fastify";
import type { HostId } from "@cv/shared";
import type { RemoteInput } from "../config.ts";
import type { AppContext } from "../context.ts";

/**
 * Remote hosts added from the UI, rather than config.env: add, list, remove.
 * No restart needed either way; see hostsStore.ts.
 */
const execFileAsync = promisify(execFile);
const KEY_TYPES = { ed25519: ["-t", "ed25519"], rsa: ["-t", "rsa", "-b", "4096"] } as const;

export function registerHostsRoutes(app: FastifyInstance, ctx: AppContext): void {
  const { hostsStore, addRemoteHost, removeRemoteHost, hostStatuses } = ctx;

  // Only the ones this store manages, separate from GET /api/hosts (every
  // host, including config.env's), so the UI knows which rows are editable
  // and which say "set in config.env" instead of a delete button.
  app.get("/api/hosts/remotes", async () => ({ remotes: hostsStore.list() }));

  app.post("/api/hosts/remotes", async (req, reply) => {
    const body = (req.body ?? {}) as Partial<RemoteInput>;
    const trim = (s: string | undefined) => s?.trim() || undefined;
    if (!body.id?.trim() || !trim(body.sshTarget)) {
      return reply.code(400).send({ error: "id and sshTarget are required" });
    }
    try {
      const remote = addRemoteHost({
        id: body.id.trim(),
        label: trim(body.label),
        sshTarget: trim(body.sshTarget)!,
        keyPath: trim(body.keyPath),
        claudePath: trim(body.claudePath),
        claudeModel: trim(body.claudeModel),
        instanceId: trim(body.instanceId),
        apiBase: trim(body.apiBase),
        forwardX11: Boolean(body.forwardX11),
      });
      return { remote, hosts: hostStatuses };
    } catch (err) {
      return reply.code(400).send({ error: (err as Error).message });
    }
  });

  app.delete("/api/hosts/remotes/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    try {
      removeRemoteHost(id as HostId);
      return { ok: true, hosts: hostStatuses };
    } catch (err) {
      return reply.code(400).send({ error: (err as Error).message });
    }
  });

  // A fresh key for a host being added. Never overwrites: an existing file of
  // that name may be the key some other machine already trusts. No passphrase,
  // because the server runs ssh non-interactively and could not answer one.
  app.post("/api/ssh/keygen", async (req, reply) => {
    const { name, type } = (req.body ?? {}) as { name?: string; type?: string };
    if (!name || !/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,63}$/.test(name)) {
      return reply.code(400).send({ error: "key name must be letters, digits, . - or _" });
    }
    if (type !== "ed25519" && type !== "rsa") {
      return reply.code(400).send({ error: "type must be ed25519 or rsa" });
    }
    const dir = join(homedir(), ".ssh");
    const keyPath = join(dir, name);
    if (existsSync(keyPath)) return reply.code(409).send({ error: `${keyPath} already exists` });
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    try {
      await execFileAsync(
        "ssh-keygen",
        [...KEY_TYPES[type], "-f", keyPath, "-N", "", "-C", `superterminal-${name}`],
        { timeout: 30_000 },
      );
    } catch (err) {
      return reply.code(500).send({ error: (err as Error).message });
    }
    return { keyPath, publicKey: readFileSync(`${keyPath}.pub`, "utf8").trim() };
  });
}
