// Moving a terminal node to another view from its right-click menu (#22).
import { pathToFileURL } from "node:url";
import { check, report, src, stubBrowser } from "./harness.mjs";

stubBrowser();
const store = (await import(pathToFileURL(src("store.ts")).href)).useStore;
const S = () => store.getState();
const U = (c) => `${c.repeat(8)}-0000-4000-8000-${c.repeat(12)}`;
const info = (id) => ({ sessionId: id, host: "local", kind: "shell", cwd: "/tmp", shell: "sh", cols: 80, rows: 45, startedAt: 1 });
const A = U("a"), B = U("b");
S().addSession(info(A));
S().addSession(info(B));
const tab = (id) => S().tabs.find((t) => t.id === id);

S().addTab("one");
const one = S().activeTab;
S().setActiveTab("default");
S().moveToView([A], one);
check("from main, a node is added to the target view", tab(one).members.join() === A);
check("...and main still shows everything", tab("default").members === undefined && S().activeTab === "default");

S().setActiveTab(one);
S().groupNodes([A], "g");
S().moveToView([A], null);
const fresh = S().activeTab;
check("New view creates a view holding the node and switches to it", fresh !== one && tab(fresh).members.join() === A && /^view \d+$/.test(tab(fresh).name));
check("...and the node leaves the view it came from, frame and all", tab(one).members.length === 0 && !(tab(one).groups ?? []).length);

S().moveToView([A, B], one);
check("moving into a view does not duplicate members", tab(one).members.join() === [A, B].join());
check("the sessions themselves are untouched", Boolean(S().sessions[A] && S().sessions[B]));

report();
