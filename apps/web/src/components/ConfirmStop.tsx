import { useEffect, useState } from "react";
import { useStore } from "../store.ts";
import { short } from "./ForeignActions.tsx";

/**
 * Asks before sending SIGTERM to a live Claude session.
 *
 * One dialog for every place a session can be stopped (the Agents list, a
 * canvas card, a board card), so the wording and the failure handling cannot
 * drift apart. A failed stop keeps the dialog open with the reason, because the
 * session is still running and the owner needs to know that.
 */
export function ConfirmStop() {
  const a = useStore((s) => s.stopRequest);
  const askStop = useStore((s) => s.askStop);
  const stopAgent = useStore((s) => s.stopAgent);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // A new request starts clean, so a previous failure does not linger.
  useEffect(() => {
    setBusy(false);
    setError(null);
  }, [a?.host, a?.sessionId]);

  useEffect(() => {
    if (!a) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        askStop(null);
      }
    };
    // Captured, so it resolves before the terminal focus handler. There is no
    // Enter shortcut: stopping a session should take a deliberate click.
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [a, askStop]);

  if (!a) return null;

  const stop = () => {
    setBusy(true);
    setError(null);
    stopAgent(a)
      .then(() => askStop(null))
      .catch((e) => setError((e as Error).message))
      .finally(() => setBusy(false));
  };

  return (
    <div style={backdrop} onMouseDown={() => !busy && askStop(null)} role="presentation">
      <div
        style={dialog}
        role="alertdialog"
        aria-modal="true"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <h2 style={{ margin: "0 0 8px", fontSize: 15 }}>
          Stop “{a.name || a.sessionId.slice(0, 8)}”?
        </h2>
        <p style={{ margin: "0 0 10px", fontSize: 13, color: "#c3c3cb" }}>
          Sends SIGTERM to pid {a.pid} on {a.host}, so Claude Code can shut down
          and run its SessionEnd hooks. Anything it is part-way through will stop.
        </p>
        <p style={{ margin: "0 0 16px", fontSize: 11.5, color: "#80808a" }}>
          {short(a.cwd)}
        </p>
        {error && (
          <p role="alert" style={{ margin: "0 0 12px", fontSize: 12.5, color: "#f19aa5" }}>
            Could not stop it: {error}
          </p>
        )}
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <button style={btn} disabled={busy} onClick={() => askStop(null)}>
            Cancel
          </button>
          <button
            style={{ ...btn, background: "#7a2430", borderColor: "#95313f" }}
            disabled={busy}
            onClick={stop}
          >
            {busy ? "Stopping…" : "Stop session"}
          </button>
        </div>
      </div>
    </div>
  );
}

const backdrop: React.CSSProperties = {
  position: "fixed",
  inset: 0,
  background: "#05050799",
  backdropFilter: "blur(2px)",
  display: "grid",
  placeItems: "center",
  zIndex: 1000,
};

const dialog: React.CSSProperties = {
  width: "min(420px, calc(100vw - 32px))",
  background: "#15151a",
  border: "1px solid #2f2f39",
  borderRadius: 12,
  padding: "18px 20px",
  boxShadow: "0 18px 50px #000000aa",
};

const btn: React.CSSProperties = {
  background: "#22222a",
  border: "1px solid #33333d",
  color: "#e6e6e6",
  borderRadius: 6,
  padding: "6px 13px",
  cursor: "pointer",
  font: "inherit",
  fontSize: 12.5,
};
