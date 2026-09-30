import { existsSync } from "node:fs";
import { join } from "node:path";
import Fastify from "fastify";
import fastifyStatic from "@fastify/static";
// config first: it loads config.env into process.env, and auth.ts reads
// CV_TOKEN at module load time.
import { REPO_ROOT } from "./config.ts";
import { TOKEN, hostHeaderAllowed, tokenMatches } from "./auth.ts";
import { createContext } from "./context.ts";
import { reconcileRemote } from "./reconcile.ts";
import { registerAgentsRoutes } from "./routes/agents.ts";
import { registerHostsRoutes } from "./routes/hosts.ts";
import { registerLinksRoutes } from "./routes/links.ts";
import { registerPresetsRoutes } from "./routes/presets.ts";
import { registerSessionsRoutes } from "./routes/sessions.ts";
import { registerStatusRoutes } from "./routes/status.ts";
import { registerTranscriptsRoutes } from "./routes/transcripts.ts";
import { registerViewsRoutes } from "./routes/views.ts";
import { registerMonitorRoutes } from "./status/monitors.ts";
import { attachTerminalSocket } from "./ws/term.ts";

const ctx = createContext();
const { config, ptys, agents, cwds, fireInstance, transcripts, restoreLinks } = ctx;

const app = Fastify({ logger: false });

// Every route except the UI shell requires the token. The UI is harmless on
// its own: it cannot open a pty or a socket without one.
app.addHook("onRequest", async (req, reply) => {
  if (!hostHeaderAllowed(req.headers.host, config.port, config.devPorts)) {
    return reply.code(403).send({ error: "forbidden host" });
  }
  if (!req.url.startsWith("/api/")) return;
  const header = req.headers.authorization?.replace(/^Bearer\s+/i, "");
  const query = (req.query as Record<string, string> | undefined)?.token;
  if (!tokenMatches(header ?? query)) {
    return reply.code(401).send({ error: "unauthorized" });
  }
});

// Every route is registered before listen(): Fastify refuses a route added to
// an instance that is already listening.
registerStatusRoutes(app, ctx);
registerSessionsRoutes(app, ctx);
registerHostsRoutes(app, ctx);
registerLinksRoutes(app, ctx);
registerPresetsRoutes(app, ctx);
registerTranscriptsRoutes(app, ctx);
registerAgentsRoutes(app, ctx);
registerViewsRoutes(app, ctx);
registerMonitorRoutes(app, ctx);


// Serve the built UI when it exists. In development, Vite serves it instead
// and proxies /api and /ws here.
const webDist = join(REPO_ROOT, "apps/web/dist");
if (existsSync(webDist)) {
  await app.register(fastifyStatic, { root: webDist });
}

/**
 * Listen, retrying briefly on EADDRINUSE.
 *
 * `node --watch` starts the replacement before the old process has released
 * the socket, so a single attempt loses that race and the watcher then sits
 * idle until the next file change. A few short retries ride it out; a port
 * genuinely held by something else still fails with advice rather than a
 * stack trace.
 */
async function listenWithRetry(attempts = 6, delayMs = 300): Promise<string> {
  for (let i = 1; ; i++) {
    try {
      return await app.listen({ host: config.host, port: config.port });
    } catch (err) {
      const inUse = (err as NodeJS.ErrnoException).code === "EADDRINUSE";
      if (!inUse) throw err;
      if (i < attempts) {
        await new Promise((r) => setTimeout(r, delayMs));
        continue;
      }
      console.error(
        `\n  Port ${config.port} is already in use on ${config.host}.\n\n` +
          `  Usually this is an older copy of this server still running.\n\n` +
          `  See what holds it:   lsof -nP -iTCP:${config.port} -sTCP:LISTEN\n` +
          `  Stop it:             pkill -f "apps/server/src/index.ts"\n` +
          `  Or use another port: echo "CV_PORT=8789" >> config.env\n`,
      );
      process.exit(1);
    }
  }
}

const address = await listenWithRetry();

attachTerminalSocket({
  server: app.server,
  ptys,
  host: config.host,
  port: config.port,
  devPorts: config.devPorts,
});

// A closed tab must not leave a shell running forever.
ptys.startReaper();

// On boot, pick up sessions that outlived the last run.
setTimeout(() => {
  void reconcileRemote(ctx)
    // Links can only be matched once the sessions they point at exist.
    .then(() => restoreLinks())
    .catch(() => {})
    // Whether or not fire could be reached, boot has done what it can.
    .finally(() => {
      ctx.boot.ready = true;
    });
}, 2500);

// Status polling. Slow enough to be cheap over ssh, fast enough that a
// session waiting on input is noticed within a few seconds.
const pollAgents = async () => {
  await agents.refresh("local");
  await cwds.refresh("local");
  for (const remote of config.remotes) {
    // The light only speaks for the host that owns it. A remote with no
    // instance id has no light, so there is nothing to wait for: just poll it.
    // Compared only when the remote has an instance id: with none on either
    // side `undefined === undefined` read as "gated", and a plain SSH box was
    // never polled at all.
    const gated =
      remote.instanceId !== undefined &&
      fireInstance?.status.instanceId === remote.instanceId;
    if (gated && fireInstance?.status.light !== "green") continue;
    await agents.refresh(remote.id).catch(() => {});
    // Same trip, same gate: where a terminal is working moves with `cd`.
    await cwds.refresh(remote.id);
  }
};
void pollAgents();
setInterval(pollAgents, 4000).unref();

// Warm the transcript index once in the background so the inactive count is
// known without waiting for someone to open History. Failures are fine: the
// UI shows a dash rather than a wrong number.
/**
 * Re-scan transcripts while a Claude is actually running somewhere, so a
 * session fanning out into subagents shows up on the canvas within seconds
 * rather than within the browsing cache's minute.
 *
 * Gated on there being something to watch: with nothing running this does
 * nothing at all, and an idle viewer keeps costing one scan a minute rather
 * than an ssh round trip every fifteen seconds.
 */
setInterval(() => {
  for (const host of ctx.hosts.keys()) {
    const live = agents
      .get(host)
      ?.rows.some((r) => r.status === "busy" || r.status === "running");
    if (!live) continue;
    transcripts.invalidate(host);
    void transcripts.list(host).catch(() => {});
  }
}, 15_000).unref();

setTimeout(() => {
  void transcripts.list("local").catch(() => {});
  for (const remote of config.remotes) {
    void transcripts.list(remote.id).catch(() => {});
  }
}, 1500);

if (fireInstance) {
  const pollInstance = async () => {
    const before = fireInstance.status.light;
    const after = (await fireInstance.refresh()).light;
    // Check more often while in transition, where the state actually moves.
    if (before !== after) void pollAgents();
  };
  void pollInstance();
  setInterval(pollInstance, 15000).unref();
}

const url = `${address}/?token=${TOKEN}`;
console.log(`\n  superterminal\n  ${url}\n`);
if (!existsSync(webDist)) {
  console.log(
    `  UI not built yet. For development run:  npm run dev:web\n` +
      `  then open  http://127.0.0.1:5173/?token=${TOKEN}\n`,
  );
}

for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, () => {
    // M1 detaches nothing: a local pty dies with the server. Persistence
    // arrives with tmux in M2.
    ptys.killAll();
    process.exit(0);
  });
}
