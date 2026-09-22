// hostPalette: one colour per host, stable, and never local's for a remote.
import { check, report, src } from "./harness.mjs";

const { hostPalette, hostStyle } = await import(src("lib/hostColour.ts"));

check("local is the green it has always been", hostPalette("local").fg === "#7fd28c", hostPalette("local").fg);
check("fire keeps its amber", hostPalette("fire").fg === "#e2a06a", hostPalette("fire").fg);

// The bug this module exists to prevent: a second remote rendering as local.
const others = ["gpu-box", "staging", "ci-1", "bastion", "sandbox"];
check(
  "no remote is ever given local's colour",
  others.every((h) => hostPalette(h).fg !== hostPalette("local").fg),
  others.map((h) => `${h}=${hostPalette(h).fg}`).join(" "),
);
check(
  "no remote borrows fire's pinned colour",
  others.every((h) => hostPalette(h).fg !== hostPalette("fire").fg),
  others.map((h) => `${h}=${hostPalette(h).fg}`).join(" "),
);

check(
  "the same id always gets the same colour",
  others.every((h) => hostPalette(h).fg === hostPalette(h).fg) &&
    hostPalette("gpu-box").bg === hostPalette("gpu-box").bg,
);

// An id the browser has never seen must still render rather than throw.
check("an unknown host still yields a full palette", (() => {
  const p = hostPalette("never-seen-before");
  return Boolean(p.bg && p.fg && p.border);
})());

check("a pathological id does not fall off the palette", (() => {
  const p = hostPalette("\u{1f525}".repeat(50));
  return Boolean(p.bg && p.fg && p.border);
})());

check("an empty host id is still safe", Boolean(hostPalette("").fg));

const s = hostStyle("fire");
check(
  "hostStyle is the same colours in css spelling",
  s.background === hostPalette("fire").bg &&
    s.color === hostPalette("fire").fg &&
    s.borderColor === hostPalette("fire").border,
  JSON.stringify(s),
);

report();
