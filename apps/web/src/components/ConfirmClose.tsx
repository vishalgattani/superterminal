import { useEffect, useRef } from "react";
import { useStore } from "../store.ts";

/**
 * Centred popup asking before a session is killed.
 *
 * Rendered once at the app level rather than inside a node, so it is a real
 * dialog over the whole page instead of something cramped into a 210px card.
 * Still not a native confirm(), which would block every other terminal's
 * output while it sat open.
 */
export function ConfirmClose() {
  const id = useStore((s) => s.confirmCloseId);
  const session = useStore((s) => (id ? s.sessions[id] : undefined));
  const exited = useStore((s) => (id ? Boolean(s.exited[id]) : false));
  const askClose = useStore((s) => s.askClose);
  const killSession = useStore((s) => s.killSession);
  const closing = useStore((s) => s.closing);
  const closeError = useStore((s) => s.closeError);
  const cancelRef = useRef<HTMLButtonElement | null>(null);

  // Esc cancels. Captured, so it resolves before the terminal focus handler.
  useEffect(() => {
    if (!id) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        askClose(null);
      }
      if (e.key === "Enter") {
        e.preventDefault();
        e.stopPropagation();
        // Enter takes the gentler option for a remote session, which is only
        // ever a disconnect: ending remote work needs a deliberate click.
        void killSession(id);
      }
    };
    window.addEventListener("keydown", onKey, true);
    cancelRef.current?.focus();
    return () => window.removeEventListener("keydown", onKey, true);
  }, [id, askClose, killSession]);

  if (!id || !session) return null;
  const name = session.alias || session.shell.split("/").pop() || "this session";
  // A tmux-backed session outlives its node. Closing the node only lets go of
  // it, so the dialog offers that and ending it as two separate, named choices.
  const remote = session.tmuxSession;

  return (
    <div
      style={backdrop}
      onMouseDown={() => askClose(null)}
      role="presentation"
    >
      <div
        style={dialog}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="cv-confirm-title"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <h2 id="cv-confirm-title" style={title}>
          Close “{name}”?
        </h2>
        <p style={body}>
          {remote
            ? `This session runs in tmux on ${session.host}, so it keeps going after the node is gone and comes back the next time the viewer starts. Disconnect to leave it running, or terminate to end it and anything inside it, including a Claude session.`
            : exited
              ? "This session has already exited. Closing removes it from the graph."
              : "The shell and anything running inside it, including a Claude session, will end. This cannot be undone."}
        </p>
        <p style={meta}>
          {session.host} · {session.cwd}
          {remote ? ` · tmux ${remote}` : ""}
        </p>
        {closeError && (
          <p role="alert" style={errorText}>
            Could not terminate: {closeError}. The session is still running.
          </p>
        )}
        <div style={row}>
          <button ref={cancelRef} style={button} onClick={() => askClose(null)}>
            Cancel
          </button>
          {remote ? (
            <>
              <button
                style={button}
                disabled={closing}
                onClick={() => void killSession(id)}
              >
                Disconnect
              </button>
              <button
                style={{ ...button, ...danger, opacity: closing ? 0.6 : 1 }}
                disabled={closing}
                onClick={() => void killSession(id, true)}
              >
                {closing ? "Terminating…" : `Terminate on ${session.host}`}
              </button>
            </>
          ) : (
            <button style={{ ...button, ...danger }} onClick={() => void killSession(id)}>
              Close session
            </button>
          )}
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

const title: React.CSSProperties = {
  margin: "0 0 8px",
  fontSize: 15,
  fontWeight: 600,
};

const body: React.CSSProperties = {
  margin: "0 0 10px",
  fontSize: 13,
  lineHeight: 1.45,
  color: "#c3c3cb",
};

const meta: React.CSSProperties = {
  margin: "0 0 16px",
  fontSize: 11.5,
  color: "#80808a",
  wordBreak: "break-all",
};

const danger: React.CSSProperties = {
  background: "#7a2430",
  borderColor: "#95313f",
};

const errorText: React.CSSProperties = {
  margin: "0 0 12px",
  fontSize: 12.5,
  lineHeight: 1.4,
  color: "#f19aa5",
};

const row: React.CSSProperties = {
  display: "flex",
  gap: 8,
  justifyContent: "flex-end",
};

const button: React.CSSProperties = {
  background: "#22222a",
  border: "1px solid #33333d",
  color: "#e6e6e6",
  borderRadius: 6,
  padding: "6px 13px",
  cursor: "pointer",
  font: "inherit",
  fontSize: 12.5,
};
