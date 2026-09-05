---
name: pwcheck
description: Headless-Chromium page probe — goto a URL, optionally click through (tabs) and log in, print final URL + body sample. Use for E2E verification of client-side behavior curl can't see: SPA redirects, auth flows, post-login landing pages. Script ships at scripts/pwcheck.mjs; needs a local playwright install (see §Bootstrap).
---

# pwcheck

One-shot headless page probe. Prints `final URL:` + `body sample:`; exit 0 on
success, 1 on failure (script error or navigation timeout). No test framework,
no fixtures — a probe, not a suite. For repeatable assertions, write a real
test in the target repo instead.

## Usage

```sh
node scripts/pwcheck.mjs <url> [--wait ms] [--click "selector"] \
  [--login EMAIL PASS] [--screenshot /tmp/shot.png]
```

- `--wait ms` — settle time after actions (default 3000). SPAs with client-side
  redirects need ≥4000.
- `--click sel` — click before login (e.g. a Sign-in tab when the page defaults
  to Create Account). Waits for React re-render before filling.
- `--login EMAIL PASS` — fills visible email/password inputs, clicks submit.
- `--screenshot path` — full-page PNG of the final state (read it with the
  image tool; body text alone hides layout problems).

## Examples

```sh
# Does a guest hit the sign-in page?
node scripts/pwcheck.mjs https://app.example.com/ --wait 4000

# Full login journey. Pull credentials from your own secret store — never
# inline them. Any command that prints the value to stdout works.
EMAIL=$(your-secret-tool read qa/login-email)
PASS=$(your-secret-tool read qa/login-password)
node scripts/pwcheck.mjs https://app.example.com/setup --wait 6000 \
  --click 'button:has-text("Sign In")' --login "$EMAIL" "$PASS"
```

## Gotchas

- **Bot-challenge console errors are often expected in headless.** Headless
  Chromium frequently can't resolve challenge-provider hosts (e.g. Cloudflare
  Turnstile's `[Cloudflare Turnstile] Error: 600010` when
  `*.challenges.cloudflare.com` fails browser-side DNS, even though shell
  `getent` resolves it). If the site only challenges on some routes, an
  unchallenged route still returns 200 and the flow is fine. Judge by final URL
  + API status, not console noise. Use a real browser to verify a challenge
  genuinely works.
- **Re-render race**: after `--click` switches a tab, React remounts the form.
  The tool waits 1200ms and fills `:visible` inputs to avoid writing into a
  stale hidden twin. If a fill silently no-ops, screenshot and look for an
  empty form before blaming the app.
- **networkidle is unreliable** (persistent connections) — the tool uses
  `domcontentloaded` + fixed settle; don't "fix" it to networkidle.
- Credentials via env/args only; never hardcode into scripts or commits.

## Bootstrap

`scripts/pwcheck.mjs` ships with this skill and needs playwright resolvable at
runtime. If it isn't already installed:

```sh
cd skills/pwcheck/scripts   # from the repo root; deps must sit beside the script
printf '{"private":true,"type":"module","dependencies":{"playwright":"1.61.1"}}' > package.json
npm i --no-fund --no-audit
npx playwright install chromium   # skip if the browser cache is already populated
```

The bare `import "playwright"` resolves upward from the *script's* directory, not
your working directory — installing into the CWD you happen to be in gives
`ERR_MODULE_NOT_FOUND` when you later run the probe from anywhere else.

Pin the playwright version to whatever browser build the host's playwright
cache already has — mismatched versions trigger a full browser re-download.
