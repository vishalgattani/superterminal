// Generating an SSH key from Host settings (issue #38), through the real route.
// The rig server sets CV_SSH_DIR inside the rig, so keys land there, never in
// the owner's ~/.ssh.
import { existsSync } from "node:fs";
import { join } from "node:path";
import { check, report } from "./harness.mjs";
import { call, rigDir } from "./api-helper.mjs";

const sshDir = join(rigDir, "ssh");

let [status, body] = await call("POST", "/api/ssh/keygen", { name: "k1", type: "dsa" });
check("an unsupported type is refused", status === 400, JSON.stringify(body));

[status, body] = await call("POST", "/api/ssh/keygen", { name: "../escape", type: "ed25519" });
check("a name that leaves ~/.ssh is refused", status === 400, JSON.stringify(body));

[status, body] = await call("POST", "/api/ssh/keygen", { name: "apitest_ed", type: "ed25519" });
check("an ed25519 key is created", status === 200, JSON.stringify(body));
check("...in the server's ssh directory", body.keyPath === join(sshDir, "apitest_ed") && existsSync(body.keyPath));
check("...and its public key is returned", body.publicKey?.startsWith("ssh-ed25519 "), body.publicKey);

[status, body] = await call("POST", "/api/ssh/keygen", { name: "apitest_ed", type: "ed25519" });
check("an existing key is never overwritten", status === 409, JSON.stringify(body));

[status, body] = await call("POST", "/api/ssh/keygen", { name: "apitest_rsa", type: "rsa" });
check("an RSA key is created", status === 200 && body.publicKey?.startsWith("ssh-rsa "), JSON.stringify(body).slice(0, 120));

report();
