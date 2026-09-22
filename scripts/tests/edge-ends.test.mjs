// Resolving a link's ends to canvas ids. A terminal is its own id; a session
// the viewer did not start is a foreign: card, and a link stored against its
// raw session id must still find it.
import { check, report, src } from "./harness.mjs";

const { canvasEnd } = await import(src("lib/edgeEnds.ts"));

const terms = new Set(["term-1", "term-2"]);
const ext = [
  { host: "local", sessionId: "7d2c4904" },
  { host: "fire", sessionId: "aaaa1111" },
];

check("a terminal resolves to itself", canvasEnd("term-1", terms, ext) === "term-1", canvasEnd("term-1", terms, ext));
check(
  "an external session resolves to its foreign card",
  canvasEnd("7d2c4904", terms, ext) === "foreign:local:7d2c4904",
  canvasEnd("7d2c4904", terms, ext),
);
check(
  "the host is part of the foreign id, so two hosts cannot collide",
  canvasEnd("aaaa1111", terms, ext) === "foreign:fire:aaaa1111",
  canvasEnd("aaaa1111", terms, ext),
);
check("an end that is on neither list is dropped, not guessed", canvasEnd("gone", terms, ext) === undefined, String(canvasEnd("gone", terms, ext)));
check("an empty canvas drops everything", canvasEnd("term-1", new Set(), []) === undefined);

// A terminal wins: after Attach, the same Claude session id can briefly be both
// a terminal of ours and still listed as an orphan. Drawing the edge to the
// foreign card then would point at a node that is about to disappear.
const both = new Set(["7d2c4904"]);
check(
  "a session that is both a terminal and an orphan resolves to the terminal",
  canvasEnd("7d2c4904", both, ext) === "7d2c4904",
  canvasEnd("7d2c4904", both, ext),
);

report();
