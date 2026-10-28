// Claude seat window meter: GET /api/oauth/usage (what Claude Code's /usage reads) — every active limit
// (session 5h, weekly, model-scoped weekly), no model call. Self-authored.
// Output: {status, "5h":{util,reset}, "7d":{util,reset,scope}, limits:[…]}; util is 0..1.
// "7d" = the most-used ACTIVE weekly limit (util null when none is active). Caller budgets on max(5h, 7d).
// Unreachable (sandboxed session, network flap) → null (CLI: util null, exit 2). Caller treats null as "V100-first".
export async function readClaudeWindow(): Promise<any | null> {
  try {
    const creds = await Bun.file(`${process.env.HOME}/.claude/.credentials.json`).json();
    const res = await fetch("https://api.anthropic.com/api/oauth/usage", {
      headers: { authorization: `Bearer ${creds.claudeAiOauth.accessToken}`, "anthropic-beta": "oauth-2025-04-20" },
      signal: AbortSignal.timeout(3_000),
    });
    if (!res.ok) return null;
    const j: any = await res.json();
    const limits = (j.limits ?? []).map((l: any) => ({
      kind: l.kind, group: l.group, util: Number(l.percent) / 100, reset: l.resets_at ?? null, active: !!l.is_active,
      scope: l.scope?.model?.display_name ?? null,
    }));
    const session = limits.find((l: any) => l.group === "session");
    const weekly = limits.filter((l: any) => l.group === "weekly" && l.active).sort((a: any, b: any) => b.util - a.util)[0];
    return {
      status: limits.some((l: any) => l.active && l.util >= 1) ? "limited" : "allowed",
      "5h": { util: session?.util ?? null, reset: session?.reset ?? null },
      "7d": { util: weekly?.util ?? null, reset: weekly?.reset ?? null, scope: weekly?.scope ?? null },
      limits,
    };
  } catch {
    return null;
  }
}

/** The binding utilisation: max of the 5h session and the most-used active weekly limit. */
// ponytail: route has no model, so a model-scoped weekly counts against all of claude (conservative);
// pass the model through when a director routes per model.
export const meterOf = (w: any | null): { util: number | null; limited: boolean } | null => {
  const u5 = w?.["5h"]?.util, u7 = w?.["7d"]?.util ?? 0;
  if (!Number.isFinite(u5) || !Number.isFinite(u7)) return null;
  const util = Math.max(u5, u7);
  return { util, limited: util >= 1 };
};

if (import.meta.main) {
  const w = await readClaudeWindow();
  console.log(JSON.stringify(w ?? { error: "unreachable", "5h": { util: null } }));
  if (!w) process.exit(2);
}
