#!/usr/bin/env bash
# Hot reload: the server under `node --watch`, and Vite serving the UI.
#
#     scripts/dev.sh
#
# Open the Vite URL it prints (port 5173), not the server's own port — Vite
# serves the UI and proxies /api and /ws to the server, so you get instant
# reloads on UI edits and a server restart on server edits.
#
# Ctrl-C stops both.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."

PORT="$(sed -n 's/^CV_PORT=\([0-9]*\).*/\1/p' config.env 2>/dev/null | tail -1)"
PORT="${PORT:-8788}"
WEB_PORT=5173

# `node --watch` restarts on every server edit, and the server mints a fresh
# token each boot. Without a pinned CV_TOKEN the tab you have open starts
# 401ing the moment you save a file, which reads like a bug in whatever you
# were editing. This is in docs/TRAPS.md; refuse rather than reproduce it.
TOKEN="$(sed -n 's/^CV_TOKEN=\(.*\)/\1/p' config.env 2>/dev/null | tail -1 | tr -d '"'"'"'')"
if [ -z "$TOKEN" ]; then
  cat >&2 <<'MSG'
CV_TOKEN is not pinned in config.env.

Under --watch the server regenerates its token on every edit, so the open tab
starts refusing requests as soon as you save. Pin one first:

    echo "CV_TOKEN=$(node -e 'console.log(require("crypto").randomBytes(24).toString("base64url"))')" >> config.env

MSG
  exit 1
fi

# Vite's origin must be allowed explicitly: a WebSocket upgrade is not subject
# to CORS, so the server checks Origin itself and 5173 is not its own port.
if ! grep -q "^CV_DEV_PORTS=" config.env 2>/dev/null; then
  echo "note: CV_DEV_PORTS is unset; defaulting to $WEB_PORT (set it in config.env to change)"
fi

if lsof -nP -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1; then
  echo "something is already listening on :$PORT — stop it first (scripts/viewer.sh --restart)" >&2
  exit 1
fi

PIDS=()

# `npm run x &` gives the pid of npm, not of the node it spawns. Killing npm
# alone leaves the server and Vite running, holding their ports, so the next
# run refuses to start and it looks like the script did nothing. Walk the tree.
kill_tree() {
  local pid=$1 child
  for child in $(pgrep -P "$pid" 2>/dev/null); do kill_tree "$child"; done
  kill "$pid" 2>/dev/null || true
}

cleanup() {
  trap - INT TERM EXIT
  for p in "${PIDS[@]:-}"; do
    [ -n "$p" ] && kill_tree "$p"
  done
  wait 2>/dev/null || true
}
# Both halves die together: a Vite left running against a dead server serves a
# UI that cannot reach anything, which looks like the app is broken.
trap cleanup INT TERM EXIT

echo "starting the server on :$PORT (node --watch)..."
# dev:server, not dev — `npm run dev` is this script, and calling it here
# would fork-bomb the machine rather than start anything.
npm run dev:server --silent &
PIDS+=($!)

echo "starting Vite on :$WEB_PORT..."
npm run dev:web --silent &
PIDS+=($!)

sleep 2
cat <<MSG

  open:  http://127.0.0.1:$WEB_PORT/?token=$TOKEN
         add &debug=1 for a footer with keystroke echo and paint times

  Ctrl-C stops both.

MSG
wait
