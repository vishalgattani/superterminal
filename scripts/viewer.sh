#!/usr/bin/env bash
# Run the viewer: build the UI, serve it, print the URL with its token.
#
#     scripts/viewer.sh              # foreground; Ctrl-C stops it
#     scripts/viewer.sh -b           # background, logs to .state/viewer.log
#     scripts/viewer.sh --restart    # replace a viewer that is already running
#
# For editing the code, use scripts/dev.sh instead: this one serves a built
# bundle and will not pick up changes.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."

BACKGROUND=0
RESTART=0
for arg in "$@"; do
  case "$arg" in
    -b|--background) BACKGROUND=1 ;;
    --restart) RESTART=1 ;;
    -h|--help) sed -n '2,10p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "unknown option: $arg" >&2; exit 2 ;;
  esac
done

PORT="$(sed -n 's/^CV_PORT=\([0-9]*\).*/\1/p' config.env 2>/dev/null | tail -1)"
PORT="${PORT:-8788}"

# A viewer already on the port owns live ptys. Killing it drops every local
# terminal it holds; remote ones survive in tmux and come back on re-adoption.
# So say what is there and make replacing it deliberate.
if lsof -nP -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1; then
  PID="$(lsof -nP -tiTCP:"$PORT" -sTCP:LISTEN | head -1)"
  KIDS="$(pgrep -P "$PID" 2>/dev/null | wc -l | tr -d ' ')"
  if [ "$RESTART" -eq 0 ]; then
    echo "a viewer is already running on :$PORT (pid $PID, $KIDS child process(es))"
    echo "  open it:    http://127.0.0.1:$PORT/?token=\$CV_TOKEN"
    echo "  replace it: scripts/viewer.sh --restart"
    exit 0
  fi
  echo "stopping viewer on :$PORT (pid $PID, $KIDS child process(es))"
  kill "$PID" 2>/dev/null || true
  for _ in $(seq 20); do
    lsof -nP -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1 || break
    sleep 0.25
  done
fi

# apps/web/dist is gitignored, so a stale bundle is invisible: the server
# happily serves last week's UI and nothing says so. Always rebuild.
echo "building the UI..."
npm run build --silent

mkdir -p .state
if [ "$BACKGROUND" -eq 1 ]; then
  LOG=.state/viewer.log
  : > "$LOG"
  nohup npm start >"$LOG" 2>&1 &
  echo "started in the background, logging to $LOG"
  # The token is minted at boot and only appears in the log, so wait for it
  # rather than telling the reader to go and find it.
  for _ in $(seq 60); do
    if grep -q 'token=' "$LOG" 2>/dev/null; then
      grep -m1 -o 'http://[^ ]*' "$LOG"
      exit 0
    fi
    sleep 0.25
  done
  echo "server did not print a URL within 15s; check $LOG" >&2
  exit 1
fi

exec npm start
