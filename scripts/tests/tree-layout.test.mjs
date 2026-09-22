// arrange(): where the folder tree puts folders and sessions on the canvas.
import { check, report, src, stubBrowser } from "./harness.mjs";

stubBrowser();
const { useStore } = await import(src("store.ts"));
const { buildFolderTree } = await import(src("lib/folders.ts"));

const S = () => useStore.getState();
const info = (id, host, cwd) => ({ sessionId: id, host, kind: "shell", cwd, shell: "sh", cols: 80, rows: 45, startedAt: 1 });

S().addSession(info("vault", "fire", "/home/me/vault"));
for (const n of ["a", "b", "c"]) S().addSession(info(n, "fire", `/home/me/repos/${n}`));
S().addSession(info("loc", "local", "/Users/me/proj"));

const tree = () => buildFolderTree(S().order.map((id) => ({ id, host: S().sessions[id].host, cwd: S().sessions[id].cwd })));
const fid = (label) => tree().folders.find((f) => f.label === label)?.id;

check("folders are off by default", S().showFolders === false && S().treeFlow === "TD");
S().arrange("TD");
check("arranging without folders positions only sessions", Object.keys(S().tabs[0].positions).sort().join() === "a,b,c,loc,vault", Object.keys(S().tabs[0].positions).join());
S().setShowFolders(true);
S().arrange("TD");
const P = S().tabs[0].positions;
check("with folders on, arrange also positions the folders", Object.keys(P).some((k) => k.startsWith("folder:")), Object.keys(P).join());
const home = fid("~"), repos = fid("repos");
check("TD: a parent folder is placed above its children", P[home].y < P[repos].y && P[repos].y < P.a.y && P[home].y < P.vault.y, JSON.stringify({ h: P[home], r: P[repos], a: P.a }));
check("TD: repos' three children share a row", P.a.y === P.b.y && P.b.y === P.c.y);
check("TD: siblings under one folder are adjacent, not split by other nodes", (() => {
  const xs = ["a", "b", "c"].map((k) => P[k].x).sort((x, y) => x - y);
  const others = ["vault", "loc"].map((k) => P[k].x);
  return !others.some((x) => x > xs[0] && x < xs[2] && P.vault.y === P.a.y);
})());
S().arrange("LR");
const Q = S().tabs[0].positions;
check("LR: arrange records the flow", S().treeFlow === "LR");
check("LR: a parent folder is left of its children", Q[home].x < Q[repos].x && Q[repos].x < Q.a.x, JSON.stringify({ h: Q[home], r: Q[repos], a: Q.a }));
S().arrange("grid");
check("grid keeps the last flow and lays out only sessions", S().treeFlow === "LR");
S().setShowFolders(false);
check("toggle turns the tree off", S().showFolders === false);

// subset view: the tree covers only what the view shows
S().addTab("sub");
S().addToView(["a", "loc"]);
S().setShowFolders(true);
S().arrange("TD");
const sub = S().tabs.find((t) => t.id === S().activeTab).positions;
const ids = Object.keys(sub);
check("a subset arranges only its sessions and their folders", ids.includes("a") && ids.includes("loc") && !ids.includes("b") && !ids.includes("vault"), ids.join());

report();
