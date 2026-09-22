import { randomBytes, timingSafeEqual } from "node:crypto";

/**
 * A server that opens shells is remote code execution for anything that can
 * reach it. Three defences, all required:
 *   1. bind loopback only (see index.ts)
 *   2. a random per-run token on every request and every WS upgrade
 *   3. Origin/Host validation, which is what stops DNS rebinding and
 *      cross-site WebSocket hijacking (a WS upgrade is not subject to CORS,
 *      so the token alone is not enough).
 */
/**
 * A fresh random token per run, unless one is pinned.
 *
 * Pinning matters in development: `node --watch` restarts on every server
 * edit, and a new token each time invalidates the URL in the browser, so the
 * page starts 401ing mid-session. Set CV_TOKEN in config.env (gitignored) to
 * keep one stable URL. Unset is still the safer default for normal use.
 */
export const TOKEN =
  process.env.CV_TOKEN && process.env.CV_TOKEN.length >= 16
    ? process.env.CV_TOKEN
    : randomBytes(24).toString("base64url");

export function tokenMatches(candidate: string | undefined | null): boolean {
  if (!candidate) return false;
  const a = Buffer.from(candidate);
  const b = Buffer.from(TOKEN);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

const LOOPBACK = ["127.0.0.1", "localhost", "[::1]", "::1"];

/**
 * Accept only loopback origins, on the port we serve or on an allowed dev
 * port.
 *
 * The dev port matters: Vite serves the UI on 5173 and proxies /ws here, so
 * the browser's Origin is 5173 while the server listens on 8788. Allowing
 * only the server's own port silently broke every terminal in dev mode, with
 * "WebSocket is closed before the connection is established" and no output.
 *
 * Restricting to loopback is what defends against DNS rebinding: a page on
 * evil.com sends Origin: http://evil.com and is refused. A loopback origin
 * can only come from something already running on this machine.
 */
export function originAllowed(
  origin: string | undefined,
  _host: string,
  port: number,
  extraPorts: number[] = [],
): boolean {
  // Same-origin non-browser clients (curl, tests) send no Origin at all.
  if (origin === undefined) return true;
  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    return false;
  }
  if (!LOOPBACK.includes(url.hostname)) return false;
  if (url.protocol !== "http:" && url.protocol !== "https:") return false;
  const allowed = [String(port), ...extraPorts.map(String)];
  return allowed.includes(url.port);
}

/** Reject a Host header pointing at a name that is not ours (rebinding). */
export function hostHeaderAllowed(
  hostHeader: string | undefined,
  port: number,
  extraPorts: number[] = [],
): boolean {
  if (!hostHeader) return false;
  const [name] = hostHeader.split(":");
  if (!LOOPBACK.includes(name ?? "")) return false;
  // The dev proxy forwards with its own Host, so accept those ports too.
  return [port, ...extraPorts].some((p) => hostHeader.endsWith(`:${p}`));
}
