#!/usr/bin/env python3
"""Tests for pipeline.py incremental processing."""

import json
import subprocess
import sys
import tempfile
from pathlib import Path

import pytest


@pytest.fixture
def temp_state_dir(tmp_path):
    """Create a temporary state directory."""
    state = tmp_path / "state"
    state.mkdir()
    return state


@pytest.fixture
def mock_home(tmp_path, monkeypatch):
    """Mock HOME to a temp directory."""
    monkeypatch.setenv("HOME", str(tmp_path))
    return tmp_path


def test_load_processed_empty(tmp_path, monkeypatch):
    """load_processed returns empty dict when file doesn't exist."""
    from scripts import pipeline

    monkeypatch.setattr(pipeline, "PROCESSED_FILE", tmp_path / "processed.json")
    result = pipeline.load_processed()
    assert result == {"sessions": {}}


def test_load_processed_with_data(tmp_path, monkeypatch):
    """load_processed reads existing processed.json."""
    from scripts import pipeline

    data = {"sessions": {"proj/sess1": {"source_mtime": 12345}}}
    processed_file = tmp_path / "processed.json"
    processed_file.write_text(json.dumps(data))

    monkeypatch.setattr(pipeline, "PROCESSED_FILE", processed_file)
    result = pipeline.load_processed()
    assert result == data


def test_sessions_to_process_finds_all_sessions(tmp_path, monkeypatch):
    """sessions_to_process returns all sessions when none processed."""
    from scripts import pipeline

    # Create mock project dirs with JSONL files
    projects = tmp_path / ".claude" / "projects"
    proj1 = projects / "proj1"
    proj1.mkdir(parents=True)
    (proj1 / "session1.jsonl").write_text("{}")
    (proj1 / "session2.jsonl").write_text("{}")

    monkeypatch.setattr(pipeline, "PROJECTS_DIR", projects)
    monkeypatch.setattr(pipeline, "PROCESSED_FILE", tmp_path / "processed.json")

    processed = pipeline.load_processed()
    sessions = pipeline.sessions_to_process(processed)

    assert len(sessions) == 2


def test_sessions_to_process_skips_already_processed(tmp_path, monkeypatch):
    """sessions_to_process skips sessions with matching mtime."""
    from scripts import pipeline

    projects = tmp_path / ".claude" / "projects"
    proj1 = projects / "proj1"
    proj1.mkdir(parents=True)
    jsonl = proj1 / "session1.jsonl"
    jsonl.write_text("{}")
    current_mtime = jsonl.stat().st_mtime

    # Mark as already processed with matching mtime
    processed_file = tmp_path / "processed.json"
    processed_file.write_text(json.dumps({
        "sessions": {
            "proj1/session1": {"source_mtime": current_mtime}
        }
    }))

    monkeypatch.setattr(pipeline, "PROJECTS_DIR", projects)
    monkeypatch.setattr(pipeline, "PROCESSED_FILE", processed_file)

    processed = pipeline.load_processed()
    sessions = pipeline.sessions_to_process(processed)

    assert len(sessions) == 0  # Should be skipped


def test_sessions_to_process_force_reprocesses(tmp_path, monkeypatch):
    """sessions_to_process with force=True returns all sessions."""
    from scripts import pipeline

    projects = tmp_path / ".claude" / "projects"
    proj1 = projects / "proj1"
    proj1.mkdir(parents=True)
    jsonl = proj1 / "session1.jsonl"
    jsonl.write_text("{}")
    current_mtime = jsonl.stat().st_mtime

    # Mark as processed
    processed_file = tmp_path / "processed.json"
    processed_file.write_text(json.dumps({
        "sessions": {"proj1/session1": {"source_mtime": current_mtime}}
    }))

    monkeypatch.setattr(pipeline, "PROJECTS_DIR", projects)
    monkeypatch.setattr(pipeline, "PROCESSED_FILE", processed_file)

    processed = pipeline.load_processed()
    sessions = pipeline.sessions_to_process(processed, force=True)

    assert len(sessions) == 1  # Should be re-processed


def test_cmd_done_marks_processed(tmp_path, monkeypatch):
    """--done records a session's current mtime in processed.json."""
    from scripts import pipeline

    projects = tmp_path / ".claude" / "projects"
    proj1 = projects / "proj1"
    proj1.mkdir(parents=True)
    jsonl = proj1 / "session1.jsonl"
    jsonl.write_text("{}")

    processed_file = tmp_path / "processed.json"
    monkeypatch.setattr(pipeline, "PROJECTS_DIR", projects)
    monkeypatch.setattr(pipeline, "PROCESSED_FILE", processed_file)
    monkeypatch.setattr(pipeline, "STATE_DIR", processed_file.parent)

    pipeline.cmd_done(str(jsonl))

    data = pipeline.load_processed()
    entry = data["sessions"]["proj1/session1"]
    assert entry["source_mtime"] == jsonl.stat().st_mtime
    assert "processed" in entry

    # A just-marked session is no longer listed.
    assert pipeline.sessions_to_process(pipeline.load_processed()) == []


def test_pipeline_cli_list(tmp_path, monkeypatch):
    """pipeline.py --list prints unprocessed session paths."""
    from scripts import pipeline

    projects = tmp_path / ".claude" / "projects"
    proj1 = projects / "proj1"
    proj1.mkdir(parents=True)
    (proj1 / "session1.jsonl").write_text("{}")

    monkeypatch.setattr(pipeline, "PROJECTS_DIR", projects)
    monkeypatch.setattr(pipeline, "PROCESSED_FILE", tmp_path / "processed.json")

    import io
    from contextlib import redirect_stdout
    buf = io.StringIO()
    with redirect_stdout(buf):
        pipeline.cmd_list(force=False)
    assert "session1.jsonl" in buf.getvalue()


def test_pipeline_cli_help():
    """pipeline.py --help works."""
    project_root = Path(__file__).parent.parent
    result = subprocess.run(
        [sys.executable, "scripts/pipeline.py", "--help"],
        capture_output=True,
        text=True,
        cwd=project_root,
    )
    assert result.returncode == 0
    assert "incremental" in result.stdout.lower() or "help" in result.stdout.lower()