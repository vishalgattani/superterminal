// The three checks that stand between a web page and a shell on this machine:
// the token, the Origin of a WebSocket upgrade, and the Host header. A WS
// upgrade is not subject to CORS, so Origin is what stops a page on another
// site from opening a terminal; Host is what stops DNS rebinding.
import { repoRoot, check, report } from "./harness.mjs";

// auth.ts reads CV_TOKEN when it is imported, and config.ts (imported by
// nothing here, but by anything that follows) reads a config file: pin both so
// the result does not depend on the machine running the test.
process.env.CV_TOKEN = "unit-test-token-0123456789";
process.env.CV_CONFIG = "/nonexistent/config.env";
const { tokenMatches, originAllowed, hostHeaderAllowed, TOKEN } = await import(
  `${repoRoot}/apps/server/src/auth.ts`
);

// ---- token
check("the pinned token is used", TOKEN === "unit-test-token-0123456789");
check("the right token matches", tokenMatches("unit-test-token-0123456789") === true);
check("a wrong token does not", tokenMatches("unit-test-token-0123456780") === false);
check("a prefix of the token does not", tokenMatches("unit-test-token") === false);
check("the token with something appended does not", tokenMatches("unit-test-token-0123456789x") === false);
check("an empty token does not", tokenMatches("") === false);
check("a missing token does not", tokenMatches(undefined) === false && tokenMatches(null) === false);

// ---- Origin of a WebSocket upgrade
const PORT = 8788;
const origin = (o, extra = []) => originAllowed(o, "127.0.0.1", PORT, extra);
check("no Origin is allowed (curl and test clients send none)", origin(undefined) === true);
check("loopback on the server's port is allowed", origin("http://127.0.0.1:8788") === true);
check("localhost on the server's port is allowed", origin("http://localhost:8788") === true);
check("IPv6 loopback on the server's port is allowed", origin("http://[::1]:8788") === true);
check("https loopback is allowed", origin("https://localhost:8788") === true);
check("a foreign site is refused", origin("http://evil.com") === false);
check("a foreign site on our port is refused", origin("http://evil.com:8788") === false);
check("a look-alike host is refused", origin("http://127.0.0.1.evil.com:8788") === false);
check("loopback on another port is refused", origin("http://127.0.0.1:9999") === false);
check("the Vite dev port is refused unless allowed", origin("http://127.0.0.1:5173") === false);
check("...and allowed when it is listed", origin("http://127.0.0.1:5173", [5173]) === true);
check("a non-http scheme is refused", origin("file://") === false && origin("chrome-extension://abc") === false);
check("the string 'null' (a sandboxed page) is refused", origin("null") === false);
check("a malformed Origin is refused", origin("not a url") === false && origin("") === false);

// ---- Host header (DNS rebinding)
const host = (h, extra = []) => hostHeaderAllowed(h, PORT, extra);
check("loopback with the server's port is allowed", host("127.0.0.1:8788") === true);
check("localhost with the server's port is allowed", host("localhost:8788") === true);
check("a missing Host is refused", host(undefined) === false && host("") === false);
check("a rebound name is refused", host("evil.com:8788") === false);
check("a look-alike name is refused", host("127.0.0.1.evil.com:8788") === false);
check("a port suffix cannot smuggle a name past it", host("127.0.0.1:8788.evil.com") === false);
check("loopback on another port is refused", host("127.0.0.1:9999") === false);
check("loopback with no port is refused", host("127.0.0.1") === false);
check("the dev proxy's port is refused unless allowed", host("127.0.0.1:5173") === false);
check("...and allowed when it is listed", host("127.0.0.1:5173", [5173]) === true);

report();
