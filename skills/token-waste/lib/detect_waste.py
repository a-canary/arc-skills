#!/usr/bin/env python3
"""
Detect token-waste candidates in a Claude conversation JSONL.

This is the deterministic pre-pass for the token-waste skill (mirrors dream's
extract.py, but the target is context pollution rather than agent effectiveness).

It correlates each tool_use with its tool_result (by tool_use_id), measures how
many tokens each tool dumped into context, and flags patterns where a cheaper
tool/usage would have loaded far less:

  - full_file_read    Read of a whole large file when a Grep + targeted read would do
  - reread            same file Read 2+ times (content already in context)
  - bash_dump         Bash whose stdout is large AND not redirected to a file
  - no_grep_first     large Read with no Grep of that path earlier in the session
  - unreferenced      large tool_result whose distinctive tokens never reappear
                      in any later assistant message (loaded, never used)

Output is JSON: a list of candidate events the LLM analyst then scores. The LLM
never sees the raw transcript — only this shortlist — so the tool that hunts
token waste does not itself waste tokens.

Usage:
    python detect_waste.py SESSION.jsonl --project NAME [--chars-per-token 4]
    # prints a JSON object to stdout
"""

import argparse
import json
import re
import sys
from collections import defaultdict
from pathlib import Path

# A tool_result above this many estimated tokens is "large" — worth scrutinising.
LARGE_RESULT_TOKENS = 1500
# A Read result above this is a candidate full-file-read even on its own.
BIG_READ_TOKENS = 2000
# Min distinctive tokens to sample when checking if a result was ever referenced.
REF_SAMPLE = 12
# Jaccard overlap (on shingled content) above which two large results count as
# substantially the same content loaded twice → a `repeated` candidate.
REPEAT_OVERLAP = 0.6
# Excerpt size (chars from head + tail) handed to the analyst so it can judge a
# result's *content quality* (obvious / confusing) without ever loading the raw
# transcript. The LLM sees only these bounded snippets, never the full result.
EXCERPT_HEAD = 700
EXCERPT_TAIL = 400
# A large result is shortlisted for content-quality review (obvious/confusing).
QUALITY_REVIEW_TOKENS = 1500
# Cap on low_value_content review requests per session. These carry excerpts and
# go to the LLM, so we only send the biggest few — reviewing the largest results
# first is where the token-quality payoff is. Keeps the analyst's bill bounded.
MAX_QUALITY_REVIEW = 12


def est_tokens(text: str, chars_per_token: float) -> int:
    if not text:
        return 0
    return int(len(text) / chars_per_token)


def text_of(content) -> str:
    """Flatten a content field (string or block list) to plain text."""
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        out = []
        for b in content:
            if isinstance(b, dict):
                t = b.get("type", "")
                if t == "text":
                    out.append(b.get("text", ""))
                elif t == "tool_result":
                    out.append(text_of(b.get("content", "")))
                elif t == "thinking":
                    out.append(b.get("thinking", ""))
            elif isinstance(b, str):
                out.append(b)
        return "\n".join(out)
    return ""


def distinctive_tokens(text: str) -> list[str]:
    """Pull rare-ish identifier-like tokens to test for later reference."""
    toks = re.findall(r"[A-Za-z_][A-Za-z0-9_]{6,}", text)
    seen, uniq = set(), []
    for t in toks:
        if t not in seen:
            seen.add(t)
            uniq.append(t)
    # sample from the middle so we skip boilerplate headers
    mid = uniq[len(uniq) // 4 : len(uniq) // 4 + REF_SAMPLE]
    return mid or uniq[:REF_SAMPLE]


def excerpt(text: str) -> str:
    """Bounded head+tail snippet so the analyst can judge content quality without
    the orchestrator ever feeding it the full result. Mirrors the project rule:
    the tool that hunts waste must not itself waste tokens."""
    text = text.strip()
    if len(text) <= EXCERPT_HEAD + EXCERPT_TAIL:
        return text
    return text[:EXCERPT_HEAD] + "\n…[snipped]…\n" + text[-EXCERPT_TAIL:]


def shingles(text: str, k: int = 5) -> set:
    """k-word shingle set for cheap content-overlap (Jaccard) between results.
    Word-level so it survives reformatting; lower-cased to ignore cosmetic diffs."""
    words = re.findall(r"[A-Za-z0-9_]+", text.lower())
    if len(words) < k:
        return {" ".join(words)} if words else set()
    return {" ".join(words[i : i + k]) for i in range(len(words) - k + 1)}


def jaccard(a: set, b: set) -> float:
    if not a or not b:
        return 0.0
    inter = len(a & b)
    if not inter:
        return 0.0
    return inter / len(a | b)


def parse(filepath: Path, chars_per_token: float):
    """Walk the JSONL once, building ordered events + tool_use/result linkage."""
    tool_uses = {}          # tool_use_id -> {tool, input, index, line}
    results = {}            # tool_use_id -> {text, tokens, index}
    assistant_texts = []    # (index, text) for later-reference checks
    grep_paths = []         # (index, path) of Grep/Glob targets
    read_order = []         # (index, file_path) in order
    order_index = 0

    with open(filepath, "r", encoding="utf-8") as f:
        for line_num, raw in enumerate(f, start=1):
            raw = raw.strip()
            if not raw:
                continue
            try:
                msg = json.loads(raw)
            except json.JSONDecodeError:
                continue

            inner = msg.get("message") if isinstance(msg.get("message"), dict) else msg
            role = inner.get("role")
            content = inner.get("content")

            if role == "assistant" and isinstance(content, list):
                for b in content:
                    if not isinstance(b, dict):
                        continue
                    if b.get("type") == "tool_use":
                        tid = b.get("id", "")
                        name = b.get("name", "")
                        inp = b.get("input", {}) or {}
                        tool_uses[tid] = {
                            "tool": name, "input": inp,
                            "index": order_index, "line": line_num,
                        }
                        if name == "Read":
                            read_order.append((order_index, inp.get("file_path", "")))
                        elif name in ("Grep", "Glob"):
                            grep_paths.append((order_index, inp.get("path", "") or inp.get("pattern", "")))
                    elif b.get("type") == "text":
                        assistant_texts.append((order_index, b.get("text", "")))
                order_index += 1

            elif role == "user" and isinstance(content, list):
                for b in content:
                    if isinstance(b, dict) and b.get("type") == "tool_result":
                        tid = b.get("tool_use_id", "")
                        txt = text_of(b.get("content", ""))
                        results[tid] = {
                            "text": txt,
                            "tokens": est_tokens(txt, chars_per_token),
                            "index": order_index,
                        }
                order_index += 1

    return tool_uses, results, assistant_texts, grep_paths, read_order


def later_reference(sample: list[str], after_index: int, assistant_texts) -> bool:
    """Did any sampled token reappear in an assistant message after this result?"""
    if not sample:
        return True  # nothing distinctive to test → don't flag as unreferenced
    later = "\n".join(t for i, t in assistant_texts if i > after_index)
    return any(tok in later for tok in sample)


def detect(filepath: Path, project: str, chars_per_token: float) -> dict:
    tool_uses, results, assistant_texts, grep_paths, read_order = parse(filepath, chars_per_token)

    candidates = []
    read_counts = defaultdict(int)
    for _, fp in read_order:
        read_counts[fp] += 1
    # rank each Read occurrence of a path: 0 = first (legit), 1+ = re-read
    read_seen = defaultdict(int)
    read_rank = {}  # (index, fp) -> occurrence number
    for idx, fp in read_order:
        read_rank[(idx, fp)] = read_seen[fp]
        read_seen[fp] += 1

    total_tool_tokens = sum(r["tokens"] for r in results.values())
    grep_indices_by_path = defaultdict(list)
    for idx, p in grep_paths:
        grep_indices_by_path[p].append(idx)

    for tid, use in tool_uses.items():
        res = results.get(tid)
        if not res:
            continue
        tool = use["tool"]
        inp = use["input"]
        toks = res["tokens"]
        fp = inp.get("file_path", "")
        ev = {
            "tool": tool,
            "tokens": toks,
            "index": use["index"],
            "line": use["line"],
            "target": fp or inp.get("command", "") or inp.get("pattern", ""),
        }

        # full_file_read: a Read with no offset/limit pulling a big file
        if tool == "Read" and toks >= BIG_READ_TOKENS:
            if "offset" not in inp and "limit" not in inp:
                e = dict(ev); e["pattern"] = "full_file_read"
                e["note"] = "whole file read with no offset/limit"
                candidates.append(e)

        # reread: same path read again after the first time (rank >= 1 only;
        # the first read of a file is legitimate and not flagged)
        if tool == "Read" and fp and read_rank.get((use["index"], fp), 0) >= 1:
            e = dict(ev); e["pattern"] = "reread"
            e["note"] = f"file already Read earlier this session ({read_counts[fp]}x total)"
            e["count"] = read_counts[fp]
            candidates.append(e)

        # no_grep_first: big Read with no prior Grep/Glob of that path
        if tool == "Read" and toks >= BIG_READ_TOKENS and fp:
            prior_grep = any(i < use["index"] for i in grep_indices_by_path.get(fp, []))
            if not prior_grep:
                e = dict(ev); e["pattern"] = "no_grep_first"
                e["note"] = "large Read with no Grep of this path beforehand"
                candidates.append(e)

        # bash_dump: large Bash stdout not redirected to a file
        if tool == "Bash" and toks >= LARGE_RESULT_TOKENS:
            cmd = inp.get("command", "")
            redirected = (">" in cmd) or ("| tee" in cmd) or ("--output" in cmd) or ("-o " in cmd)
            if not redirected:
                e = dict(ev); e["pattern"] = "bash_dump"
                e["note"] = "large Bash output dumped to context, not piped to a file"
                candidates.append(e)

        # unreferenced: large result whose distinctive tokens never reappear later
        if toks >= LARGE_RESULT_TOKENS:
            sample = distinctive_tokens(res["text"])
            if not later_reference(sample, res["index"], assistant_texts):
                e = dict(ev); e["pattern"] = "unreferenced"
                e["note"] = "large result loaded but its content never referenced afterward"
                candidates.append(e)

        # obvious / confusing are CONTENT-quality judgements the detector can't make
        # deterministically — it only shortlists large results and attaches a bounded
        # excerpt so the analyst can decide. Any tool's output qualifies (doc, bash,
        # agent, read), not just instructions. One candidate carries both judgements;
        # the analyst tags it `obvious`, `confusing`, or drops it.
        if toks >= QUALITY_REVIEW_TOKENS:
            e = dict(ev); e["pattern"] = "low_value_content"
            e["note"] = "large result — analyst to judge if obvious/filler or confusing/contradictory"
            e["excerpt"] = excerpt(res["text"])
            candidates.append(e)

    # repeated: substantially the same content loaded 2+ times, ANY tool/path.
    # Generalises `reread` (same file path) to overlapping content — the same doc
    # fetched twice, a bash output re-dumped, two reads of the same region. We
    # compare large results pairwise by content shingles; the SECOND occurrence is
    # the wasteful one (the first legitimately introduced the content).
    large = sorted(
        ((tid, res) for tid, res in results.items() if res["tokens"] >= LARGE_RESULT_TOKENS),
        key=lambda kv: kv[1]["index"],
    )
    shingle_cache = {}
    for j in range(len(large)):
        tid_j, res_j = large[j]
        use_j = tool_uses.get(tid_j)
        if not use_j:
            continue
        sj = shingle_cache.setdefault(tid_j, shingles(res_j["text"]))
        for i in range(j):
            tid_i, res_i = large[i]
            si = shingle_cache.setdefault(tid_i, shingles(res_i["text"]))
            if jaccard(si, sj) >= REPEAT_OVERLAP:
                use_i = tool_uses.get(tid_i, {})
                inp_j = use_j["input"]
                e = {
                    "tool": use_j["tool"],
                    "tokens": res_j["tokens"],
                    "index": use_j["index"],
                    "line": use_j["line"],
                    "target": inp_j.get("file_path", "") or inp_j.get("command", "") or inp_j.get("pattern", ""),
                    "pattern": "repeated",
                    "note": "content substantially duplicates an earlier large result this session",
                    "first_target": use_i.get("input", {}).get("file_path", "")
                                    or use_i.get("input", {}).get("command", "")
                                    or use_i.get("input", {}).get("pattern", ""),
                    "first_tool": use_i.get("tool", ""),
                }
                candidates.append(e)
                break  # one repeat-flag per result; earliest match is enough

    # Cap low_value_content review requests to the biggest few — they carry excerpts
    # to the LLM, so an unbounded shortlist would be the very waste this skill hunts.
    lvc = sorted(
        (c for c in candidates if c["pattern"] == "low_value_content"),
        key=lambda c: -c["tokens"],
    )
    if len(lvc) > MAX_QUALITY_REVIEW:
        drop = set(id(c) for c in lvc[MAX_QUALITY_REVIEW:])
        candidates = [c for c in candidates if id(c) not in drop]

    # keep all distinct (pattern, tool-call) hits, ordered by size
    candidates.sort(key=lambda c: (-c["tokens"], c["index"]))

    # headline waste counts each wasteful tool call's tokens ONCE, even when it
    # tripped several patterns (e.g. a reread that was also a full_file_read).
    # `low_value_content` is only a REVIEW REQUEST (the analyst decides obvious vs
    # confusing vs fine) — excluded here so the deterministic headline doesn't claim
    # waste the LLM hasn't confirmed. If a result ALSO tripped a deterministic
    # pattern, that pattern still counts its tokens.
    wasted_tokens = sum(
        toks for toks in (
            {
                c["index"]: c["tokens"]
                for c in candidates
                if c["pattern"] != "low_value_content"
            }.values()  # index → tokens, dedup by call
        )
    )
    return {
        "session_id": filepath.stem,
        "project": project,
        "source_file": str(filepath),
        "chars_per_token": chars_per_token,
        "total_tool_result_tokens": total_tool_tokens,
        "candidate_wasted_tokens": wasted_tokens,
        "candidate_count": len(candidates),
        "candidates": candidates,
    }


def main():
    ap = argparse.ArgumentParser(description="Detect token-waste candidates in a session JSONL")
    ap.add_argument("input", help="session JSONL path")
    ap.add_argument("--project", default="", help="project name for labelling")
    ap.add_argument("--chars-per-token", type=float, default=4.0,
                    help="rough chars-per-token for estimation (default 4)")
    ap.add_argument("-o", "--output", help="output JSON path (default stdout)")
    args = ap.parse_args()

    p = Path(args.input)
    if not p.exists():
        print(f"Error: not found: {args.input}", file=sys.stderr)
        sys.exit(1)

    project = args.project or p.parent.name
    out = detect(p, project, args.chars_per_token)
    blob = json.dumps(out, indent=2)
    if args.output:
        Path(args.output).write_text(blob, encoding="utf-8")
        print(f"{out['candidate_count']} candidates, ~{out['candidate_wasted_tokens']} wasted tokens → {args.output}",
              file=sys.stderr)
    else:
        print(blob)


if __name__ == "__main__":
    main()
