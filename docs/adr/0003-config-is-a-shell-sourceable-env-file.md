---
status: accepted
---
# Configuration is a shell-sourceable KEY=value file, not TOML

`config.env` holds every configured value, in a format that `source config.env` accepts directly. Two reasons. Node has no built-in TOML parser, and an earlier version of the config loader assumed one and **silently ignored `config.toml` entirely** — the failure mode was an empty config that looked like a working one. And the vendored bash scripts need the same values, so a shell-sourceable file is what makes "the instance id exists exactly once" true rather than aspirational.

## Considered options
- `config.toml` with a parser dependency — rejected once: the parserless version failed silently, and adding a dependency to read four values is not worth it.
- JSON — rejected: bash cannot source it without `jq`, so the values would be defined twice.

## Consequences
- Values are parsed by `parseEnvFile()` in `apps/server/src/config.ts`, which handles `#` comments, `export ` prefixes and quoted values.
- `CV_CONFIG` and `CV_STATE_DIR` redirect both, so a scratch server reads neither the real config nor the real state.
- The file is gitignored: it holds the instance id, IP, key path and token.
