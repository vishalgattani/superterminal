// Saving views and loading them back: across a page reload, a viewer restart,
// a fire host that is not up yet, and a server reboot under an open page.
import { pathToFileURL } from "node:url";
import { check, report, src, stubBrowser } from "./harness.mjs";

// A smart-enough fetch stub for reconnectMember (POST /api/sessions) and
// addLink (POST /api/links), so the reconnect-and-relink scenarios below can
// run without a real server. Everything else falls back to `{}`.
let nextSpawnId = 0;
const spawned = [];
const linksPosted = [];
stubBrowser({
  fetch: async (url, opts = {}) => {
    const method = opts.method ?? "GET";
    if (url === "/api/sessions" && method === "POST") {
      const body = JSON.parse(opts.body);
      const sessionId = `spawn-${nextSpawnId++}`;
      spawned.push({ sessionId, ...body });
      return {
        ok: true,
        json: async () => ({
          session: {
            sessionId,
            host: body.host,
            kind: "shell",
            cwd: body.cwd,
            shell: "sh",
            cols: body.cols ?? 80,
            rows: body.rows ?? 45,
            startedAt: 1,
            ...(body.alias ? { alias: body.alias } : {}),
          },
        }),
      };
    }
    if (url === "/api/links" && method === "POST") {
      const body = JSON.parse(opts.body);
      linksPosted.push(body);
      return { ok: true, json: async () => ({ links: [] }) };
    }
    return { ok: true, json: async () => ({}) };
  },
});

// Each scenario wants a store with nothing in it. The query string makes node
// treat it as a new module, so every `fresh()` is a newly initialised store.
const base = pathToFileURL(src("store.ts")).href;
let instance = 0;
const fresh = async () => (await import(`${base}?inst=${instance++}`)).useStore;

const U = (c) => `${c.repeat(8)}-0000-4000-8000-${c.repeat(12)}`;
const info = (id, host, cwd, tmux) => ({ sessionId: id, host, kind: "shell", cwd, shell: "sh", cols: 80, rows: 45, startedAt: 1, ...(tmux ? { tmuxSession: tmux } : {}) });

// ---- a working state: two local terminals, two fire ones, a subset view with a frame
let store = await fresh();
const S = () => store.getState();
const L1 = U("a"), L2 = U("b"), F1 = U("c"), F2 = U("d");
S().addSession(info(L1, "local", "/tmp/one"));
S().addSession(info(L2, "local", "/tmp/two"));
S().addSession(info(F1, "fire", "/home/me/vault", "cv-aaaa1111"));
S().addSession(info(F2, "fire", "/home/me/repos/api", "cv-bbbb2222"));
S().setPosition(L1, { x: 500, y: 60 });
S().addTab("work");
const work = S().activeTab;
S().addToView([L1, F1, F2]);
S().setShowFolders(true);
S().arrange("LR");
// dragged after arranging, so these are the positions that should be saved
S().setPosition(F1, { x: 11, y: 22 });
S().setPosition(F2, { x: 33, y: 44 });
S().groupNodes([F1, F2], "pair");
S().setPosition("folder:fire:~", { x: 7, y: 8 });
S().setActiveTab(work);
S().hydrateViews(null);
check("hydrateViews(null) just starts saving", S().viewsHydrated === true);
const doc = JSON.parse(JSON.stringify(S().serializeViews()));

const wt = doc.tabs.find((t) => t.id === work);
check("members are saved by key: tmux name where there is one, else the id", wt.members.slice().sort().join() === [L1, "cv-aaaa1111", "cv-bbbb2222"].sort().join(), wt.members.join());
check("positions are saved by key", wt.positions["cv-aaaa1111"] !== undefined && !(F1 in wt.positions));
check("frames are saved by key", wt.groups?.[0].members.slice().sort().join() === "cv-aaaa1111,cv-bbbb2222");
check("folder positions pass through unchanged", doc.positions["folder:fire:~"] !== undefined || wt.positions["folder:fire:~"] !== undefined);
check("UI toggles are saved", doc.showFolders === true && doc.treeFlow === "LR" && doc.activeTab === work);
check("the overview is saved without a member list", doc.tabs.find((t) => t.id === "default").members === undefined);
check("the server can accept it (version 1, tabs with id and name)", doc.version === 1 && doc.tabs.every((t) => t.id && t.name));

// ---- PAGE RELOAD: same session ids
store = await fresh();
for (const i of [info(L1, "local", "/tmp/one"), info(L2, "local", "/tmp/two"), info(F1, "fire", "/home/me/vault", "cv-aaaa1111"), info(F2, "fire", "/home/me/repos/api", "cv-bbbb2222")]) S().addSession(i);
S().hydrateViews(doc);
let t = S().tabs.find((x) => x.id === work);
check("reload: the view comes back with its members", t?.members.slice().sort().join() === [L1, F1, F2].sort().join(), t?.members?.join());
check("reload: positions are restored", t.positions[F1]?.x === 11 && t.positions[F2]?.y === 44);
check("reload: the frame is restored around the same sessions", t.groups?.[0].members.slice().sort().join() === [F1, F2].sort().join());
check("reload: the active view and toggles are restored", S().activeTab === work && S().showFolders === true && S().treeFlow === "LR");
check("reload: the overview is back and shows everything", S().tabs[0].id === "default" && S().tabs[0].members === undefined);
check("reload: nothing is left waiting", Object.keys(S().retained.tabs).length === 0);

// ---- VIEWER RESTART: fire sessions re-adopted with NEW ids, locals gone
store = await fresh();
const F1n = U("e"), F2n = U("f");
S().addSession(info(F1n, "fire", "/home/me/vault", "cv-aaaa1111"));
S().addSession(info(F2n, "fire", "/home/me/repos/api", "cv-bbbb2222"));
S().hydrateViews(doc);
t = S().tabs.find((x) => x.id === work);
check("restart: fire sessions rejoin the view under their new ids", t.members.slice().sort().join() === [F1n, F2n].sort().join(), t.members.join());
check("restart: a dead local terminal is dropped, not kept forever", !t.members.includes(L1) && Object.keys(S().retained.tabs).length === 0, JSON.stringify(S().retained));
check("restart: positions follow the tmux name to the new id", t.positions[F1n]?.x === 11 && t.positions[F2n]?.y === 44);
check("restart: the frame is rebuilt on the new ids", t.groups?.[0].members.slice().sort().join() === [F1n, F2n].sort().join());
check("restart: the saved local position did not become a stray entry", !Object.keys(S().positions).includes(L1));

// ---- FIRE NOT UP YET: one tmux session unresolved at load, arrives later
store = await fresh();
S().addSession(info(F1n, "fire", "/home/me/vault", "cv-aaaa1111")); // F2's session not adopted yet
S().hydrateViews(doc);
t = S().tabs.find((x) => x.id === work);
check("late: the resolvable member is shown, the other waits", t.members.join() === F1n && S().retained.tabs[work]?.members.join() === "cv-bbbb2222", JSON.stringify(S().retained));
const resaved = JSON.parse(JSON.stringify(S().serializeViews()));
check("late: a save while it is missing does not lose it", resaved.tabs.find((x) => x.id === work).members.includes("cv-bbbb2222"));
S().adoptSessions([info(F2n, "fire", "/home/me/repos/api", "cv-bbbb2222")]);
t = S().tabs.find((x) => x.id === work);
check("late: when the session appears it rejoins the view", t.members.slice().sort().join() === [F1n, F2n].sort().join(), t.members.join());
check("late: ...with its saved position", t.positions[F2n]?.x === 33);
check("late: ...and nothing is left waiting", Object.keys(S().retained.tabs).length === 0);

// ---- A PAGE LEFT OPEN WHILE THE SERVER RESTARTS (this once wiped a saved view)
store = await fresh();
S().noteBoot("boot-1");
check("first sight of a boot id is not a restart", S().serverBootId === "boot-1");
for (const i of [info(F1, "fire", "/home/me/vault", "cv-aaaa1111"), info(F2, "fire", "/home/me/repos/api", "cv-bbbb2222"), info(L1, "local", "/tmp/one")]) S().addSession(i);
S().hydrateViews(doc);
S().noteBoot("boot-1");
check("the same boot id changes nothing", S().viewsHydrated === true);
// the server restarts: it reports no sessions, the page reconciles them away
S().noteBoot("boot-2");
check("a new boot id stops this page saving", S().viewsHydrated === false && S().serverBootId === "boot-2");
S().reconcile([]);
check("...while it holds a stripped view in memory (the state that must never be saved)", S().tabs.find((x) => x.id === work).members.length === 0);
// boot finishes; the fire sessions come back under new ids; the good saved copy is loaded again
S().adoptSessions([info(F1n, "fire", "/home/me/vault", "cv-aaaa1111"), info(F2n, "fire", "/home/me/repos/api", "cv-bbbb2222")]);
check("still not saving until the views are reloaded", S().viewsHydrated === false);
S().hydrateViews(doc);
t = S().tabs.find((x) => x.id === work);
check("reloading the saved copy restores the view on the new ids", t.members.slice().sort().join() === [F1n, F2n].sort().join() && S().viewsHydrated === true, t.members.join());
S().noteBoot(undefined);
check("a status without a boot id is ignored", S().serverBootId === "boot-2");

// ---- robustness
store = await fresh();
S().hydrateViews({ version: 2, tabs: [] });
check("an unknown version is ignored, defaults kept", S().viewsHydrated && S().tabs.length === 1 && S().tabs[0].id === "default");
store = await fresh();
S().hydrateViews({ version: 1, tabs: [{ id: "x", name: "only" }, { nope: 1 }, null], activeTab: "gone" });
check("a file without the overview gets one, junk entries are skipped", S().tabs[0].id === "default" && S().tabs.some((x) => x.id === "x") && S().tabs.length === 2);
check("an active view that no longer exists falls back to the overview", S().activeTab === "default");
store = await fresh();
S().hydrateViews({ version: 1, tabs: [{ id: "default", name: "main", members: ["zzz"], positions: {} }] });
check("the overview ignores a member list, always showing everything", S().tabs[0].members === undefined);
store = await fresh();
S().addSession(info(L1, "local", "/tmp/one"));
S().setPosition("foreign:local:abc", { x: 1, y: 1 });
check("external cards' positions are not saved", !JSON.stringify(S().serializeViews()).includes("foreign:"));
check("saving with no views yet still yields a valid document", (() => { const d = S().serializeViews(); return d.version === 1 && d.tabs.length === 1; })());

// ---- ALIAS + CLAUDE SESSION ID: saved once, at the top level, keyed like positions
store = await fresh();
const C1 = U("g");
S().addSession(info(C1, "local", "/tmp/claude-one"));
await S().setAlias(C1, "my claude");
S().applyStatus({ sessions: [{ sessionId: C1, cwd: "/tmp/claude-one", activity: "idle", claudeSessionId: "claude-c1" }] });
const docC = JSON.parse(JSON.stringify(S().serializeViews()));
check(
  "alias and claude session id are saved in meta, keyed like positions",
  docC.meta?.[C1]?.alias === "my claude" &&
    docC.meta[C1].claudeSessionId === "claude-c1" &&
    docC.meta[C1].host === "local" &&
    docC.meta[C1].cwd === "/tmp/claude-one",
  JSON.stringify(docC.meta),
);

// ---- RECONNECT: a local terminal that never comes back, but ran Claude, is
// kept aside (unlike a plain shell, which is still dropped for good) and can
// be brought back on request via --resume.
store = await fresh();
S().hydrateViews(docC);
check(
  "a dead local session with a claude id is kept aside, not dropped",
  S().retained.meta[C1]?.claudeSessionId === "claude-c1",
  JSON.stringify(S().retained),
);
check("...its position is kept aside too", S().retained.positions[C1] !== undefined);
check("...and it is offered by the same key everywhere else was", S().retained.meta[C1]?.host === "local" && S().retained.meta[C1]?.cwd === "/tmp/claude-one");

await S().reconnectMember(C1);
const reconnectedC1 = spawned.at(-1);
check("reconnect: spawn was asked to resume the saved claude session", reconnectedC1.resume === "claude-c1" && reconnectedC1.alias === "my claude");
check("reconnect: the new terminal is live", S().sessions[reconnectedC1.sessionId] !== undefined);
check(
  "reconnect: it takes over the old key's saved position",
  S().positions[reconnectedC1.sessionId]?.x === docC.positions[C1].x && S().positions[reconnectedC1.sessionId]?.y === docC.positions[C1].y,
);
check("reconnect: nothing is left waiting for the old key", S().retained.meta[C1] === undefined && S().retained.positions[C1] === undefined);

// ---- RECONNECT inside a subset view: the new session rejoins the same view,
// at the position that view had saved for it, not the overview's.
store = await fresh();
const C2 = U("h");
S().addSession(info(C2, "local", "/tmp/claude-two"));
S().addTab("claude-work");
const claudeWork = S().activeTab;
S().addToView([C2]);
S().setPosition(C2, { x: 77, y: 88 }); // active tab is claudeWork, so this is per-view
S().applyStatus({ sessions: [{ sessionId: C2, cwd: "/tmp/claude-two", activity: "idle", claudeSessionId: "claude-c2" }] });
const docD = JSON.parse(JSON.stringify(S().serializeViews()));

store = await fresh();
S().hydrateViews(docD);
check(
  "subset: a dead claude session is kept aside for the view it was in",
  S().retained.tabs[claudeWork]?.members.includes(C2),
  JSON.stringify(S().retained.tabs),
);
check("subset: ...at the position that view had for it", S().retained.tabs[claudeWork]?.positions[C2]?.x === 77);

await S().reconnectMember(C2);
const reconnectedC2 = spawned.at(-1);
const claudeWorkTab = S().tabs.find((x) => x.id === claudeWork);
check("subset: reconnect adds the new session into the same view", claudeWorkTab.members.includes(reconnectedC2.sessionId));
check("subset: ...at its saved position", claudeWorkTab.positions[reconnectedC2.sessionId]?.x === 77);
check("subset: nothing is left waiting for that view", !S().retained.tabs[claudeWork]);

// ---- LINKS follow the same durable key, so one survives a resume even
// though the link itself is keyed by session id everywhere else.
store = await fresh();
const A = U("i"), B = U("j");
S().addSession(info(A, "local", "/tmp/a-claude"));
S().addSession(info(B, "local", "/tmp/b-claude"));
S().applyStatus({
  sessions: [
    { sessionId: A, cwd: "/tmp/a-claude", activity: "idle", claudeSessionId: "claude-a" },
    { sessionId: B, cwd: "/tmp/b-claude", activity: "idle", claudeSessionId: "claude-b" },
  ],
});
S().setLinks([{ id: `${A}->${B}`, source: A, target: B }]);
const docE = JSON.parse(JSON.stringify(S().serializeViews()));
check("links are saved by durable key", docE.links?.some((l) => l.source === A && l.target === B), JSON.stringify(docE.links));

// A's terminal is gone; B kept running and comes back under its own id (a
// page reload, not a restart, so a plain local id like B's still resolves).
store = await fresh();
S().addSession(info(B, "local", "/tmp/b-claude"));
S().hydrateViews(docE);
check(
  "link: with one end still missing, the link waits rather than being dropped",
  S().links.length === 0 && S().retained.links.some((l) => l.source === A || l.target === A),
  JSON.stringify(S().retained.links),
);

linksPosted.length = 0;
await S().reconnectMember(A);
check("link: reconnecting the missing end recreates the link against both current ids", linksPosted.some((l) => l.target === B), JSON.stringify(linksPosted));
check("link: nothing is left pending once both ends are back", S().retained.links.length === 0);

report();
