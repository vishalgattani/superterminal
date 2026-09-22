// buildFolderTree: the cwd of every session, turned into a folder tree.
import { check, report, src } from "./harness.mjs";

const { buildFolderTree } = await import(src("lib/folders.ts"));

const it = (id, host, cwd) => ({ id, host, cwd });
const E = (t) => t.edges.map((e) => `${e.source}>${e.target}`).sort();
const F = (t) => t.folders.map((f) => f.label).sort();

// the MIL shape on fire: ~/vault and five repos under ~/repos
let t = buildFolderTree([
  it("vault", "fire", "/home/me/vault"),
  ...["a", "b", "c"].map((n) => it(n, "fire", `/home/me/repos/${n}`)),
]);
check("home root and repos folder appear", F(t).join() === "repos,~", F(t).join());
const home = t.folders.find((f) => f.label === "~"), repos = t.folders.find((f) => f.label === "repos");
check("vault hangs under ~", E(t).includes(`${home.id}>vault`), E(t).join());
check("repos hangs under ~", E(t).includes(`${home.id}>${repos.id}`));
check("each repo hangs under repos", ["a", "b", "c"].every((n) => E(t).includes(`${repos.id}>${n}`)));
check("counts are sessions below", home.count === 4 && repos.count === 3, `${home.count}/${repos.count}`);
check("no duplicate edges", new Set(E(t)).size === E(t).length);

// a chain that leads to one thing is a single node
t = buildFolderTree([it("x", "fire", "/home/me/a/b/c/proj")]);
check("a single deep path collapses to one folder", t.folders.length === 1 && t.folders[0].label === "~/a/b/c", JSON.stringify(t.folders));
check("...holding the session", E(t).join() === `${t.folders[0].id}>x`);

// a session stands for its own folder: nested sessions hang under it, no duplicate
t = buildFolderTree([it("outer", "local", "/Users/me/work"), it("inner", "local", "/Users/me/work/api")]);
check("a session at an ancestor path is the container", E(t).includes("outer>inner"), E(t).join());
check("...so no duplicate folder for it", !t.folders.some((f) => f.label === "work" || f.label === "~/work"), F(t).join());

// two sessions in one folder are siblings under the same parent
t = buildFolderTree([it("s1", "local", "/Users/me/proj"), it("s2", "local", "/Users/me/proj")]);
check("sessions sharing a cwd share a parent", t.folders.length === 1 && t.edges.length === 2 && t.edges.every((e) => e.source === t.folders[0].id), JSON.stringify(t));

// hosts never share nodes
t = buildFolderTree([it("l", "local", "/Users/me/vault"), it("f", "fire", "/home/me/vault")]);
check("the same path on two hosts stays two trees", t.folders.length === 2 && new Set(t.folders.map((f) => f.host)).size === 2, JSON.stringify(t.folders));

// remote '~' marker and non-home paths
t = buildFolderTree([it("h", "fire", "~"), it("v", "fire", "/home/me/vault")]);
check("a session at ~ is the home container", E(t).join() === "h>v" && t.folders.length === 0, JSON.stringify(t));
t = buildFolderTree([it("bg", "local", "/srv/bg"), it("e", "local", "/srv/ext-b")]);
check("non-home paths root at /", t.folders.length === 1 && t.folders[0].label === "/srv", JSON.stringify(t.folders));
t = buildFolderTree([it("tmp", "local", "/tmp")]);
check("a top-level path has a root only", t.folders.length === 1 && t.folders[0].label === "/" && E(t).length === 1, JSON.stringify(t));

// mixed hosts + counts, stable ids
const a = buildFolderTree([it("a", "fire", "/home/me/repos/a"), it("b", "fire", "/home/me/repos/b")]);
const b = buildFolderTree([it("b", "fire", "/home/me/repos/b"), it("a", "fire", "/home/me/repos/a")]);
check("folder ids do not depend on session order", a.folders[0].id === b.folders[0].id, `${a.folders[0].id} vs ${b.folders[0].id}`);
check("empty input gives an empty tree", buildFolderTree([]).folders.length === 0 && buildFolderTree([]).edges.length === 0);

// every session appears as a target at most once
t = buildFolderTree([it("a", "fire", "/home/me/repos/a"), it("b", "fire", "/home/me/repos/b"), it("v", "fire", "/home/me/vault"), it("r", "fire", "/home/me/repos")]);
const targets = t.edges.map((e) => e.target);
check("no node has two parents", new Set(targets).size === targets.length, targets.join());
check("repos session is the container of a and b", E(t).includes("r>a") && E(t).includes("r>b"), E(t).join());

report();
