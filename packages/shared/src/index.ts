// Wire protocol shared by the server and the web client.
//
// The terminal socket carries BINARY frames only, with a one-byte type prefix,
// so the hot path never parses JSON. Keystrokes and pty output are the common
// case and must stay cheap; control messages are rare.

/** Client -> server frame types. */
export const C2S = {
  /** payload: raw keystroke bytes, forwarded to the pty untouched */
  DATA: 0x00,
  /** payload: JSON {cols, rows} */
  RESIZE: 0x01,
  /** payload: none. Client finished draining; server may resume the pty. */
  RESUME: 0x02,
} as const;

/** Server -> client frame types. */
export const S2C = {
  /** payload: raw pty output bytes */
  DATA: 0x00,
  /** payload: JSON {code, signal} */
  EXIT: 0x01,
  /** payload: JSON SessionInfo */
  HELLO: 0x02,
} as const;

/**
 * Session identity is (host, sessionId) from the very first line of code. A bare
 * path or a pty index must never become the key, or adding a host becomes a
 * rewrite.
 *
 * An open string, not a union: remote hosts are configured, so their ids are not
 * known at authoring time. `"local"` is the one reserved id, and it is the only
 * one any code may compare against — everything else must come from the host
 * registry. See docs/adr/0004-hosts-behind-an-interface-from-day-one.md.
 */
export type HostId = string;
export const LOCAL_HOST_ID = "local";

/** True for every configured remote. There is exactly one non-remote host. */
export function isRemoteHost(host: HostId): boolean {
  return host !== LOCAL_HOST_ID;
}

/** A node on the canvas is a shell first; Claude is a decoration on top. */
export type SessionKind = "shell" | "claude";

export interface SessionInfo {
  sessionId: string;
  host: HostId;
  kind: SessionKind;
  cwd: string;
  shell: string;
  cols: number;
  rows: number;
  /** Owner-supplied label. Claude is never told about it. */
  alias?: string;
  /**
   * The tmux session backing this terminal, when the host uses one.
   *
   * Stored rather than derived from the session id: a terminal re-adopted
   * after a server restart gets a fresh id, and deriving the name from it
   * would stop matching the tmux session that is actually there.
   */
  tmuxSession?: string;
  /**
   * The Claude model this terminal was started with, when one was asked for.
   *
   * Recorded rather than inferred: two sessions on the same box can run
   * different models and look identical, so "is this actually sonnet?" was
   * previously unanswerable from the canvas. Absent means no model was
   * specified and Claude chose its own default.
   */
  model?: string;
  startedAt: number;
}

export interface ResizePayload {
  cols: number;
  rows: number;
}

export interface ExitPayload {
  code: number;
  signal?: number;
}

/** Build a binary frame: one type byte followed by the payload. */
export function frame(type: number, payload?: Uint8Array | string): Uint8Array {
  const body =
    payload === undefined
      ? new Uint8Array(0)
      : typeof payload === "string"
        ? new TextEncoder().encode(payload)
        : payload;
  const out = new Uint8Array(body.length + 1);
  out[0] = type;
  out.set(body, 1);
  return out;
}

/** Split a binary frame into its type byte and payload view. */
export function unframe(buf: ArrayBufferView | ArrayBuffer): {
  type: number;
  payload: Uint8Array;
} {
  const view =
    buf instanceof Uint8Array
      ? buf
      : ArrayBuffer.isView(buf)
        ? new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength)
        : new Uint8Array(buf);
  return { type: view[0]!, payload: view.subarray(1) };
}

export function encodeJson(value: unknown): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(value));
}

export function decodeJson<T>(payload: Uint8Array): T {
  return JSON.parse(new TextDecoder().decode(payload)) as T;
}
