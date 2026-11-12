// The public AI budget (R22, KTD12). Each AI call stores its token counts; cost is tokens times
// the model's price. Daily caps: $1.25 through November 30, $2.00 from December 1 to 15, never
// more than $55 in total. After December 15, 2026 the AI is off.
import type { Queryable } from "@/lib/db";

/** Prices in US dollars per million tokens (KTD8, checked against the claude-api skill). */
export const PRICES: Record<string, { input: number; output: number }> = {
  "claude-haiku-5-5": { input: 0.1, output: 0.5 },
  "claude-sonnet-5-5": { input: 2, output: 10 },
};

export const TOTAL_CAP_MICROUSD = 55_000_000;
const AI_OFF_AFTER = "2026-12-15";

/** Input tokens for pricing: plain input plus cache writes and cache reads, which are all billed as input. */
export function inputTokensFrom(usage: {
  input_tokens: number;
  cache_creation_input_tokens?: number | null;
  cache_read_input_tokens?: number | null;
}): number {
  return usage.input_tokens + (usage.cache_creation_input_tokens ?? 0) + (usage.cache_read_input_tokens ?? 0);
}

/** Cost in millionths of a dollar, rounded up. Unknown models (the scripted fakes) cost nothing. */
export function costMicroUsd(model: string, inputTokens: number, outputTokens: number): number {
  // Own keys only, so a name like "constructor" is an unknown model, not a prototype member.
  const price = Object.hasOwn(PRICES, model) ? PRICES[model] : undefined;
  if (!price) return 0;
  return Math.ceil(inputTokens * price.input + outputTokens * price.output);
}

/** The calendar day in Central Time, as YYYY-MM-DD. */
export function centralDay(now: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Chicago", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

export function dailyCapMicroUsd(day: string): number {
  return day >= "2026-12-01" ? 2_000_000 : 1_250_000;
}

export type BudgetState = { open: true } | { open: false; reason: "daily" | "total" | "ended" };

export async function aiBudgetState(q: Queryable, now: Date): Promise<BudgetState> {
  const day = centralDay(now);
  if (day > AI_OFF_AFTER) return { open: false, reason: "ended" };
  const today = await q.query<{ c: string | number }>("SELECT coalesce(sum(cost_microusd), 0) AS c FROM ai_spend WHERE day = $1", [day]);
  if (Number(today[0]?.c ?? 0) >= dailyCapMicroUsd(day)) return { open: false, reason: "daily" };
  const total = await q.query<{ c: string | number }>("SELECT coalesce(sum(cost_microusd), 0) AS c FROM ai_spend");
  if (Number(total[0]?.c ?? 0) >= TOTAL_CAP_MICROUSD) return { open: false, reason: "total" };
  return { open: true };
}

export async function recordAiSpend(q: Queryable, now: Date, microUsd: number): Promise<void> {
  if (microUsd <= 0) return;
  await q.query(
    `INSERT INTO ai_spend (day, cost_microusd) VALUES ($1, $2)
     ON CONFLICT (day) DO UPDATE SET cost_microusd = ai_spend.cost_microusd + EXCLUDED.cost_microusd`,
    [centralDay(now), microUsd],
  );
}
