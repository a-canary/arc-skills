#!/usr/bin/env python3
"""Stage 1 of the nightly knowledge-gap loop: extract topics/facts the AGENT was
confused about from recent sessions, append-only to a dense log.

Signal = the agent's own confusion: a fact it got wrong, a topic it was uncertain
on, a thing the user had to correct. NOT user-experience friction.

Cheap+wide half of a CAM loop (featherless Qwen3-32B). The smart half — rank by
severity x frequency, then reconcile against AGENTS.md / MEMORY.md / ke — runs as
Opus stages in nightly-self-improve.sh. See ~/vault/api/PROVIDERS.md for the
featherless caps (concurrency 4, <=4 distinct models/60s, 32k server ctx).

Output: one dense pipe-delimited line per gap, appended to GAP_LOG:
  YYYY-MM-DD | topic | one-line fact-the-agent-was-confused-about | session8
Append-only: the log is the accumulating frequency signal stage 2 ranks over.
"""
import json, re, subprocess, sys, time, urllib.error, urllib.request
from datetime import date, timedelta
from pathlib import Path

SESSIONS_DIR = Path.home() / ".claude/projects/-home-aaron"
GAP_LOG = Path.home() / ".claude/dream/agent-gaps.log"   # append-only, dense
ENDPOINT = "https://api.featherless.ai/v1/chat/completions"
MODEL = "Qwen/Qwen3-32B"          # first-party, on featherless; reasoning model
CHAR_BUDGET = 90_000              # ~28k tokens, under the 32k server ctx cap
MIN_TURNS = 2                    # need some dialogue to judge confusion
MAX_SESSIONS = 8                # concurrency=4 cap: keep the serial run bounded

PROMPT = """You are auditing a coding-agent transcript for the AGENT's OWN knowledge gaps.

Report only TOPICS or FACTS the agent was confused about: something it got factually wrong, was visibly uncertain about, guessed at, or that the user had to correct. Focus on durable, reusable knowledge (an API's behavior, a provider's limits, a config path, a tool's contract, a project constraint) — NOT one-off typos or transient state.

For each, give: a short topic (2-5 words, the reusable subject) and a one-line fact stating what the correct knowledge is (what the agent should have known).

Return STRICT JSON: {"gaps": [{"topic": "<2-5 word subject>", "fact": "<one line: the correct fact the agent lacked>"}]}
Empty list if the agent showed no knowledge gaps. No prose outside the JSON.

TRANSCRIPT:
"""


def api_key() -> str:
    return subprocess.run(
        ["pass", "show", "api/featherless/api-key"],
        capture_output=True, text=True, check=True,
    ).stdout.strip()


def yesterday_sessions() -> list[Path]:
    y = date.today() - timedelta(days=1)
    out = [p for p in SESSIONS_DIR.glob("*.jsonl")
           if date.fromtimestamp(p.stat().st_mtime) == y]
    out.sort(key=lambda p: p.stat().st_mtime, reverse=True)
    return out[:MAX_SESSIONS]


def _text(content) -> str:
    """Real prose from a message: the string itself, or the joined text-type
    blocks of list content. Ignores tool_result/tool_use blocks — user turns are
    mostly harness-wrapped tool_results, which are noise, not user prose."""
    if isinstance(content, str):
        return content.strip()
    if isinstance(content, list):
        return " ".join(b.get("text", "") for b in content
                        if isinstance(b, dict) and b.get("type") == "text").strip()
    return ""


def _is_noise(s: str) -> bool:  # tags, hooks, system-reminders, interrupt markers
    return (not s or s.startswith("<") or s.startswith("[")
            or "system-reminder" in s[:60] or "hook" in s[:20].lower())


def transcript_text(path: Path) -> tuple[str, int]:
    """User + agent text in order, for confusion judgement. Returns (text, n_turns).
    User text lives as a bare string OR text blocks inside list content — capture both."""
    lines, n = [], 0
    for raw in path.read_text(errors="replace").splitlines():
        try:
            o = json.loads(raw)
        except Exception:
            continue
        typ = o.get("type")
        if typ not in ("user", "assistant"):
            continue
        s = _text(o.get("message", {}).get("content"))
        if not s or (typ == "user" and _is_noise(s)):
            continue
        n += 1
        lines.append(f"{'USER' if typ == 'user' else 'AGENT'}: {s}")
    return "\n".join(lines), n


def ask(key: str, transcript: str) -> list[dict]:
    body = json.dumps({
        "model": MODEL,
        "messages": [{"role": "user", "content": PROMPT + transcript[:CHAR_BUDGET]}],
        "temperature": 0.2,
        "max_tokens": 4000,  # reasoning model — leaves room for <think> + JSON
    }).encode()
    req = urllib.request.Request(
        ENDPOINT, data=body,
        headers={
            "Authorization": f"Bearer {key}",
            "Content-Type": "application/json",
            "User-Agent": "curl/8.5.0",  # Cloudflare (err 1010) bans python-urllib UA
        },
    )
    for attempt in range(3):
        try:
            with urllib.request.urlopen(req, timeout=180) as r:
                content = json.loads(r.read())["choices"][0]["message"]["content"]
            break
        except urllib.error.HTTPError as e:
            if e.code == 429 and attempt < 2:
                time.sleep(int(e.headers.get("Retry-After") or 0) or 10 * (2 ** attempt))
                continue
            raise
    content = re.sub(r"<think>.*?</think>", "", content, flags=re.DOTALL)  # strip reasoning
    start, end = content.find("{"), content.rfind("}")
    if start == -1 or end == -1:
        return []
    return json.loads(content[start:end + 1]).get("gaps", [])


def clean(s: str) -> str:
    return " ".join(str(s).split()).replace("|", "/")  # keep the pipe delimiter safe


def main() -> int:
    sessions = yesterday_sessions()
    if not sessions:
        print("no sessions from yesterday", file=sys.stderr)
        return 0
    key = api_key()
    GAP_LOG.parent.mkdir(parents=True, exist_ok=True)
    day = (date.today() - timedelta(days=1)).isoformat()

    rows, first = [], True
    for path in sessions:
        transcript, n = transcript_text(path)
        if n < MIN_TURNS:
            continue
        if not first:
            time.sleep(16)  # <=4 distinct-model calls/60s cap
        first = False
        try:
            gaps = ask(key, transcript)
        except Exception as e:
            print(f"FAIL session={path.stem} err={e}", file=sys.stderr)
            continue
        for g in gaps:
            topic, fact = clean(g.get("topic", "")), clean(g.get("fact", ""))
            if topic and fact:
                rows.append(f"{day} | {topic} | {fact} | {path.stem[:8]}")
        print(f"session={path.stem[:8]} turns={n} gaps={len(gaps)}")

    if rows:
        with GAP_LOG.open("a") as fh:  # append-only
            fh.write("\n".join(rows) + "\n")
        print(f"appended {len(rows)} gaps -> {GAP_LOG}")
    else:
        print("no agent gaps")
    return 0


if __name__ == "__main__":
    sys.exit(main())
