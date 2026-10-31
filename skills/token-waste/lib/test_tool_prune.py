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
TMP = tempfile.TemporaryDirectory()
_n = 0


def session(called, names=NAMES, removed=(), sub=False):
    global _n
    _n += 1
    d = os.path.join(TMP.name, f"s{_n}", "subagents") if sub else TMP.name
    os.makedirs(d, exist_ok=True)
    path = os.path.join(d, f"{_n}.jsonl")
    with open(path, "w") as f:
        if names:
            f.write(json.dumps({"type": "attachment", "attachment": {
                "type": "deferred_tools_delta", "addedNames": list(names),
                "addedLines": [n + "\n" for n in names]}}) + "\n")
        if removed:
            f.write(json.dumps({"type": "attachment", "attachment": {
                "type": "deferred_tools_delta", "addedNames": [], "addedLines": [],
                "removedNames": list(removed)}}) + "\n")
        f.write(json.dumps({"type": "assistant", "message": {"content": [
            {"type": "tool_use", "name": n} for n in called]}}) + "\n")
    return path


def denies(out):
    return [p["deny"] for p in out["proposals"]]


def test_server_of():
    assert server_of("mcp__claude_ai_Gmail__search_threads") == "mcp__claude_ai_Gmail"
    assert server_of("mcp__plugin_playwright_playwright__browser_click") == "mcp__plugin_playwright_playwright"
    assert server_of("Read") == "" and server_of("mcp__odd") == ""


def test_only_fully_unused_servers_are_proposed():
    out = propose([session(["mcp__pw__click", "Read"]) for _ in range(5)], 5)
    assert denies(out) == ["mcp__gmail"], out
    assert out["proposals"][0]["bytes_per_turn"] == len("mcp__gmail__search\n") + len("mcp__gmail__send\n")
    assert [r["server"] for r in out["partly_used"]] == ["mcp__pw"]  # a used tool keeps its server
    assert out["partly_used"][0]["bytes_per_turn"] == len("mcp__pw__snap\n")  # only the uncalled tool
    assert out["called"] == 2 and out["loaded"] == 5


def test_a_call_in_any_session_saves_the_server():
    paths = [session([]) for _ in range(4)] + [session(["mcp__gmail__send"])]
    assert "mcp__gmail" not in denies(propose(paths, 5))


def test_below_session_floor_proposes_nothing():
    out = propose([session([]) for _ in range(4)], 5)
    assert out["proposals"] == [] and "skipped" in out


def test_subagents_add_calls_but_not_sessions():
    paths = [session([])] + [session([], sub=True) for _ in range(4)]
    assert "skipped" in propose(paths, 5)  # 1 top-level session, not 5
    paths = [session([]) for _ in range(5)] + [session(["mcp__gmail__send"], sub=True)]
    assert "mcp__gmail" not in denies(propose(paths, 5))  # a subagent's call saves the server


def test_calls_in_a_no_deferral_session_still_count():
    paths = [session([]) for _ in range(5)] + [session(["mcp__gmail__send"], names=[])]
    assert "mcp__gmail" not in denies(propose(paths, 5))


def test_removed_names_drop_off_the_wire():
    out = propose([session([], removed=["mcp__gmail__search", "mcp__gmail__send"]) for _ in range(5)], 5)
    assert "mcp__gmail" not in denies(out) and out["loaded"] == 3


def test_floor_is_per_server():
    pw = ["Read", "mcp__pw__click", "mcp__pw__snap"]
    gmail = [f"mcp__gmail__t{i}" for i in range(6)]  # 6 tools in 1 session is still 1 session
    out = propose([session([], names=pw) for _ in range(4)] + [session([], names=NAMES + gmail)], 5)
    assert denies(out) == ["mcp__pw"], out  # gmail loaded in 1 of 5 sessions: below the floor
    assert out["loaded_servers"] == ["mcp__gmail", "mcp__pw"]


def test_a_call_to_a_never_deferred_tool_saves_its_server():
    paths = [session([]) for _ in range(4)] + [session(["mcp__gmail__draft"])]  # draft fully loaded
    assert "mcp__gmail" not in denies(propose(paths, 5))


def test_malformed_records_are_skipped():
    path = session([])
    with open(path, "a") as f:
        f.write("[1, 2]\n" + json.dumps({"type": "attachment", "attachment": "x"}) + "\n")
        f.write(json.dumps({"type": "assistant", "message": {"content": [{"type": "tool_use"}]}}) + "\n")
        f.write(json.dumps({"type": "assistant", "message": "hi"}) + "\n")
        f.write(json.dumps({"type": "attachment", "attachment": {
            "type": "deferred_tools_delta", "addedNames": None, "removedNames": None}}) + "\n")
    out = propose([path] + [session([]) for _ in range(4)], 5, [os.path.join(TMP.name, "gone.jsonl")])
    assert denies(out) == ["mcp__gmail", "mcp__pw"]


def test_the_longer_call_window_saves_a_server():
    paths = [session([]) for _ in range(5)]
    assert "mcp__gmail" in denies(propose(paths, 5))
    assert "mcp__gmail" not in denies(propose(paths, 5, [session(["mcp__gmail__send"], names=[])]))


if __name__ == "__main__":
    tests = [v for k, v in sorted(globals().items()) if k.startswith("test_")]
    for t in tests:
        t()
    TMP.cleanup()
    print(f"ok {len(tests)} tests")
