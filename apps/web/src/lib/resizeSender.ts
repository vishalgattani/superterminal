/**
 * Decides when a terminal's grid size is sent to the server.
 *
 * Two rules, and the first was missing:
 *
 *  - **Nothing is sent, or remembered as sent, until the socket is open.**
 *    xterm is fitted as soon as the container is measurable, which can be
 *    before the WebSocket has connected. That frame was dropped, but the size
 *    was still recorded as delivered, so when the socket opened and asked again
 *    the size looked unchanged and was skipped. The server's pty then stayed at
 *    the size it was created with (80x45 for a re-adopted terminal) while xterm
 *    drew a wider grid: tmux painted 80 columns into a 115-column panel, and the
 *    node's header, taken from the same fit, claimed 115x44.
 *  - **An unchanged size is not sent again.** A redundant resize is not free: it
 *    makes a running TUI redraw.
 */
export interface ResizeSender {
  (cols: number, rows: number): void;
}

export function createResizeSender(opts: {
  isOpen: () => boolean;
  send: (cols: number, rows: number) => void;
  /** Called only for a size that was actually sent. */
  onSent?: (size: { cols: number; rows: number }) => void;
}): ResizeSender {
  let lastCols = 0;
  let lastRows = 0;
  return (cols, rows) => {
    if (!opts.isOpen()) return;
    if (cols === lastCols && rows === lastRows) return;
    lastCols = cols;
    lastRows = rows;
    opts.send(cols, rows);
    opts.onSent?.({ cols, rows });
  };
}
