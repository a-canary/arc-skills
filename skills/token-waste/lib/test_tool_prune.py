#!/usr/bin/env python3
"""Self-check for tool_prune.py: only fully-unused MCP servers are proposed, under a session floor.

Run: python3 skills/token-waste/lib/test_tool_prune.py
"""
import json
import os
import sys
import tempfile

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from tool_prune import propose, server_of  # noqa: E402

NAMES = ["Read", "mcp__gmail__search", "mcp__gmail__send", "mcp__pw__click", "mcp__pw__snap"]


def session(called):
    fd, path = tempfile.mkstemp(suffix=".jsonl")
    with os.fdopen(fd, "w") as f:
        f.write(json.dumps({"type": "attachment", "attachment": {
            "type": "deferred_tools_delta", "addedNames": NAMES, "addedLines": [n + "\n" for n in NAMES]}}) + "\n")
        f.write(json.dumps({"type": "assistant", "message": {"content": [
            {"type": "tool_use", "name": n} for n in called]}}) + "\n")
    return path


def test_server_of():
    assert server_of("mcp__claude_ai_Gmail__search_threads") == "mcp__claude_ai_Gmail"
    assert server_of("Read") == "" and server_of("mcp__odd") == ""


def test_only_fully_unused_servers_are_proposed():
    out = propose([session(["mcp__pw__click", "Read"]) for _ in range(5)], 5)
    assert [p["deny"] for p in out["proposals"]] == ["mcp__gmail"], out
    assert out["proposals"][0]["bytes_per_turn"] == len("mcp__gmail__search\n") + len("mcp__gmail__send\n")
    assert [r["server"] for r in out["partly_used"]] == ["mcp__pw"]  # a used tool keeps its server
    assert out["called"] == 2 and out["loaded"] == 5


def test_a_call_in_any_session_saves_the_server():
    paths = [session([]) for _ in range(4)] + [session(["mcp__gmail__send"])]
    assert "mcp__gmail" not in [p["deny"] for p in propose(paths, 5)["proposals"]]


def test_below_session_floor_proposes_nothing():
    out = propose([session([]) for _ in range(4)], 5)
    assert out["proposals"] == [] and "skipped" in out


def test_sessions_without_deferred_tools_do_not_count():
    fd, bare = tempfile.mkstemp(suffix=".jsonl")
    os.close(fd)
    out = propose([bare] + [session([]) for _ in range(4)], 5)
    assert out["sessions"] == 4 and "skipped" in out


if __name__ == "__main__":
    tests = [v for k, v in sorted(globals().items()) if k.startswith("test_")]
    for t in tests:
        t()
    print(f"ok {len(tests)} tests")
