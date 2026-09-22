#!/usr/bin/env python3
"""List live Claude sessions, tagged with the tmux session each belongs to.

`claude agents --json` reports pid and cwd but not which terminal a session is
running in. Matching on cwd alone is wrong as soon as two terminals sit in the
same folder: two sessions in ~/vault both matched the same Claude, so both
nodes showed one session's id and cost.

The pid is unambiguous, so this walks each Claude pid up its parent chain until
it reaches a tmux pane, giving the tmux session name. The viewer names its tmux
sessions cv-<first 8 of terminal id>, so that name is the join key.

Usage: claude-agents.py <path-to-claude>
"""
import json
import os
import subprocess
import sys


def parent_of(pid):
    """Parent pid, from /proc on Linux or ps elsewhere."""
    try:
        with open(f"/proc/{pid}/stat", "rb") as fh:
            data = fh.read().decode("utf-8", "replace")
        # comm can contain spaces and brackets, so split after the closing one.
        return int(data[data.rindex(")") + 2 :].split()[1])
    except (OSError, ValueError, IndexError):
        pass
    try:
        out = subprocess.run(
            ["ps", "-o", "ppid=", "-p", str(pid)],
            capture_output=True, text=True, timeout=5,
        ).stdout.strip()
        return int(out) if out else None
    except (OSError, ValueError, subprocess.SubprocessError):
        return None


def pane_pids():
    """tmux pane pid -> session name."""
    try:
        out = subprocess.run(
            ["tmux", "list-panes", "-a", "-F", "#{pane_pid} #{session_name}"],
            capture_output=True, text=True, timeout=8,
        )
        if out.returncode != 0:
            return {}
        mapping = {}
        for line in out.stdout.splitlines():
            parts = line.split(None, 1)
            if len(parts) == 2 and parts[0].isdigit():
                mapping[int(parts[0])] = parts[1].strip()
        return mapping
    except (OSError, subprocess.SubprocessError):
        return {}


def tmux_session_for(pid, panes, limit=25):
    """Walk up from pid until a pid is a tmux pane's shell."""
    seen = 0
    current = pid
    while current and current > 1 and seen < limit:
        if current in panes:
            return panes[current]
        current = parent_of(current)
        seen += 1
    return None


def main():
    claude = sys.argv[1] if len(sys.argv) > 1 else "claude"
    try:
        raw = subprocess.run(
            [claude, "agents", "--json"],
            capture_output=True, text=True, timeout=20,
        )
        agents = json.loads(raw.stdout or "[]")
    except (OSError, ValueError, subprocess.SubprocessError) as exc:
        json.dump({"agents": [], "error": str(exc)}, sys.stdout)
        return

    panes = pane_pids()
    for a in agents:
        pid = a.get("pid")
        a["tmuxSession"] = tmux_session_for(pid, panes) if pid else None

    json.dump({"agents": agents}, sys.stdout)


if __name__ == "__main__":
    main()
