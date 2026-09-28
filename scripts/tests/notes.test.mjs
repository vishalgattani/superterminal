// Markdown notes on the canvas (issue #18): per view, survive a save and a
// reload, travel with a duplicated view, and never become session members.
import { pathToFileURL } from "node:url";
import { check, report, src, stubBrowser } from "./harness.mjs";

stubBrowser();
const base = pathToFileURL(src("store.ts")).href;
let instance = 0;
const fresh = async () => (await import(`${base}?inst=${instance++}`)).useStore;

let store = await fresh();
const S = () => store.getState();
S().addTab("docs");
const docs = S().activeTab;
S().addNote(100, 200);
const note = () => S().tabs.find((t) => t.id === docs).notes?.[0];
check("a note is added to the active view", note()?.id.startsWith("note:") && note().x === 100 && note().y === 200);
S().updateNote(note().id, { text: "# Runbook\n- step **one**", w: 320, h: 180 });
S().updateNote(note().id, { x: 5, y: 6 });
check("a note can be edited, moved and resized", note().text.startsWith("# Runbook") && note().w === 320 && note().x === 5);
check("a note is not a session member of the view", (S().tabs.find((t) => t.id === docs).members ?? []).length === 0);
check("activeNotes gives a preset what it needs, without ids", JSON.stringify(S().activeNotes()) === JSON.stringify([{ text: "# Runbook\n- step **one**", x: 5, y: 6, w: 320, h: 180 }]));

S().hydrateViews(null);
const doc = JSON.parse(JSON.stringify(S().serializeViews()));
check("notes are saved with their view", doc.tabs.find((t) => t.id === docs)?.notes?.length === 1);

store = await fresh();
S().hydrateViews(doc);
const back = S().tabs.find((t) => t.id === docs)?.notes?.[0];
check("...and come back after a reload", back?.text.startsWith("# Runbook") && back.w === 320 && back.y === 6, JSON.stringify(back));

const bad = structuredClone(doc);
bad.tabs.find((t) => t.id === docs).notes.push({ id: "note:x", text: 5 }, { id: "note:y", text: "", x: "1", y: 0, w: 1, h: 1 });
store = await fresh();
S().hydrateViews(bad);
check("malformed notes in a saved file are dropped", S().tabs.find((t) => t.id === docs)?.notes?.length === 1);

S().removeNote(back.id);
check("a note can be deleted", (S().tabs.find((t) => t.id === docs).notes ?? []).length === 0);

S().setActiveTab(docs);
S().adoptDeployed("deployed", [], [], [{ text: "hi", x: 1, y: 2, w: 3, h: 4 }]);
const dep = S().tabs.find((t) => t.name === "deployed");
check("a deployed preset's notes land on its new view", dep?.notes?.length === 1 && dep.notes[0].text === "hi" && dep.notes[0].id.startsWith("note:"));

report();
