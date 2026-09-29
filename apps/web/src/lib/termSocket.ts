import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebglAddon } from "@xterm/addon-webgl";
import {
  C2S,
  S2C,
  decodeJson,
  encodeJson,
  frame,
  unframe,
  type ExitPayload,
  type SessionInfo,
} from "@cv/shared";
import { createResizeSender } from "./resizeSender.ts";

export interface Metrics {
  /** Keystroke to first byte back from the pty, in ms. */
  echoMs: number | null;
  /** Time from socket message to xterm write callback, in ms. */
  paintMs: number | null;
  bytesIn: number;
  writesPending: number;
}

export interface TermHandle {
  term: Terminal;
  fit: () => void;
  dispose: () => void;
  onInfo: (cb: (info: SessionInfo) => void) => void;
  onExit: (cb: (p: ExitPayload) => void) => void;
  onMetrics: (cb: (m: Metrics) => void) => void;
  onResize: (cb: (size: { cols: number; rows: number }) => void) => void;
}

/**
 * Wires one xterm instance to one terminal socket.
 *
 * Two things here are deliberate and easy to get wrong:
 *  - keystrokes go to the socket untouched (no local interpretation of arrows,
 *    Enter or control bytes), because xterm already encodes them the way a
 *    shell expects;
 *  - we count bytes written and only tell the server we have drained once
 *    xterm's write callback fires, which is what keeps a large burst from
 *    freezing the tab.
 */
export function openTerminal(opts: {
  container: HTMLElement;
  sessionId: string;
  token: string;
}): TermHandle {
  const term = new Terminal({
    allowProposedApi: true,
    cursorBlink: true,
    fontFamily:
      'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace',
    fontSize: 13,
    scrollback: 10000,
    // With tmux mouse mode on, tmux takes the mouse and a plain drag selects
    // nothing in the browser. xterm.js lets Option+drag override that on a Mac,
    // but only when this is set; Shift does it elsewhere.
    macOptionClickForcesSelection: true,
    theme: {
      background: "#111113",
      foreground: "#e6e6e6",
      cursor: "#e6e6e6",
      selectionBackground: "#3a3a42",
    },
  });

  const fitAddon = new FitAddon();
  term.loadAddon(fitAddon);
  // Attach only once the container is in the DOM, or geometry is computed wrong.
  term.open(opts.container);

  // WebGL is the reason bursts stay smooth. Fall back silently if the context
  // is refused (browsers cap live WebGL contexts per page).
  try {
    const webgl = new WebglAddon();
    webgl.onContextLoss(() => webgl.dispose());
    term.loadAddon(webgl);
  } catch {
    console.warn("[cv] WebGL renderer unavailable, using the DOM renderer");
  }

  const proto = location.protocol === "https:" ? "wss:" : "ws:";
  const ws = new WebSocket(
    `${proto}//${location.host}/ws/term/${opts.sessionId}?token=${encodeURIComponent(opts.token)}`,
  );
  ws.binaryType = "arraybuffer";

  const metrics: Metrics = {
    echoMs: null,
    paintMs: null,
    bytesIn: 0,
    writesPending: 0,
  };
  let infoCb: ((i: SessionInfo) => void) | undefined;
  let exitCb: ((p: ExitPayload) => void) | undefined;
  let metricsCb: ((m: Metrics) => void) | undefined;
  let resizeCb: ((s: { cols: number; rows: number }) => void) | undefined;
  let lastKeyAt: number | null = null;
  let pendingBytes = 0;
  const RESUME_AT = 64 * 1024;

  const send = (data: Uint8Array) => {
    if (ws.readyState === WebSocket.OPEN) ws.send(data);
  };

  ws.onmessage = (ev: MessageEvent<ArrayBuffer>) => {
    const { type, payload } = unframe(ev.data);
    switch (type) {
      case S2C.HELLO:
        infoCb?.(decodeJson<SessionInfo>(payload));
        break;
      case S2C.DATA: {
        const at = performance.now();
        metrics.bytesIn += payload.byteLength;
        pendingBytes += payload.byteLength;
        metrics.writesPending++;
        // Copy: xterm keeps the buffer past this tick.
        term.write(new Uint8Array(payload), () => {
          metrics.writesPending--;
          metrics.paintMs = performance.now() - at;
          if (lastKeyAt !== null) {
            metrics.echoMs = performance.now() - lastKeyAt;
            lastKeyAt = null;
          }
          // Tell the server we have caught up so it can unpause the pty.
          if (pendingBytes >= RESUME_AT && metrics.writesPending === 0) {
            pendingBytes = 0;
            send(frame(C2S.RESUME));
          }
          metricsCb?.({ ...metrics });
        });
        break;
      }
      case S2C.EXIT:
        exitCb?.(decodeJson<ExitPayload>(payload));
        break;
    }
  };

  const keyDisposable = term.onData((data) => {
    lastKeyAt = performance.now();
    send(frame(C2S.DATA, data));
  });

  // Not until the socket is open, and not again for an unchanged size: see
  // resizeSender.ts for the lost-resize bug this replaced.
  const sendResize = createResizeSender({
    isOpen: () => ws.readyState === WebSocket.OPEN,
    send: (cols, rows) => send(frame(C2S.RESIZE, encodeJson({ cols, rows }))),
    onSent: (size) => resizeCb?.(size),
  });

  /**
   * Measuring a hidden or mid-animation container yields a nonsense grid: the
   * collapsing side panel briefly reported 2 columns, and pushing that to the
   * pty would rewrap whatever is running. Skip anything implausible and let
   * the next observation settle it.
   */
  const measurable = () => {
    const el = opts.container;
    return el.isConnected && el.clientWidth >= 80 && el.clientHeight >= 40;
  };

  // A fresh page has none of what the pty drew before it attached, and the
  // backlog only holds output from while no page was attached, so a running
  // TUI's incremental redraws land on a blank screen and garble it. The pty is
  // usually the size we ask for already, which delivers no SIGWINCH, so on the
  // first fit after connecting nudge it a row shorter and back: the TUI
  // repaints everything. Not at open: a hidden pane cannot be measured then.
  // Sent around the resize sender, whose dedupe exists to prevent this redraw.
  let repaintPending = true;
  const repaint = () => {
    repaintPending = false;
    const { cols, rows } = term;
    if (rows < 2) return;
    send(frame(C2S.RESIZE, encodeJson({ cols, rows: rows - 1 })));
    setTimeout(() => {
      if (ws.readyState === WebSocket.OPEN && term.cols === cols && term.rows === rows) {
        send(frame(C2S.RESIZE, encodeJson({ cols, rows })));
      }
    }, 80);
  };

  const fit = () => {
    if (!measurable()) return;
    try {
      fitAddon.fit();
    } catch {
      return; // container not measurable yet
    }
    sendResize(term.cols, term.rows);
    if (repaintPending && ws.readyState === WebSocket.OPEN) repaint();
  };

  ws.onopen = () => fit();

  // A mismatch between the xterm grid and the pty grid corrupts TUI output, so
  // resize is observed on the container, not just on window resize. Debounced,
  // because a CSS transition fires this on every frame.
  let resizeTimer: number | undefined;
  const observer = new ResizeObserver(() => {
    if (resizeTimer !== undefined) clearTimeout(resizeTimer);
    resizeTimer = setTimeout(fit, 60) as unknown as number;
  });
  observer.observe(opts.container);

  return {
    term,
    fit,
    dispose() {
      if (resizeTimer !== undefined) clearTimeout(resizeTimer);
      observer.disconnect();
      keyDisposable.dispose();
      try {
        ws.close();
      } catch {
        /* already closed */
      }
      term.dispose();
    },
    onInfo(cb) {
      infoCb = cb;
    },
    onExit(cb) {
      exitCb = cb;
    },
    onMetrics(cb) {
      metricsCb = cb;
    },
    onResize(cb) {
      resizeCb = cb;
    },
  };
}
