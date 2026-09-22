#!/usr/bin/env python3
"""Summarise Claude Code transcripts as JSON.

Runs identically on this Mac and on the fire box (piped in over ssh), so the
scanning rules live in one place rather than being written twice.

Layout, confirmed on both machines:
    ~/.claude/projects/<slug>/<session-uuid>.jsonl          a session
    ~/.claude/projects/<slug>/<session-uuid>/subagents/*.jsonl   its subagents

Counting every *.jsonl as a session overstates badly: fire has 365 files but
only 48 sessions. Subagents are therefore counted against their parent, never
listed as sessions of their own.

Only the first and last few lines of each transcript are parsed. Reading 365
files in full to build a list nobody has clicked on yet would be wasteful, and
the useful metadata (cwd, branch, opening prompt) is at the top.
"""
import json
import os
import sys

HOME = os.path.expanduser("~")
ROOT = os.path.join(HOME, ".claude", "projects")
TAIL_BYTES = 64 * 1024


def first_lines(path, count=40):
    out = []
    try:
        with open(path, "r", encoding="utf-8", errors="replace") as fh:
            for line in fh:
                out.append(line)
                if len(out) >= count:
                    break
    except OSError:
        pass
    return out


def last_lines(path, size):
    """Read only the tail, so a 40MB transcript is not loaded to find its end."""
    try:
        with open(path, "rb") as fh:
            if size > TAIL_BYTES:
                fh.seek(-TAIL_BYTES, os.SEEK_END)
            blob = fh.read().decode("utf-8", errors="replace")
        return blob.splitlines()[1:] if size > TAIL_BYTES else blob.splitlines()
    except OSError:
        return []


def text_of(message):
    """Claude's content is either a string or a list of typed blocks."""
    content = message.get("content")
    if isinstance(content, str):
        return content.strip()
    if isinstance(content, list):
        for block in content:
            if isinstance(block, dict) and block.get("type") == "text":
                return (block.get("text") or "").strip()
    return ""


def summarise(path, session_id, slug):
    try:
        st = os.stat(path)
    except OSError:
        return None

    cwd = None
    branch = None
    title = None
    version = None
    first_prompt = None

    for raw in first_lines(path):
        try:
            rec = json.loads(raw)
        except (ValueError, TypeError):
            continue
        cwd = cwd or rec.get("cwd")
        branch = branch or rec.get("gitBranch")
        version = version or rec.get("version")
        if rec.get("type") == "custom-title":
            title = rec.get("customTitle") or title
        if first_prompt is None and rec.get("type") == "user":
            body = text_of(rec.get("message") or {})
            # Skip command wrappers and tool results: not what a human typed.
            if body and not body.startswith("<"):
                first_prompt = body[:300]

    last_ts = None
    turns = 0
    for raw in last_lines(path, st.st_size):
        try:
            rec = json.loads(raw)
        except (ValueError, TypeError):
            continue
        if rec.get("timestamp"):
            last_ts = rec["timestamp"]
        if rec.get("type") == "custom-title":
            title = rec.get("customTitle") or title
        if rec.get("type") == "user":
            turns += 1

    subagents = 0
    sub_dir = os.path.join(os.path.dirname(path), session_id, "subagents")
    if os.path.isdir(sub_dir):
        try:
            subagents = len([f for f in os.listdir(sub_dir) if f.endswith(".jsonl")])
        except OSError:
            pass

    return {
        "sessionId": session_id,
        "path": path,
        "slug": slug,
        "cwd": cwd,
        "gitBranch": branch,
        "title": title,
        "version": version,
        "firstPrompt": first_prompt,
        "lastModified": int(st.st_mtime * 1000),
        "lastTimestamp": last_ts,
        "bytes": st.st_size,
        # Only the tail was read, so this is a floor, not an exact count.
        "recentUserTurns": turns,
        "subagents": subagents,
    }


def main():
    limit = int(sys.argv[1]) if len(sys.argv) > 1 else 500
    sessions = []
    if os.path.isdir(ROOT):
        for slug in os.listdir(ROOT):
            sdir = os.path.join(ROOT, slug)
            if not os.path.isdir(sdir):
                continue
            for name in os.listdir(sdir):
                if not name.endswith(".jsonl"):
                    continue
                path = os.path.join(sdir, name)
                if not os.path.isfile(path):
                    continue
                row = summarise(path, name[:-6], slug)
                if row:
                    sessions.append(row)

    sessions.sort(key=lambda r: r["lastModified"], reverse=True)
    json.dump(
        {"sessions": sessions[:limit], "total": len(sessions), "home": HOME},
        sys.stdout,
    )


if __name__ == "__main__":
    main()
