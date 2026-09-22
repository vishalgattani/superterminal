import type { Server } from "node:http";
import { WebSocketServer, type WebSocket } from "ws";
import {
  C2S,
  S2C,
  decodeJson,
  encodeJson,
  frame,
  unframe,
  type ResizePayload,
} from "@cv/shared";
import {
  hostHeaderAllowed,
  originAllowed,
  tokenMatches,
} from "../auth.ts";
import type { PtyManager } from "../pty/manager.ts";

export function attachTerminalSocket(opts: {
  server: Server;
  ptys: PtyManager;
  host: string;
  port: number;
  devPorts?: number[];
}) {
  const { server, ptys, port } = opts;
  const devPorts = opts.devPorts ?? [];
  const wss = new WebSocketServer({ noServer: true });

  server.on("upgrade", (req, socket, head) => {
    const url = new URL(req.url ?? "/", `http://${req.headers.host}`);
    const match = url.pathname.match(/^\/ws\/term\/([0-9a-fA-F-]{36})$/);

    const reject = (code: number, why: string) => {
      socket.write(`HTTP/1.1 ${code} ${why}\r\nConnection: close\r\n\r\n`);
      socket.destroy();
    };

    if (!match) return reject(404, "Not Found");
    // A WS upgrade bypasses CORS, so these two checks matter as much as the token.
    if (!originAllowed(req.headers.origin, opts.host, port, devPorts)) {
      return reject(403, "Forbidden Origin");
    }
    if (!hostHeaderAllowed(req.headers.host, port, devPorts)) {
      return reject(403, "Forbidden Host");
    }
    if (!tokenMatches(url.searchParams.get("token"))) {
      return reject(401, "Unauthorized");
    }

    const sessionId = match[1]!;
    const session = ptys.get(sessionId);
    if (!session) return reject(404, "No Such Session");

    wss.handleUpgrade(req, socket, head, (ws) => {
      wireSession(ws, sessionId, ptys);
    });
  });

  return wss;
}

function wireSession(ws: WebSocket, sessionId: string, ptys: PtyManager) {
  const session = ptys.get(sessionId)!;
  ws.binaryType = "nodebuffer";

  const send = (data: Uint8Array) => {
    if (ws.readyState === ws.OPEN) ws.send(data, { binary: true });
  };

  send(frame(S2C.HELLO, encodeJson(session.info)));

  const { backlog, token } = ptys.attach(
    sessionId,
    (chunk) => send(frame(S2C.DATA, chunk)),
    (code, signal) => {
      send(frame(S2C.EXIT, encodeJson({ code, signal })));
      ws.close(1000, "session exited");
    },
  );
  for (const chunk of backlog) send(frame(S2C.DATA, chunk));

  if (session.exited) {
    send(frame(S2C.EXIT, encodeJson(session.exited)));
    ws.close(1000, "session exited");
    return;
  }

  ws.on("message", (raw: Buffer, isBinary: boolean) => {
    if (!isBinary) return; // protocol is binary-only
    const { type, payload } = unframe(raw);
    switch (type) {
      case C2S.DATA:
        ptys.write(sessionId, payload);
        break;
      case C2S.RESIZE: {
        const { cols, rows } = decodeJson<ResizePayload>(payload);
        ptys.resize(sessionId, cols, rows);
        break;
      }
      case C2S.RESUME:
        ptys.drained(sessionId);
        break;
      default:
        break; // unknown frame types are ignored, not fatal
    }
  });

  // Pass the token so a socket that has already been superseded cannot
  // detach the connection that replaced it.
  ws.on("close", () => ptys.detach(sessionId, token));
  ws.on("error", () => ptys.detach(sessionId, token));
}
