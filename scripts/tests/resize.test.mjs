// When a terminal's grid size is sent to the server.
//
// The bug this pins: the first fit can run before the WebSocket has connected.
// That frame was dropped, but the size was still remembered as sent, so when the
// socket opened and fitted again the size looked unchanged and was skipped. The
// pty stayed at the size it was created with (80x45 for a re-adopted terminal)
// while xterm drew a wider grid, and tmux painted 80 columns into a wider panel.
import { check, report, src } from "./harness.mjs";

const { createResizeSender } = await import(src("lib/resizeSender.ts"));

const rig = () => {
  const state = { open: false, sent: [], notified: [] };
  const fit = createResizeSender({
    isOpen: () => state.open,
    send: (cols, rows) => state.sent.push(`${cols}x${rows}`),
    onSent: (s) => state.notified.push(`${s.cols}x${s.rows}`),
  });
  return { state, fit };
};

// ---- the lost resize
let { state, fit } = rig();
fit(115, 44);
check("a fit before the socket is open sends nothing", state.sent.length === 0, state.sent.join());
check("...and does not tell the UI the size was applied", state.notified.length === 0, state.notified.join());

state.open = true;
fit(115, 44);
check("the same size, asked again once the socket opens, is sent (it was never delivered)",
  state.sent.join() === "115x44", state.sent.join());
check("...and only then does the UI hear about it", state.notified.join() === "115x44", state.notified.join());

// ---- no redundant resizes
fit(115, 44);
fit(115, 44);
check("an unchanged size is not sent again", state.sent.length === 1, state.sent.join());

fit(140, 44);
check("a changed size is sent", state.sent.join() === "115x44,140x44", state.sent.join());
fit(115, 44);
check("going back to an earlier size is a change, and is sent",
  state.sent.join() === "115x44,140x44,115x44", state.sent.join());

// ---- a change of rows alone counts
({ state, fit } = rig());
state.open = true;
fit(100, 30);
fit(100, 31);
check("a change in rows alone is sent", state.sent.join() === "100x30,100x31", state.sent.join());

// ---- several attempts before open, one send after
({ state, fit } = rig());
fit(90, 40);
fit(100, 40);
fit(115, 44);
state.open = true;
fit(115, 44);
check("sizes tried before open are all dropped; the one asked for after open is sent",
  state.sent.join() === "115x44", state.sent.join());

report();
