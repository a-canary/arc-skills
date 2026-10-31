#!/usr/bin/env bun
// notify — estate-wide alerting CLI.
//
//   notify <title> <body> [--severity error|warn|info] [--target discord|chat|both] [--source S]
//
// Fans out to Discord webhook (DISCORD_WEBHOOK_URL) and director chat
// (arc-chat post). NEVER throws on transport failure; stderr logs and exit
// code reflects whether AT LEAST ONE transport succeeded.
//
// Exit codes:
//   0  — nothing failed; at least one transport sent or was deduped (already notified)
//   1  — usage error (missing args)
//   2  — nothing sent or deduped: every configured transport failed or was skipped
//   3  — partial: a transport failed while another sent or was deduped (failure on stderr)
//
// Callers: watchdogs, deploy/health scripts and bin/health-monitor.ts exec this CLI.
import { notify } from "./lib/notify";

const args = process.argv.slice(2);
const title = args[0];
const body = args[1];
if (!title || !body) {
  console.error("Usage: notify <title> <body> [--severity S] [--target T] [--source S]");
  process.exit(1);
}

const opts: Parameters<typeof notify>[0] = { title, body };
for (let i = 2; i < args.length; i++) {
  const a = args[i];
  const next = args[i + 1];
  if (a === "--severity" && next) { opts.severity = next as "error" | "warn" | "info"; i++; }
  else if (a === "--target" && next) { opts.target = next as "discord" | "chat" | "both"; i++; }
  else if (a === "--source" && next) { opts.source = next; i++; }
  else if (a === "--dedupe-key" && next) { opts.dedupeKey = next; i++; }
  else if (a === "--state" && next) { opts.state = next; i++; }
}

const res = await notify(opts);
// "deduped" counts as delivered: that state already reached the sink on an earlier run.
const delivered = [res.discord, res.chat].some((r) => r === "sent" || r === "deduped");
const failed = res.discord === "failed" || res.chat === "failed";
if (delivered && !failed) process.exit(0);
if (delivered) {
  // a working (or already-notified) sink must not hide a dead one (arc-z5k)
  console.error(`notify: partial failure (discord=${res.discord}, chat=${res.chat})`);
  process.exit(3);
}
console.error(`notify: all transports failed (discord=${res.discord}, chat=${res.chat})`);
process.exit(2);
