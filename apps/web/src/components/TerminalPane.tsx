import { useEffect, useRef } from "react";
import type { SessionInfo } from "@cv/shared";
import { openTerminal, type Metrics, type TermHandle } from "../lib/termSocket.ts";
import { useStore } from "../store.ts";

/**
 * One mounted xterm per session. Panes for sessions that are not currently
 * shown stay mounted but hidden, so scrollback and the socket survive
 * collapsing the panel. Unmounting would drop the connection and, in M1, the
 * shell with it.
 */
export function TerminalPane({
  session,
  visible,
  debug,
  onMetrics,
}: {
  session: SessionInfo;
  visible: boolean;
  debug: boolean;
  onMetrics: (m: Metrics) => void;
}) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const handleRef = useRef<TermHandle | null>(null);
  const token = useStore((s) => s.token);
  const updateSession = useStore((s) => s.updateSession);
  const markExited = useStore((s) => s.markExited);
  const focusOnOpen = useStore((s) => s.focusOnOpen);
  // Changing on reattach tears this pane down and rebuilds it against the new
  // pty, which is the only way to replace a dead socket.
  const epoch = useStore((s) => s.epoch[session.sessionId] ?? 0);

  useEffect(() => {
    if (!hostRef.current) return;
    const handle = openTerminal({
      container: hostRef.current,
      sessionId: session.sessionId,
      token,
    });
    handleRef.current = handle;
    handle.onResize(({ cols, rows }) =>
      updateSession(session.sessionId, { cols, rows }),
    );
    handle.onExit(() => markExited(session.sessionId));
    if (debug) {
      handle.onMetrics(onMetrics);
      (window as unknown as { __cvTerm?: unknown }).__cvTerm = handle.term;
    }
    return () => {
      handle.dispose();
      handleRef.current = null;
    };
  }, [session.sessionId, epoch]);

  // A hidden container has no measurable size, so xterm cannot fit while
  // collapsed. Refit on the way back in.
  //
  // Focus depends on how the pane was opened. Clicking a node (or creating
  // one) means "I want to type here", so we focus. Tab cycling does not,
  // because a focused terminal swallows the next Tab (Claude Code binds
  // Shift+Tab to cycle permission modes) and the cycle would stop after one
  // step.
  useEffect(() => {
    if (!visible) return;
    const id = requestAnimationFrame(() => {
      handleRef.current?.fit();
      // Never steal focus from an open rename box.
      if (focusOnOpen && !useStore.getState().renamingId) {
        handleRef.current?.term.focus();
      }
      if (debug) {
        (window as unknown as { __cvTerm?: unknown }).__cvTerm =
          handleRef.current?.term;
      }
    });
    return () => cancelAnimationFrame(id);
  }, [visible, focusOnOpen]);

  return (
    <div
      ref={hostRef}
      className={visible ? "cv-pane cv-pane-visible" : "cv-pane"}
      style={{
        position: "absolute",
        inset: 8,
        visibility: visible ? "visible" : "hidden",
        pointerEvents: visible ? "auto" : "none",
      }}
    />
  );
}
