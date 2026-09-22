// How a subagent count and its age are described. The count is only as fresh
// as the last transcript scan, and saying so is the point of these helpers.
import { check, report, src } from "./harness.mjs";

const { subagentLabel, scanAge, isStale } = await import(src("lib/subagents.ts"));

check("one subagent is singular", subagentLabel(1) === "1 subagent", subagentLabel(1));
check("several are plural", subagentLabel(4) === "4 subagents", subagentLabel(4));

const now = 1_700_000_000_000;
check("a never-scanned count says so, rather than 'just now'", scanAge(0, now) === "not scanned yet", scanAge(0, now));
check("a fresh scan is 'just now'", scanAge(now - 2000, now) === "just now", scanAge(now - 2000, now));
check("seconds are shown in seconds", scanAge(now - 12_000, now) === "12s ago", scanAge(now - 12_000, now));
check("a minute is singular", scanAge(now - 60_000, now) === "1m ago", scanAge(now - 60_000, now));
check("minutes are plural", scanAge(now - 180_000, now) === "3m ago", scanAge(now - 180_000, now));

check("never scanned counts as stale", isStale(0, now) === true);
check("a scan seconds old is not stale", isStale(now - 10_000, now) === false);
check("a scan a minute old is stale", isStale(now - 60_000, now) === true);

// The failure this guards: a fan-out that just started still scans as zero, so
// an unscanned or stale zero must never be presented as a confident "none".
check("staleness is decided by age, not by the count", isStale(now - 90_000, now) === true);

report();
