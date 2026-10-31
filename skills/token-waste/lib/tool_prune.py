#!/usr/bin/env python3
"""
Propose-only tool pruning: which loaded MCP servers were never called.

Claude Code defers most tools: the model gets one name line per deferred tool on
every turn (`deferred_tools_delta.addedLines`) and the full schema only once a
tool is surfaced. Those name lines are the per-turn tool-set cost this measures.
A server none of whose tools were called across >= --min-sessions top-level
sessions is proposed as a `permissions.deny` entry (`mcp__<server>` matches every
tool of it). Subagent transcripts (`.../subagents/*.jsonl`) contribute calls but
do not count toward the floor: one session with 4 subagents is still one session.

Propose-only: prints JSON, never writes settings. Partly-used servers are
reported, not proposed (denying a used tool breaks a workflow). After a human
applies a deny, check it on sessions STARTED AFTER the deny only (older sessions
still list the server): the server's names must be absent from `loaded` there,
or the deny did not shrink the wire and should be reverted.

Usage:
    python tool_prune.py SESSIONS.txt [--min-sessions 5] [-o OUT.json]
    (SESSIONS.txt: one session .jsonl path per line)
"""
import argparse
import json
import sys
from collections import defaultdict


def server_of(name: str) -> str:
    # mcp__claude_ai_Gmail__search_threads -> mcp__claude_ai_Gmail; builtins stay unproposed
    parts = name.split("__")
    return "__".join(parts[:2]) if name.startswith("mcp__") and len(parts) >= 3 else ""


def scan(path: str):
    """Names on the wire at session end (name -> line bytes) and every tool called."""
    loaded, called = {}, set()
    with open(path, errors="ignore") as f:
        for line in f:
            try:
                r = json.loads(line)
            except ValueError:
                continue
            a = r.get("attachment") or {}
            if a.get("type") == "deferred_tools_delta":
                for n in a.get("removedNames", []):
                    loaded.pop(n, None)
                for n, l in zip(a.get("addedNames", []), a.get("addedLines", [])):
                    loaded[n] = len(l)
            if r.get("type") == "assistant":
                for c in (r.get("message") or {}).get("content") or []:
                    if isinstance(c, dict) and c.get("type") == "tool_use":
                        called.add(c.get("name"))
    return loaded, called


def propose(paths, min_sessions: int) -> dict:
    sessions, line_bytes, called = 0, {}, set()
    for p in paths:
        loaded, c = scan(p)
        called |= c  # before any skip: a no-deferral session's calls still save its servers
        if not loaded:  # pre-deferral or non-Claude-Code transcript: nothing loaded to measure
            continue
        line_bytes.update(loaded)
        sessions += "/subagents/" not in p
    out = {"sessions": sessions, "loaded": len(line_bytes),
           "called": len(set(line_bytes) & called), "proposals": [], "partly_used": []}
    if sessions < min_sessions:
        out["skipped"] = f"{sessions} top-level sessions < --min-sessions {min_sessions}"
        return out
    by_server = defaultdict(list)
    for n in line_bytes:
        if server_of(n):
            by_server[server_of(n)].append(n)
    for srv, names in sorted(by_server.items()):
        used = [n for n in names if n in called]
        row = {"server": srv, "tools": len(names), "used": len(used),
               "bytes_per_turn": sum(line_bytes[n] for n in names if n not in called)}
        if not used:
            out["proposals"].append({**row, "deny": srv})
        else:
            out["partly_used"].append(row)
    for k in ("proposals", "partly_used"):
        out[k].sort(key=lambda r: -r["bytes_per_turn"])
    out["proposed_bytes_per_turn"] = sum(r["bytes_per_turn"] for r in out["proposals"])
    return out


def main():
    ap = argparse.ArgumentParser(description="Propose permissions.deny for never-called MCP servers")
    ap.add_argument("sessions", help="file listing session .jsonl paths, one per line")
    ap.add_argument("--min-sessions", type=int, default=5)
    ap.add_argument("-o", "--output", help="output JSON path (default stdout)")
    args = ap.parse_args()
    with open(args.sessions) as f:
        paths = [l.strip() for l in f if l.strip()]
    text = json.dumps(propose(paths, args.min_sessions), indent=2)
    if args.output:
        with open(args.output, "w") as f:
            f.write(text + "\n")
    else:
        sys.stdout.write(text + "\n")


if __name__ == "__main__":
    main()
