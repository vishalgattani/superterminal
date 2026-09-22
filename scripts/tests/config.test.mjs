// The config file is shell-sourceable KEY=value, read by the server and by the
// vendored scripts, so the two must agree on what a line means. An earlier
// version parsed TOML that Node cannot read and ignored the file *silently*
// (docs/adr/0003), so what a malformed line does is worth pinning.
import { repoRoot, check, report } from "./harness.mjs";

process.env.CV_CONFIG = "/nonexistent/config.env"; // importing must not read the real one
const { parseEnvFile } = await import(`${repoRoot}/apps/server/src/config.ts`);
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

check("plain KEY=value", eq(parseEnvFile("A=1\nB=two"), { A: "1", B: "two" }));
check("blank lines and comments are skipped", eq(parseEnvFile("\n# note\nA=1\n   \n#B=2"), { A: "1" }));
check("whitespace around the key and value is trimmed", eq(parseEnvFile("  A  =  1  "), { A: "1" }));
check("an `export` prefix is accepted, as `source` would", eq(parseEnvFile("export A=1"), { A: "1" }));
check("double quotes are stripped", eq(parseEnvFile('A="hello world"'), { A: "hello world" }));
check("single quotes are stripped", eq(parseEnvFile("A='hello world'"), { A: "hello world" }));
check("a value may contain =", eq(parseEnvFile("A=b=c"), { A: "b=c" }));
check("a trailing comment is stripped from an unquoted value", eq(parseEnvFile("A=1 # why"), { A: "1" }));
check("...but not from a quoted one", eq(parseEnvFile('A="1 # kept"'), { A: "1 # kept" }));
check("a # inside an unquoted value with no space before it is kept", eq(parseEnvFile("A=a#b"), { A: "a#b" }));
check("a line with no = is ignored, not an error", eq(parseEnvFile("JUNK\nA=1"), { A: "1" }));
check("an empty key is ignored", eq(parseEnvFile("=1\nA=2"), { A: "2" }));
check("an empty value is kept as an empty string", eq(parseEnvFile("A="), { A: "" }));
check("the last of a repeated key wins", eq(parseEnvFile("A=1\nA=2"), { A: "2" }));
check("Windows line endings do not leak into values", eq(parseEnvFile("A=1\r\nB=2\r\n"), { A: "1", B: "2" }));
check("empty input is an empty config", eq(parseEnvFile(""), {}));

report();
