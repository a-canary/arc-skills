/**
 * notify — estate-wide alerting library.
 *
 * Sends to Discord webhook (DISCORD_WEBHOOK_URL env var) and/or director chat
 * (arc-chat post). Fan-out: both transports tried independently; neither blocks
 * the other. Never throws; errors are logged and reported in the result.
 *
 * Built-in dedupe: pass a `dedupeKey` to only alert on state transitions.
 * State lives in ~/vault/health/notify-state/ (one JSON file per dedupeKey).
 * This replaces the ledger feedback table that watchdogs used for spam-prevention.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join as pathJoin } from "node:path";

export interface NotifyOptions {
  title: string;
  body: string;
  severity?: "error" | "warn" | "info";
  target?: "discord" | "chat" | "both";
  source?: string;
  /** Dedupe key: only alert when `state` differs from the last notified state for this key. */
  dedupeKey?: string;
  /** Current state string for dedupe (e.g. "down"/"up"). Required when dedupeKey is set. */
  state?: string;
}

export interface NotifyResult {
  discord: "sent" | "skipped" | "failed";
  chat: "sent" | "skipped" | "failed";
}

// Read at call time, not import time, so callers (and tests) can point transports elsewhere.
const env = {
  webhook: () => process.env.DISCORD_WEBHOOK_URL,
  target: () => process.env.NOTIFY_TARGET ?? "both",
  chatBin: () => process.env.ARC_CHAT_BIN ?? pathJoin(process.env.HOME ?? "", "repos", "arc-agents", "bin", "arc-chat.ts"),
  stateDir: () => process.env.NOTIFY_STATE_DIR ?? pathJoin(process.env.HOME ?? "", "vault", "health", "notify-state"),
};

function join(...parts: string[]): string {
  return parts.filter(Boolean).join("/");
}

export function colorFor(severity?: string): number {
  switch (severity) {
    case "error": return 16711680;   // red
    case "warn":  return 16776960;   // yellow
    case "info":  return 65280;      // green
    default:      return 7500;        // gray
  }
}

/**
 * Send Discord webhook notification. Returns "sent", "skipped", or "failed".
 */
export async function notifyDiscord(opts: NotifyOptions): Promise<"sent" | "skipped" | "failed"> {
  const url = env.webhook();
  if (!url) {
    console.error("notify: DISCORD_WEBHOOK_URL not set, skipping Discord");
    return "skipped";
  }
  const truncated = opts.body.slice(0, 1024);
  const payload = {
    username: opts.source ? `arc-${opts.source}` : "arc-alert",
    embeds: [{
      title: opts.title,
      description: truncated,
      color: colorFor(opts.severity),
      timestamp: new Date().toISOString(),
      footer: opts.severity ? { text: opts.severity.toUpperCase() } : undefined,
    }],
  };
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      console.error(`notify: Discord webhook returned ${res.status}`);
      return "failed";
    }
    return "sent";
  } catch (e) {
    console.error(`notify: Discord webhook failed: ${(e as Error).message}`);
    return "failed";
  }
}

/**
 * Send director chat notification via arc-chat CLI. Returns "sent", "skipped", or "failed".
 */
export async function notifyChat(opts: NotifyOptions): Promise<"sent" | "skipped" | "failed"> {
  // Use arc-chat post to send to director
  const chatBin = env.chatBin();
  if (!existsSync(chatBin)) {
    console.error(`notify: arc-chat not found at ${chatBin} (set ARC_CHAT_BIN), chat sink failed`);
    return "failed";
  }
  const { spawnSync } = await import("node:child_process");

  // Build the message: include severity prefix and source
  const prefix = opts.severity ? `[${opts.severity.toUpperCase()}] ` : "";
  const src = opts.source ? ` (${opts.source})` : "";
  const msg = `${prefix}${opts.title}: ${opts.body.slice(0, 500)}${src}`;

  try {
    const r = spawnSync(process.execPath, [chatBin, "post", msg], {
      encoding: "utf8",
      timeout: 10000,
    });
    if (r.status !== 0) {
      console.error(`notify: arc-chat post failed: ${r.stderr}`);
      return "failed";
    }
    return "sent";
  } catch (e) {
    console.error(`notify: arc-chat post error: ${(e as Error).message}`);
    return "failed";
  }
}


type Sink = "discord" | "chat";
interface DedupeFile { lastState?: string; sinks?: Partial<Record<Sink, string>>; at?: string }

// Dedupe is per sink: a state counts as notified only on the sinks that actually sent it,
// so a failed Discord DOWN re-fires next run even when chat got it (arc-z5k).
function readFile(key: string): DedupeFile {
  try {
    const path = pathJoin(env.stateDir(), `${key}.json`);
    return existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : {};
  } catch { return {}; }
}

/** Last state notified on this sink, or null. Pre-arc-z5k files only hold `lastState` for all sinks. */
function readState(key: string, sink: Sink): string | null {
  const f = readFile(key);
  return f.sinks?.[sink] ?? f.lastState ?? null;
}

/** Mark that `sink` has been notified for a key with a given state. */
function markNotified(key: string, sink: Sink, state: string): void {
  try {
    mkdirSync(env.stateDir(), { recursive: true });
    const f = readFile(key);
    f.sinks = { ...f.sinks, [sink]: state };
    f.at = new Date().toISOString();
    writeFileSync(pathJoin(env.stateDir(), `${key}.json`), JSON.stringify(f, null, 2));
  } catch { /* ignore disk errors */ }
}

/**
 * Fan out to configured transports. Target "both" tries Discord then chat.
 * If `dedupeKey` is provided, each sink only sends on its own state transitions (e.g. "up"→"down").
 * Returns aggregated result.
 */
export async function notify(opts: NotifyOptions): Promise<NotifyResult> {
  const target = opts.target ?? env.target();
  const results: NotifyResult = { discord: "skipped", chat: "skipped" };
  const { dedupeKey: key, state } = opts;

  // A dedupeKey without a state is a caller bug (silently never deduping); shout about it.
  if (key && !state) {
    console.error(`notify: dedupeKey "${key}" set without state — treating every send as a transition`);
  }
  const senders: Record<Sink, (o: NotifyOptions) => Promise<NotifyResult[Sink]>> = { discord: notifyDiscord, chat: notifyChat };
  for (const sink of ["discord", "chat"] as const) {
    if (target !== sink && target !== "both") continue;
    if (key && state && readState(key, sink) === state) {
      console.error(`notify: dedupe key "${key}" unchanged (${state}) on ${sink}, skipping`);
      continue;
    }
    results[sink] = await senders[sink](opts);
    if (key && state && results[sink] === "sent") markNotified(key, sink, state);
  }
  return results;
}
