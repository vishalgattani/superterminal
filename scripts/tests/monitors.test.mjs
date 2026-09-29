// Monitors come from transcripts only; events must not read as ends (issue #44).
import { check, repoRoot, report } from "./harness.mjs";

const { parseMonitors } = await import(`${repoRoot}/apps/server/src/status/monitors.ts`);

const t0 = "2026-09-29T06:19:19.000Z";
const line = (o) => JSON.stringify({ sessionId: "sess-1", cwd: "/w", ...o });
const start = (id, task, desc, ts = t0) => [
  line({ timestamp: ts, message: { content: [{ type: "tool_use", id, name: "Monitor", input: { description: desc } }] } }),
  line({ timestamp: ts, message: { content: [{ type: "tool_result", tool_use_id: id, content: `Monitor started (task ${task}, expires in 30m unless the source ends first)` }] } }),
];
const notice = (task, inner, ts) =>
  line({ timestamp: ts, message: { content: `<task-notification>\n<task-id>${task}</task-id>\n${inner}\n</task-notification>` } });

let rows = parseMonitors(
  [
    ...start("u1", "aaa111", "kernels a and b"),
    notice("aaa111", "<event>a: RUNNING</event>", "2026-09-29T06:19:20.000Z"),
    notice("aaa111", "<event>b: RUNNING</event>", "2026-09-29T06:19:21.000Z"),
  ].join("\n"),
);
check("one monitor watching two things is one monitor", rows.length === 1, JSON.stringify(rows));
check("events are not ends", rows[0]?.endedAt === undefined);
check("the latest event is kept", rows[0]?.lastEvent === "b: RUNNING");
check("expiry is start plus the stated time", rows[0]?.expiresAt === Date.parse(t0) + 30 * 60_000);
check("the session id comes from the entry", rows[0]?.claudeSessionId === "sess-1");

rows = parseMonitors(
  [...start("u2", "bbb222", "x"), notice("bbb222", "<status>completed</status>", "2026-09-29T06:30:00.000Z")].join("\n"),
);
check("a notification with a status ends it", rows[0]?.endedAt === Date.parse("2026-09-29T06:30:00.000Z"));

rows = parseMonitors(
  [
    ...start("u3", "ccc333", "y"),
    line({ timestamp: "2026-09-29T06:40:00.000Z", message: { content: [{ type: "tool_use", id: "s", name: "TaskStop", input: { task_id: "ccc333" } }] } }),
  ].join("\n"),
);
check("TaskStop ends it", rows[0]?.endedAt === Date.parse("2026-09-29T06:40:00.000Z"));

report();
