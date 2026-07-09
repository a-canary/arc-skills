#!/usr/bin/env python3
"""Extract points-of-confusion from yesterday's sessions via featherless.ai.

Distinct from /dream (Claude's failure modes) and /token-waste (context economy):
this hunts USER confusion — where the user got frustrated, repeated themselves,
corrected a misread, or the exchange went in circles. A UX signal, not an
agent-effectiveness one, so it writes its own journal file.

Slow-burn cron job: one fixed featherless model (concurrency=4, <=4 distinct
models/60s, 32k server ctx cap — see ~/vault/api/PROVIDERS.md). Serial, no fanout.
"""
import json, subprocess, sys, time, urllib.error, urllib.request
from datetime import date, timedelta
from pathlib import Path

SESSIONS_DIR = Path.home() / ".claude/projects/-home-aaron"
JOURNAL_DIR = Path.home() / ".claude/dream/journal"
ENDPOINT = "https://api.featherless.ai/v1/chat/completions"
MODEL = "zai-org/GLM-5.2"          # flagship open coder; long ctx, on the fixed set
CHAR_BUDGET = 90_000              # ~28k tokens, under the 32k server ctx cap
MIN_USER_TURNS = 2               # no dialogue => nothing to be confused about
MAX_SESSIONS = 8                # concurrency=4 big-model cap: keep the nightly serial run bounded

PROMPT = """You are auditing a coding-agent transcript for USER confusion — not the agent's mistakes.

Report only moments where the USER was confused, frustrated, had to repeat or rephrase, corrected the agent's misreading of the request, or the exchange went in circles. Ignore the agent's own errors unless they visibly confused the user.

Return STRICT JSON: {"findings": [{"what": "<what confused the user, 1-2 sentences>", "trigger": "<the agent behavior or gap that caused it>", "quote": "<short user quote showing the confusion>"}]}
Empty findings list if the session was smooth. No prose outside the JSON.

TRANSCRIPT:
"""


def api_key() -> str:
    return subprocess.run(
        ["pass", "show", "api/featherless/api-key"],
        capture_output=True, text=True, check=True,
    ).stdout.strip()


def yesterday_sessions() -> list[Path]:
    y = date.today() - timedelta(days=1)
    out = []
    for p in SESSIONS_DIR.glob("*.jsonl"):
        m = date.fromtimestamp(p.stat().st_mtime)
        if m == y:
            out.append(p)
    out.sort(key=lambda p: p.stat().st_mtime, reverse=True)  # newest first
    return out[:MAX_SESSIONS]


def transcript_text(path: Path) -> tuple[str, int]:
    """Real user turns + assistant text, in order. Returns (text, n_user_turns)."""
    lines = []
    n_user = 0
    for raw in path.read_text(errors="replace").splitlines():
        try:
            o = json.loads(raw)
        except Exception:
            continue
        if o.get("type") == "user":
            c = o.get("message", {}).get("content")
            if isinstance(c, str):
                s = c.strip()
                # drop tagged/hook/system-reminder noise; keep real prompts
                if s and not s.startswith("<") and "system-reminder" not in s[:60] \
                        and "hook" not in s[:20].lower():
                    n_user += 1
                    lines.append(f"USER: {s}")
        elif o.get("type") == "assistant":
            c = o.get("message", {}).get("content")
            if isinstance(c, list):
                txt = " ".join(
                    b.get("text", "") for b in c
                    if isinstance(b, dict) and b.get("type") == "text"
                ).strip()
                if txt:
                    lines.append(f"AGENT: {txt}")
    return "\n".join(lines), n_user


def ask(key: str, transcript: str) -> list[dict]:
    body = json.dumps({
        "model": MODEL,
        "messages": [{"role": "user", "content": PROMPT + transcript[:CHAR_BUDGET]}],
        "temperature": 0.2,
        "max_tokens": 4000,  # GLM-5.2 is a reasoning model — leaves room for reasoning + JSON
    }).encode()
    req = urllib.request.Request(
        ENDPOINT, data=body,
        headers={
            "Authorization": f"Bearer {key}",
            "Content-Type": "application/json",
            # Cloudflare (err 1010) bans the default Python-urllib UA by signature.
            "User-Agent": "curl/8.5.0",
        },
    )
    # concurrency=4 cap => brief backoff on 429, then skip the session (nightly, non-urgent).
    for attempt in range(3):
        try:
            with urllib.request.urlopen(req, timeout=180) as r:
                content = json.loads(r.read())["choices"][0]["message"]["content"]
            break
        except urllib.error.HTTPError as e:
            if e.code == 429 and attempt < 2:
                wait = int(e.headers.get("Retry-After") or 0) or 10 * (2 ** attempt)
                time.sleep(wait)
                continue
            raise
    # tolerate ```json fences and stray prose around the object
    start, end = content.find("{"), content.rfind("}")
    if start == -1 or end == -1:
        return []
    return json.loads(content[start:end + 1]).get("findings", [])


def main() -> int:
    sessions = yesterday_sessions()
    if not sessions:
        print("no sessions from yesterday", file=sys.stderr)
        return 0
    key = api_key()
    JOURNAL_DIR.mkdir(parents=True, exist_ok=True)
    out = JOURNAL_DIR / f"confusion-{(date.today() - timedelta(days=1)).isoformat()}.md"

    blocks = []
    first = True
    for path in sessions:
        transcript, n_user = transcript_text(path)
        if n_user < MIN_USER_TURNS:
            continue
        if not first:
            time.sleep(16)  # <=4 distinct-model calls/60s cap; stay well under
        first = False
        try:
            findings = ask(key, transcript)
        except Exception as e:  # loud-fail per finding; keep going
            print(f"FAIL session={path.stem} err={e}", file=sys.stderr)
            continue
        for f in findings:
            blocks.append(
                f"## {f.get('what', '?')}\n\n"
                f"- **session:** {path.stem}\n"
                f"- **trigger:** {f.get('trigger', '?')}\n"
                f"- **quote:** {f.get('quote', '?')}\n"
            )
        print(f"session={path.stem} user_turns={n_user} findings={len(findings)}")

    if blocks:
        out.write_text(f"# User confusion — {out.stem[len('confusion-'):]}\n\n" + "\n".join(blocks))
        print(f"wrote {len(blocks)} findings -> {out}")
    else:
        print("no confusion findings")
    return 0


if __name__ == "__main__":
    sys.exit(main())
