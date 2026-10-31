"""Self-check for cache-aware weighting (arc-5tk).

Run: python3 skills/token-waste/lib/test_cache_aware.py

A block costs write + 0.1x per later API call until the next compact_boundary; a copy
re-injected after a compaction is not a duplicate. These fail if either regresses.
"""
import json
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
import detect_waste  # noqa: E402

MEM = "x" * 12000  # 3000 est tokens at 4 chars/token


def mem():
    return {"type": "attachment", "attachment": {"type": "nested_memory", "path": "/m/CLAUDE.md", "content": MEM}}


def call(mid):
    return {"type": "assistant", "message": {"id": mid, "role": "assistant", "content": [{"type": "text", "text": "ok"}],
            "usage": {"cache_creation": {"ephemeral_1h_input_tokens": 10, "ephemeral_5m_input_tokens": 0}}}}


BOUNDARY = {"type": "system", "subtype": "compact_boundary"}


def run(lines):
    with tempfile.NamedTemporaryFile("w", suffix=".jsonl", delete=False) as f:
        f.write("\n".join(json.dumps(x) for x in lines))
    return detect_waste.detect(Path(f.name), "t", 4.0)


def test_effective_counts_calls_until_boundary():
    p = {"calls": [1, 2, 3, 5], "bounds": [4], "write": 2.0}
    assert detect_waste.effective(100, 0, p) == int(100 * (2.0 + 0.1 * 2))  # calls 1,2,3 then compaction
    assert detect_waste.effective(100, 3, p) == 0  # no call before the boundary: never sent
    assert detect_waste.effective(100, 4, p) == 200  # after the boundary: one call writes it
    assert detect_waste.effective(100, 0, {"calls": [], "bounds": [], "write": None}) == 100  # no usage: 1x


def test_post_compaction_reinjection_is_not_repeated():
    lines = []
    for i in range(4):  # one copy per compaction window
        lines += [mem(), call(f"a{i}"), call(f"b{i}"), BOUNDARY]
    out = run(lines)
    assert not [c for c in out["candidates"] if c["pattern"] == "repeated_instruction"], out["candidates"]
    assert out["compactions"] == 4 and out["api_calls"] == 8


def test_in_window_duplicates_are_repeated_and_priced():
    lines = [mem(), call("a"), mem(), call("b"), mem(), call("c"), call("d")]
    out = run(lines)
    rep = [c for c in out["candidates"] if c["pattern"] == "repeated_instruction"]
    assert len(rep) == 1 and rep[0]["same_window_copies"] == 2 and rep[0]["tokens"] == 6000
    # copy 2 sees calls b,c,d; copy 3 sees c,d; 1h writes => 2x
    assert rep[0]["effective_tokens"] == int(3000 * 2.2) + int(3000 * 2.1)
    assert out["cache_write_multiplier"] == 2.0


if __name__ == "__main__":
    tests = [v for k, v in sorted(globals().items()) if k.startswith("test_")]
    for t in tests:
        t()
        print(f"ok  {t.__name__}")
    print(f"\n{len(tests)} passed")
