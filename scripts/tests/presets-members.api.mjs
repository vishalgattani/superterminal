// Saving a preset from a view: only the view's sessions, only the edges
// between them, and frames remapped onto what was actually saved.
import { check, report } from "./harness.mjs";
import { call } from "./api-helper.mjs";

const ids = [];
for (const alias of ["a", "b", "c", "d"]) {
  const [, r] = await call("POST", "/api/sessions", { host: "local", cwd: "/tmp", alias });
  ids.push(r.session.sessionId);
}
const [a, b, c, d] = ids;

await call("POST", "/api/links", { source: a, target: b });
await call("POST", "/api/links", { source: b, target: c });
await call("POST", "/api/links", { source: c, target: d });

const preset = async (name) => {
  const [, r] = await call("GET", "/api/presets");
  return r.presets.find((p) => p.name === name);
};
const labels = (p) => p.nodes.map((n) => n.label);

let [s] = await call("POST", "/api/presets", { name: "all" });
let p = await preset("all");
check("no members = every open session (unchanged behaviour)", s === 200 && p.nodes.length === 4 && p.edges.length === 3, JSON.stringify(p));

[s] = await call("POST", "/api/presets", { name: "sub", members: [b, c], groups: [{ name: "g", hue: 1, members: [b, c, a] }] });
p = await preset("sub");
check("members saves only those sessions", s === 200 && labels(p).join() === "b,c", JSON.stringify(p));
check("only edges between saved sessions are kept", JSON.stringify(p.edges) === JSON.stringify([{ from: 0, to: 1 }]), JSON.stringify(p.edges));
check("frames keep only saved members", JSON.stringify(p.groups[0].members) === JSON.stringify([0, 1]), JSON.stringify(p.groups));

[s] = await call("POST", "/api/presets", { name: "ord", members: [d, a] });
p = await preset("ord");
check("caller's order is preserved", labels(p).join() === "d,a" && p.edges.length === 0, JSON.stringify(p));

[s] = await call("POST", "/api/presets", { name: "ghost", members: [a, "nope"] });
p = await preset("ghost");
check("unknown ids are dropped, not saved", s === 200 && p.nodes.length === 1, JSON.stringify(p));

let r;
[s, r] = await call("POST", "/api/presets", { name: "none", members: [] });
check("an empty view cannot be saved", s === 400 && (r.error ?? "").includes("no sessions"), JSON.stringify([s, r]));
[s, r] = await call("POST", "/api/presets", { name: "none", members: ["nope"] });
check("only unknown ids cannot be saved either", s === 400, JSON.stringify([s, r]));

// deploy returns the sessions a view should show
[s, r] = await call("POST", "/api/presets/sub/deploy");
check("deploy returns the spawned session ids", s === 200 && r.sessions.length === 2 && r.wired === 1, JSON.stringify(r));

// notes are saved with a preset, cleaned, and handed back on deploy (#18)
[s] = await call("POST", "/api/presets", {
  name: "noted",
  members: [a],
  notes: [{ text: "# hi", x: 1, y: 2, w: 200, h: 100 }, { text: 7 }, { text: "no size" }],
});
p = await preset("noted");
check("a preset keeps its well-formed notes only", s === 200 && p.notes?.length === 1 && p.notes[0].text === "# hi", JSON.stringify(p.notes));
let dep;
[s, dep] = await call("POST", "/api/presets/noted/deploy");
check("deploy hands the notes back", s === 200 && dep.notes?.[0]?.w === 200, JSON.stringify(dep.notes));
await call("DELETE", "/api/presets/noted");
for (const id of dep.sessions ?? []) await call("DELETE", `/api/sessions/${id}`);

// leave the rig as we found it, so test files do not depend on each other
for (const name of ["all", "sub", "ord", "ghost"]) await call("DELETE", `/api/presets/${name}`);
for (const id of [...ids, ...(r.sessions ?? [])]) await call("DELETE", `/api/sessions/${id}`);

report();
