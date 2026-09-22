#!/usr/bin/env bash
# Read-only probe for the fire instance. Installs nothing, changes nothing.
# It answers the questions M2 is blocked on.
#
# Run it ON the instance:
#     bash fire-probe.sh
# or from the Mac, without copying it over:
#     ssh -i ~/.ssh/<key> <user>@<host> 'bash -s' < scripts/fire-probe.sh

echo "=== fire probe: $(date -u +%Y-%m-%dT%H:%M:%SZ) ==="
echo "host:   $(hostname)"
echo "os:     $(. /etc/os-release 2>/dev/null && echo "$PRETTY_NAME")"
echo "arch:   $(uname -m)"
echo

echo "--- 1. tmux (the one thing M2 needs installed) ---"
if command -v tmux >/dev/null 2>&1; then
  echo "tmux:   $(tmux -V)   OK"
  echo "existing sessions:"
  tmux ls 2>&1 | sed 's/^/  /'
else
  echo "tmux:   NOT INSTALLED  ->  sudo apt-get update && sudo apt-get install -y tmux"
fi
echo

echo "--- 2. sshd reverse forwarding (decides whether hooks can reach the Mac) ---"
# -R needs AllowTcpForwarding yes or remote. Unset means yes (OpenSSH default).
# Capture first and test the variable: piping grep into sed hides grep's exit
# status behind sed's, so an "|| echo" fallback on the pipeline never fires.
# That bug made this whole section print nothing on the first run.
effective=""
command -v sshd >/dev/null 2>&1 && effective=$(sshd -T 2>/dev/null | grep -Ei '^(allowtcpforwarding|gatewayports|permitopen)')
configured=$(grep -RiEh '^[[:space:]]*(AllowTcpForwarding|GatewayPorts|PermitOpen)' \
  /etc/ssh/sshd_config /etc/ssh/sshd_config.d/ 2>/dev/null)

if [ -n "$effective" ]; then
  echo "$effective" | sed 's/^/  effective: /'
else
  echo "  (sshd -T needs root, so no effective config here)"
fi
if [ -n "$configured" ]; then
  echo "$configured" | sed 's/^/  configured: /'
else
  echo "  nothing set in sshd_config: OpenSSH defaults to AllowTcpForwarding yes"
fi
echo "  NOTE: the definitive test is an actual reverse tunnel, run from the Mac:"
echo "    ssh -R 127.0.0.1:8799:127.0.0.1:8799 <host> 'curl -s -m5 http://127.0.0.1:8799/'"
echo

echo "--- 3. claude ---"
if command -v claude >/dev/null 2>&1; then
  echo "version: $(claude --version 2>&1 | head -1)"
  echo "which:   $(command -v claude)"
  echo "live sessions (claude agents --json):"
  claude agents --json 2>&1 | head -30 | sed 's/^/  /'
else
  echo "claude:  NOT ON PATH for a non-interactive shell."
  echo "         This matters: the viewer runs commands over ssh without a login shell."
  for c in "$HOME/.local/bin/claude" "$HOME/.claude/local/claude" /usr/local/bin/claude; do
    [ -x "$c" ] && echo "         found at: $c"
  done
fi
echo

echo "--- 4. transcripts (the session index reads these) ---"
proj="$HOME/.claude/projects"
if [ -d "$proj" ]; then
  echo "folders:     $(find "$proj" -maxdepth 1 -mindepth 1 -type d | wc -l)"
  # Sessions and subagent transcripts must be counted separately: a session is
  # projects/<slug>/<uuid>.jsonl, while subagents live one level deeper under
  # <uuid>/subagents/agent-*.jsonl. Counting them together overstated sessions
  # by 7x on this box (365 files, but only 48 sessions).
  echo "sessions:    $(find "$proj" -mindepth 2 -maxdepth 2 -name '*.jsonl' | wc -l)"
  echo "subagents:   $(find "$proj" -path '*/subagents/*.jsonl' | wc -l)"
  echo "most recent:"
  find "$proj" -name '*.jsonl' -printf '%T@ %p\n' 2>/dev/null | sort -rn | head -3 | cut -d' ' -f2- | sed 's/^/  /'
else
  echo "no $proj yet"
fi
echo

echo "--- 5. active settings profile (read-only fingerprint, no secrets printed) ---"
s="$HOME/.claude/settings.json"
if [ -f "$s" ]; then
  echo "size:        $(wc -c < "$s") bytes, modified $(date -r "$s" -u +%Y-%m-%dT%H:%M:%SZ 2>/dev/null)"
  grep -q CLAUDE_CODE_USE_VERTEX "$s" && echo "backend:     Vertex" || echo "backend:     direct"
  echo "defaultMode: $(grep -o '"defaultMode"[^,}]*' "$s" | head -1)"
  echo "hook events: $(grep -oE '"(SessionStart|SessionEnd|Stop|StopFailure|PreToolUse|PostToolUse|PermissionRequest|PermissionDenied|Notification|UserPromptSubmit)"' "$s" | sort -u | tr '\n' ' ')"
else
  echo "no $s"
fi
[ -f /etc/claude-code/managed-settings.json ] && echo "MANAGED SETTINGS PRESENT: /etc/claude-code/managed-settings.json" \
  || echo "managed settings: none at /etc/claude-code/managed-settings.json"
echo

echo "--- 6. repos and vault ---"
[ -d "$HOME/repos" ] && echo "~/repos:  $(find "$HOME/repos" -maxdepth 1 -mindepth 1 -type d | wc -l) checkouts" || echo "~/repos:  missing"
if [ -d "$HOME/vault" ]; then
  echo "~/vault:  present"
  git -C "$HOME/vault" status --porcelain 2>/dev/null | awk '{print $1}' | sort | uniq -c | sed 's/^/  /'
  echo "  branch: $(git -C "$HOME/vault" rev-parse --abbrev-ref HEAD 2>/dev/null)"
else
  echo "~/vault:  missing"
fi
echo
echo "=== end of probe ==="
