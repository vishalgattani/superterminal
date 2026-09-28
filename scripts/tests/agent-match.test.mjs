// Which `claude agents --json` row belongs to which terminal.
//
// A bare local terminal used to be matched on cwd, so an unrelated Claude
// started outside the viewer in the same folder claimed every new terminal
// opened beside it (issue #5). Locally the join is on pid ancestry instead.
import { check, repoRoot, report } from "./harness.mjs";

const { matchRow, parseParents } = await import(
  `${repoRoot}/apps/server/src/status/agents.ts`
);

const parents = parseParents("  1     0\n 100     1\n 101   100\n 200     1\n 201   200\n 202   201\n 900     1\n");
check("ps output parses into pid -> parent", parents.get(202) === 201 && parents.get(100) === 1);

const outsider = { pid: 900, sessionId: "outsider", cwd: "/repo" };
const mine = { pid: 202, sessionId: "mine", cwd: "/repo" };
const tmuxName = "cv-none";

let row = matchRow([outsider], { tmuxName, cwd: "/repo", shellPid: 100, parents });
check("a fresh local terminal is not claimed by an unrelated Claude in the same folder", row === undefined, row?.sessionId);

row = matchRow([outsider], { tmuxName, cwd: "/repo", shellPid: 200, parents });
check("...nor a second one beside it", row === undefined, row?.sessionId);

row = matchRow([outsider, mine], { tmuxName, cwd: "/repo", shellPid: 200, parents });
check("a Claude descended from the terminal's shell is its row", row?.sessionId === "mine", row?.sessionId);

row = matchRow([outsider, mine], { tmuxName, cwd: "/repo", shellPid: 100, parents });
check("...and is not given to a sibling terminal", row === undefined, row?.sessionId);

row = matchRow([{ ...outsider, tmuxSession: "cv-abc" }], { tmuxName: "cv-abc", cwd: "/elsewhere" });
check("the tmux name still wins", row?.sessionId === "outsider");

row = matchRow([outsider], { tmuxName, cwd: "/repo" });
check("a remote without tmux still falls back to an unambiguous cwd", row?.sessionId === "outsider");

row = matchRow([outsider, { ...mine, pid: undefined }], { tmuxName, cwd: "/repo" });
check("...but not an ambiguous one", row === undefined);

report();
