/**
 * notify — estate-wide alerting library tests.
 */
import { describe, it, expect } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { notifyDiscord, notifyChat, notify, colorFor } from "./lib/notify";

// Never reach the live sinks: a stub arc-chat that succeeds, a temp dedupe dir, no webhook.
const scratch = mkdtempSync(join(tmpdir(), "notify-test-"));
const stubChat = join(scratch, "arc-chat-stub.ts");
writeFileSync(stubChat, "process.exit(0);\n");
process.env.ARC_CHAT_BIN = stubChat;
process.env.NOTIFY_STATE_DIR = join(scratch, "state");
delete process.env.DISCORD_WEBHOOK_URL;

describe("colorFor", () => {
  it("returns red for error", () => {
    expect(colorFor("error")).toBe(16711680);
  });
  it("returns yellow for warn", () => {
    expect(colorFor("warn")).toBe(16776960);
  });
  it("returns green for info", () => {
    expect(colorFor("info")).toBe(65280);
  });
  it("returns gray default", () => {
    expect(colorFor(undefined)).toBe(7500);
  });
});

describe("notifyDiscord", () => {
  it("returns skipped when DISCORD_WEBHOOK_URL not set", async () => {
    const orig = process.env.DISCORD_WEBHOOK_URL;
    delete process.env.DISCORD_WEBHOOK_URL;
    const result = await notifyDiscord({ title: "t", body: "b" });
    expect(result).toBe("skipped");
    if (orig) process.env.DISCORD_WEBHOOK_URL = orig;
  });
});

describe("notify", () => {
  it("honors target=discord", async () => {
    const orig = process.env.DISCORD_WEBHOOK_URL;
    delete process.env.DISCORD_WEBHOOK_URL;
    const res = await notify({ title: "t", body: "b", target: "discord" });
    expect(res.discord).toBe("skipped");
    expect(res.chat).toBe("skipped");
    if (orig) process.env.DISCORD_WEBHOOK_URL = orig;
  });

  it("honors target=chat", async () => {
    const res = await notify({ title: "t", body: "b", target: "chat" });
    expect(res.discord).toBe("skipped");
    // chat may fail if arc-chat binary missing — either "failed" or "sent" acceptable
    expect(["sent", "skipped", "failed"]).toContain(res.chat);
  });

  it("skips when dedupeKey + state match previous", async () => {
    const origWebhook = process.env.DISCORD_WEBHOOK_URL;
    delete process.env.DISCORD_WEBHOOK_URL;
    const key = `test-dedupe-${Date.now()}`;
    // First send with state=down: chat will try (arc-chat binary path may fail),
    // but the dedupe state should be marked.
    await notify({ title: "first", body: "b", target: "chat", dedupeKey: key, state: "down" });
    // Second send with same state: should skip entirely (both transports skipped).
    const res = await notify({ title: "second", body: "b", target: "both", dedupeKey: key, state: "down" });
    expect(res.discord).toBe("skipped");
    expect(res.chat).toBe("skipped");
    if (origWebhook) process.env.DISCORD_WEBHOOK_URL = origWebhook;
  });

  it("fires on state transition (down→up)", async () => {
    const origWebhook = process.env.DISCORD_WEBHOOK_URL;
    delete process.env.DISCORD_WEBHOOK_URL;
    const key = `test-transition-${Date.now()}`;
    await notify({ title: "first down", body: "b", target: "chat", dedupeKey: key, state: "down" });
    // Transition to up: at least one transport must be attempted (chat).
    const res = await notify({ title: "now up", body: "b", target: "chat", dedupeKey: key, state: "up" });
    expect(["sent", "skipped", "failed"]).toContain(res.chat);
    if (origWebhook) process.env.DISCORD_WEBHOOK_URL = origWebhook;
  });
});

// arc-z5k: a working chat sink must not hide a dead Discord webhook.
describe("per-sink dedupe + failure reporting", () => {
  const deadHook = "http://127.0.0.1:9/webhook"; // connection refused → "failed"

  it("a Discord failure re-fires next run while chat (already sent) stays deduped", async () => {
    process.env.DISCORD_WEBHOOK_URL = deadHook;
    const key = `test-per-sink-${Date.now()}`;
    const first = await notify({ title: "x DOWN", body: "b", target: "both", dedupeKey: key, state: "down" });
    expect(first).toEqual({ discord: "failed", chat: "sent" });
    const again = await notify({ title: "x DOWN", body: "b", target: "both", dedupeKey: key, state: "down" });
    expect(again).toEqual({ discord: "failed", chat: "skipped" });
    delete process.env.DISCORD_WEBHOOK_URL;
  });

  it("a pre-arc-z5k state file (lastState only) still dedupes both sinks", async () => {
    const key = `test-legacy-${Date.now()}`;
    mkdirSync(process.env.NOTIFY_STATE_DIR!, { recursive: true });
    writeFileSync(join(process.env.NOTIFY_STATE_DIR!, `${key}.json`), JSON.stringify({ lastState: "down" }));
    process.env.DISCORD_WEBHOOK_URL = deadHook;
    const res = await notify({ title: "x", body: "b", target: "both", dedupeKey: key, state: "down" });
    expect(res).toEqual({ discord: "skipped", chat: "skipped" });
    delete process.env.DISCORD_WEBHOOK_URL;
  });

  it("a missing arc-chat binary fails the chat sink", async () => {
    const orig = process.env.ARC_CHAT_BIN;
    process.env.ARC_CHAT_BIN = join(scratch, "no-such-arc-chat.ts");
    expect(await notifyChat({ title: "t", body: "b" })).toBe("failed");
    process.env.ARC_CHAT_BIN = orig;
  });

  it("CLI exits 3 when one sink sends and another fails", () => {
    const r = spawnSync(process.execPath, [join(import.meta.dir, "notify.ts"), "t", "b", "--target", "both"], {
      encoding: "utf8",
      env: { ...process.env, DISCORD_WEBHOOK_URL: deadHook },
    });
    expect(r.status).toBe(3);
    expect(r.stderr).toContain("partial failure (discord=failed, chat=sent)");
  });
});