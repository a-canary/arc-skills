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
import os
import sys
from datetime import datetime, timezone
from pathlib import Path

STATE_DIR = Path.home() / ".claude" / "dream" / "state"
PROCESSED_FILE = STATE_DIR / "processed.json"
PROJECTS_DIR = Path.home() / ".claude" / "projects"

# Only consider sessions whose *latest event* falls within this window. The
# session store (~/.claude/projects) is never pruned and a retired-infra file
# can have its mtime bumped by a copy/restore long after its last real event,
# so file mtime is not a trustworthy age signal -- the newest in-file event
# timestamp is. A multi-day session still qualifies as long as it saw activity
# inside the window. 0 disables the gate (back to mtime-only behaviour).
DREAM_WINDOW_HOURS = float(os.environ.get("DREAM_WINDOW_HOURS", "24"))


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


def _parse_ts(raw: str) -> datetime | None:
    """Parse an ISO-8601 event timestamp (handles the trailing 'Z')."""
    if not raw:
        return None
    try:
        return datetime.fromisoformat(raw.replace("Z", "+00:00"))
    except (ValueError, TypeError):
        return None


def latest_event_ts(jsonl: Path) -> datetime | None:
    """Newest event timestamp inside the session, or None if none found.

    Scans the whole file (sessions are small -- tens of events) and keeps the
    max timestamp, so it is correct regardless of event ordering and for
    multi-day sessions whose recent tail is what matters.
    """
    newest = None
    try:
        with open(jsonl, "r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line or '"timestamp"' not in line:
                    continue
                try:
                    ts = _parse_ts(json.loads(line).get("timestamp", ""))
                except json.JSONDecodeError:
                    continue
                if ts and (newest is None or ts > newest):
                    newest = ts
    except OSError:
        return None
    return newest


def within_window(jsonl: Path, now: datetime) -> bool:
    """True if the session's latest event is inside DREAM_WINDOW_HOURS.

    A file with no parseable event timestamp is skipped (fail-closed): every
    real session carries one (verified across the store), and the only
    timestamp-less files are `type: ai-title` sidecar stubs -- title metadata,
    not conversations the collector should page. Set DREAM_GATE_FAILOPEN=1 to
    keep timestamp-less files instead, as a safety hatch if the event format
    ever changes.
    """
    if DREAM_WINDOW_HOURS <= 0:
        return True
    newest = latest_event_ts(jsonl)
    if newest is None:
        return os.environ.get("DREAM_GATE_FAILOPEN") == "1"
    age_hours = (now - newest).total_seconds() / 3600.0
    return age_hours <= DREAM_WINDOW_HOURS


def sessions_to_process(processed: dict, force: bool = False, limit: int = 0) -> list[Path]:
    """JSONL paths that are new/changed since last run AND saw a recent event.

    The age gate (latest in-file event within DREAM_WINDOW_HOURS) is the
    authoritative recency signal; mtime vs processed.json is only change
    detection. Returned oldest-mtime first so the backlog drains in age order;
    capped to `limit` when limit > 0.
    """
    out = []
    if not PROJECTS_DIR.is_dir():
        return out
    now = datetime.now(timezone.utc)
    for project_dir in PROJECTS_DIR.iterdir():
        if not project_dir.is_dir():
            continue
        for jsonl in project_dir.glob("*.jsonl"):
            if not force:
                entry = processed["sessions"].get(session_key(jsonl))
                if entry and entry.get("source_mtime") == jsonl.stat().st_mtime:
                    continue
            if not within_window(jsonl, now):
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
