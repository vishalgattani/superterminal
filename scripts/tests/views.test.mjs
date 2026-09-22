// Views as subsets of sessions: membership, frames, arrange, cycling, duplicate.
import { check, report, src, stubBrowser } from "./harness.mjs";

let fetched = [];
stubBrowser({
  fetch: async (url, opts) => {
    fetched.push({ url, body: opts?.body ? JSON.parse(opts.body) : null });
    return { ok: true, json: async () => ({ sessions: ["N1", "N2"], groups: [{ name: "g", hue: 10, members: ["N1", "N2"] }] }) };
  },
});
const { useStore, viewSessionIds, OVERVIEW_TAB } = await import(src("store.ts"));

const S = () => useStore.getState();
const info = (id, cwd = `/tmp/${id}`) => ({ sessionId: id, host: "local", kind: "shell", cwd, shell: "sh", cols: 80, rows: 45, startedAt: 1 });
const ids = () => S().tabs.find((t) => t.id === S().activeTab);
const shown = () => viewSessionIds(ids(), S().order, S().sessions);

// three sessions, created on the overview
for (const id of ["A", "B", "C"]) S().addSession(info(id));
check("overview shows all sessions", shown().join() === "A,B,C");
check("overview has no member list", ids().members === undefined);

// a new view starts empty
S().addTab("work");
const work = S().activeTab;
check("new view is an empty subset", ids().members?.length === 0 && shown().length === 0);
check("new view does not inherit positions", Object.keys(ids().positions).length === 0);

// pick sessions
S().addToView(["B", "C", "B", "ghost"]);
check("addToView adds picked sessions once and ignores unknown ids", shown().join() === "B,C", shown().join());

// creating a session while on the view adds it there
S().addSession(info("D"));
check("a session created in a view joins it", shown().join() === "B,C,D", shown().join());
S().setActiveTab(OVERVIEW_TAB);
check("overview still shows everything, including the new one", shown().join() === "A,B,C,D");

// a session created on the overview does not leak into subsets
S().addSession(info("E"));
S().setActiveTab(work);
check("sessions created elsewhere do not join a subset", shown().join() === "B,C,D", shown().join());

// removeFromView keeps the session alive
S().removeFromView(["C"]);
check("removeFromView drops it from the view", shown().join() === "B,D");
check("...but the session still exists", !!S().sessions.C && S().order.includes("C"));
S().setActiveTab(OVERVIEW_TAB);
check("...and the overview still shows it", shown().includes("C"));
S().removeFromView(["A"]); // no-op on the overview
check("removeFromView is a no-op on the overview", shown().includes("A"));
S().addToView(["A"]);
check("addToView is a no-op on the overview", ids().members === undefined);

// groups follow membership
S().setActiveTab(work);
S().groupNodes(["B", "D"], "pair");
check("a frame can enclose view members", ids().groups?.[0]?.members.join() === "B,D");
S().removeFromView(["B"]);
check("removing a member shrinks the frame", ids().groups?.[0]?.members.join() === "D");
S().removeFromView(["D"]);
check("a frame with no members left is dropped", !ids().groups || ids().groups.length === 0);
S().addToView(["B", "C", "D"]);

// closing a session removes it from every view
S().addTab("other");
const other = S().activeTab;
S().addToView(["D", "E"]);
S().removeSession("D");
const memberLists = S().tabs.map((t) => t.members?.join() ?? "*");
check("closing a session drops it from every view", !memberLists.some((m) => m.includes("D")), memberLists.join(" | "));
check("...and from the session registry", !S().sessions.D && !S().order.includes("D"));

// reconcile (server no longer has it) does the same
S().reconcile([info("A"), info("B"), info("C")]); // E is gone server-side
check("reconcile drops vanished sessions from views", !S().tabs.some((t) => t.members?.includes("E")), S().tabs.map((t) => t.members?.join() ?? "*").join(" | "));

// overview cannot be closed
S().closeTab(OVERVIEW_TAB);
check("the overview cannot be closed", S().tabs.some((t) => t.id === OVERVIEW_TAB));
S().closeTab(other);
check("a subset view can be closed", !S().tabs.some((t) => t.id === other));
check("...and closing it leaves the sessions running", !!S().sessions.B);

// arrange only touches what the view shows
S().setActiveTab(work);
const beforeOverview = JSON.stringify(S().positions);
S().arrange("grid");
check("arrange positions exactly the view's sessions", Object.keys(ids().positions).sort().join() === shown().sort().join(), Object.keys(ids().positions).join());
check("arranging a subset leaves the overview's positions alone", JSON.stringify(S().positions) === beforeOverview);
S().setPosition("B", { x: 999, y: 999 });
check("dragging in a subset does not move the node on the overview", S().positions.B?.x !== 999);
S().setActiveTab(OVERVIEW_TAB);
S().setPosition("B", { x: 555, y: 555 });
check("dragging on the overview does move the shared position", S().positions.B?.x === 555);

// cycling stays inside the view
S().setActiveTab(work);
S().open("B");
S().cycle(1);
check("cycle moves within the active view", shown().includes(S().openSessionId), S().openSessionId);
S().cycle(1); S().cycle(1); S().cycle(1);
check("cycle never lands on a session outside the view", shown().includes(S().openSessionId));

// duplicate: layout copies the subset; overview duplicate freezes everything
S().setActiveTab(work);
const dupL = await S().duplicateTab(work, "layout");
check("duplicating a view (connections only) keeps its subset", S().tabs.find((t) => t.id === dupL).members.join() === shown().join());
const dupO = await S().duplicateTab(OVERVIEW_TAB, "layout");
check("duplicating the overview freezes what it shows into a subset", S().tabs.find((t) => t.id === dupO).members.join() === S().order.join());

// duplicate with new sessions only spawns this view's sessions
fetched = [];
S().setActiveTab(work);
const n = shown().length;
const dupS = await S().duplicateTab(work, "sessions");
const dep = fetched.find((f) => f.url === "/api/deploy");
check("new-sessions duplicate spawns only this view's sessions", dep && dep.body.nodes.length === n, `${dep?.body.nodes?.length} vs ${n}`);
check("...and the copy shows exactly the spawned sessions", S().tabs.find((t) => t.id === dupS).members.join() === "N1,N2");

// deploy opens a view with exactly its sessions and frames
S().adoptDeployed("mil", ["X1", "X2"], [{ name: "grp", hue: 5, members: ["X1", "X2"] }]);
check("adoptDeployed opens a view holding the deployed sessions", ids().name === "mil" && ids().members.join() === "X1,X2" && ids().groups.length === 1);
S().adoptDeployed("plain", ["Y1"], []);
check("adoptDeployed works without frames", ids().members.join() === "Y1");

S().setActiveTab(work);
check("activeMembers is what the view shows", S().activeMembers().join() === shown().join());
S().setActiveTab(OVERVIEW_TAB);
check("activeMembers on the overview is everything", S().activeMembers().join() === S().order.join());
check("view ids are unique even when created in the same millisecond", new Set(S().tabs.map((t) => t.id)).size === S().tabs.length);

report();
