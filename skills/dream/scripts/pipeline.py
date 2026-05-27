#!/usr/bin/env python3
"""
Dream incremental session tracker.

The dream skill drives collection itself (spawning collector agents that page
sessions with page.py). This script only answers two questions for it:

    --list            print session JSONL paths that are new or changed since
                      the last run (mtime-checked against processed.json),
                      oldest-mtime first. Use --limit N to cap how many a
                      single run drains (so a cold start can't fan out to
                      thousands of agents at once).
    --done SESSION    mark a session processed (record its current mtime).

State lives in ~/.claude/dream/state/processed.json:

    {"sessions": {"<project>/<session>": {"processed": "<iso>", "source_mtime": <float>}}}

Usage:
    pipeline.py --list [--force]
    pipeline.py --done /path/to/session.jsonl
"""

import argparse
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

STATE_DIR = Path.home() / ".claude" / "dream" / "state"
PROCESSED_FILE = STATE_DIR / "processed.json"
PROJECTS_DIR = Path.home() / ".claude" / "projects"


def load_processed() -> dict:
    if PROCESSED_FILE.exists():
        try:
            with open(PROCESSED_FILE) as f:
                return json.load(f)
        except (json.JSONDecodeError, IOError):
            pass
    return {"sessions": {}}


def save_processed(data: dict) -> None:
    STATE_DIR.mkdir(parents=True, exist_ok=True)
    with open(PROCESSED_FILE, "w") as f:
        json.dump(data, f, indent=2)


def session_key(jsonl: Path) -> str:
    return f"{jsonl.parent.name}/{jsonl.stem}"


def sessions_to_process(processed: dict, force: bool = False, limit: int = 0) -> list[Path]:
    """JSONL paths that are new or whose mtime changed since last run.

    Returned oldest-mtime first so the backlog drains in age order; capped to
    `limit` when limit > 0.
    """
    out = []
    if not PROJECTS_DIR.is_dir():
        return out
    for project_dir in PROJECTS_DIR.iterdir():
        if not project_dir.is_dir():
            continue
        for jsonl in project_dir.glob("*.jsonl"):
            if not force:
                entry = processed["sessions"].get(session_key(jsonl))
                if entry and entry.get("source_mtime") == jsonl.stat().st_mtime:
                    continue
            out.append(jsonl)
    out.sort(key=lambda p: p.stat().st_mtime)
    if limit > 0:
        out = out[:limit]
    return out


def cmd_list(force: bool, limit: int = 0) -> None:
    processed = load_processed()
    for jsonl in sessions_to_process(processed, force=force, limit=limit):
        print(jsonl)


def cmd_done(session_arg: str) -> None:
    jsonl = Path(session_arg).expanduser()
    if not jsonl.exists():
        print(f"Error: session not found: {jsonl}", file=sys.stderr)
        sys.exit(1)
    processed = load_processed()
    processed["sessions"][session_key(jsonl)] = {
        "processed": datetime.now(timezone.utc).isoformat(),
        "source_mtime": jsonl.stat().st_mtime,
    }
    save_processed(processed)


def main():
    parser = argparse.ArgumentParser(description="Dream incremental session tracker")
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--list", action="store_true", help="Print new/changed session JSONL paths")
    group.add_argument("--done", metavar="SESSION", help="Mark a session JSONL processed")
    parser.add_argument("--force", action="store_true", help="With --list, ignore mtime and list all sessions")
    parser.add_argument("--limit", type=int, default=0, help="With --list, cap to N oldest sessions (0 = no cap)")
    args = parser.parse_args()

    if args.list:
        cmd_list(args.force, args.limit)
    else:
        cmd_done(args.done)


if __name__ == "__main__":
    main()
