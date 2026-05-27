#!/usr/bin/env python3
"""Integration test for extract.py output shape, COMPRESS tagging, and event count."""

import json
import subprocess
import sys
import tempfile
from pathlib import Path

import pytest


@pytest.fixture
def fixture_jsonl(tmp_path):
    """Create a minimal JSONL fixture with 5 messages, one large field."""
    # One large field (>1000 words) that should get COMPRESS tag
    large_content = "word " * 1200  # ~1200 words, exceeds 1000 threshold

    messages = [
        # Message 1: user message (small, no tag)
        json.dumps({
            "type": "message",
            "timestamp": "2026-05-10T12:00:00Z",
            "message": {
                "role": "user",
                "content": "Hello, how are you?"
            }
        }),
        # Message 2: assistant tool use (small)
        json.dumps({
            "type": "message",
            "timestamp": "2026-05-10T12:00:01Z",
            "message": {
                "role": "assistant",
                "content": [
                    {"type": "tool_use", "id": "toolu_001", "name": "Bash", "input": {"command": "ls -la"}}
                ]
            }
        }),
        # Message 3: tool result (small)
        json.dumps({
            "type": "message",
            "timestamp": "2026-05-10T12:00:02Z",
            "message": {
                "role": "user",
                "content": [
                    {"type": "tool_result", "tool_use_id": "toolu_001", "content": "total 32\ndrwxr-xr-x 2 aaron 4096 May 10 12:00 ."}
                ]
            }
        }),
        # Message 4: assistant text (large — should get COMPRESS tag)
        json.dumps({
            "type": "message",
            "timestamp": "2026-05-10T12:00:03Z",
            "message": {
                "role": "assistant",
                "content": [
                    {"type": "text", "text": large_content}
                ]
            }
        }),
        # Message 5: progress (noise — should be filtered)
        json.dumps({
            "type": "progress",
            "timestamp": "2026-05-10T12:00:04Z",
            "progress": 0.5
        }),
    ]

    fixture_path = tmp_path / "session.jsonl"
    fixture_path.write_text("\n".join(messages) + "\n")
    return fixture_path


def test_extract_message_count(fixture_jsonl, monkeypatch):
    """Extract should produce exactly 4 messages (progress filtered out)."""
    # Run from dream project root so lib module is importable
    project_root = Path(__file__).parent.parent
    monkeypatch.chdir(project_root)
    result = subprocess.run(
        [sys.executable, "scripts/extract.py", str(fixture_jsonl)],
        capture_output=True,
        text=True,
    )
    assert result.returncode == 0, f"extract.py failed: {result.stderr}"

    output = result.stdout

    # Find message_count in YAML output
    for line in output.split("\n"):
        if line.startswith("message_count:"):
            count = int(line.split(":")[1].strip())
            assert count == 4, f"Expected 4 messages after noise filtering, got {count}"
            break
    else:
        pytest.fail("message_count not found in output")


def test_extract_tool_counts_keys(fixture_jsonl, monkeypatch):
    """Extract should include tool_counts with Bash."""
    project_root = Path(__file__).parent.parent
    monkeypatch.chdir(project_root)
    result = subprocess.run(
        [sys.executable, "scripts/extract.py", str(fixture_jsonl)],
        capture_output=True,
        text=True,
    )
    assert result.returncode == 0, f"extract.py failed: {result.stderr}"

    output = result.stdout

    # tool_counts section should contain Bash
    assert "tool_counts:" in output
    assert "Bash:" in output, "tool_counts should include Bash"

    # Extract the count
    for line in output.split("\n"):
        if line.strip().startswith("Bash:"):
            count = int(line.split(":")[1].strip())
            assert count == 1, f"Expected 1 Bash invocation, got {count}"
            break


def test_extract_compress_tag_on_large_field(fixture_jsonl, monkeypatch):
    """Large field (>1000 words) should be wrapped in <COMPRESS> tags."""
    project_root = Path(__file__).parent.parent
    monkeypatch.chdir(project_root)
    result = subprocess.run(
        [sys.executable, "scripts/extract.py", str(fixture_jsonl)],
        capture_output=True,
        text=True,
    )
    assert result.returncode == 0, f"extract.py failed: {result.stderr}"

    output = result.stdout

    assert "<COMPRESS>" in output, "Large content should have <COMPRESS> opening tag"
    assert "</COMPRESS>" in output, "Large content should have </COMPRESS> closing tag"

    # Verify the COMPRESS tag contains word count and line range
    assert "words" in output, "COMPRESS tag should include word count"
    # The large content was a single assistant text block, so it should be tagged