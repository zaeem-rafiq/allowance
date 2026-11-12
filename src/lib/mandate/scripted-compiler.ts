/**
 * The scripted rule compiler for test mode (KTD5). It reads a few fixed phrases the same way
 * every time, so browser tests do not need a model. A test steers it with the "compiler" test
 * hook: "garbage" returns output that fails the schema, and "timeout" waits until the run's
 * deadline aborts it.
 */
import { CATEGORY_IDS, CATEGORY_LABELS, HOUSEHOLD_BASICS, type Category } from "@/lib/catalog/catalog";
import { getTestHook } from "@/lib/test-hooks";
import type { CompilerUsage, RuleCompiler } from "./compile";

const NO_USAGE: CompilerUsage = { inputTokens: 0, outputTokens: 0 };

/** "1,200" -> 120000, "34.5" -> 3450. Returns 0 for anything that is not a plain amount. */
function dollarsToCents(amount: string): number {
  const [whole = "0", fraction = ""] = amount.replace(/,/g, "").split(".");
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, "0").slice(0, 2));
  return Number.isSafeInteger(cents) ? cents : 0;
}

const AMOUNT = String.raw`\$\s*(\d[\d,]*(?:\.\d{1,2})?)`;
const WEEKLY = new RegExp(`${AMOUNT}\\s*(?:a|per|each|every|/)\\s*week\\b`, "i");
const ASK_FIRST_NOTHING_OVER = new RegExp(`\\bnothing\\s+over\\s+${AMOUNT}`, "i");
const ASK_FIRST_ASK_ME = new RegExp(`\\bask\\s+me\\s+(?:first\\s+)?(?:for\\s+|about\\s+)?(?:anything\\s+)?over\\s+${AMOUNT}`, "i");
const TIME_LIMITS = [/\bonly\s+on\s+(?:weekdays|weekends)\b/i, /\b(?:before|after)\s+\d{1,2}\s*(?:am|pm)\b/i];

export interface ScriptedOutput {
  rules: {
    weekly_budget_cents: number;
    allowed_categories: Category[];
    never_categories: Category[];
    ask_first_unit_price_cents: number | null;
  };
  notEnforced: string[];
}

/**
 * The phrases it knows: "$N a week", "household basics", "nothing over $N" or "ask me first over
 * $N", "never <category>", and "only on weekdays" (which the mandate cannot hold). With no weekly
 * amount the budget is 0, which the validator refuses, so the rule is unreadable. With no category
 * named, every store category is allowed.
 */
export function parseScriptedRule(text: string): ScriptedOutput {
  const weekly = WEEKLY.exec(text);
  const ask = ASK_FIRST_NOTHING_OVER.exec(text) ?? ASK_FIRST_ASK_ME.exec(text);
  const allowed: Category[] = /\bhousehold\s+basics?\b/i.test(text) ? [...HOUSEHOLD_BASICS] : [...CATEGORY_IDS];
  const never = CATEGORY_IDS.filter((category) =>
    new RegExp(`\\b(?:never|no)\\s+(?:buy(?:ing)?\\s+)?${CATEGORY_LABELS[category]}\\b`, "i").test(text),
  );
  const notEnforced: string[] = [];
  for (const pattern of TIME_LIMITS) {
    const match = pattern.exec(text);
    if (match) notEnforced.push(match[0].toLowerCase());
  }
  return {
    rules: {
      weekly_budget_cents: weekly ? dollarsToCents(weekly[1]) : 0,
      allowed_categories: allowed,
      never_categories: never,
      ask_first_unit_price_cents: ask ? dollarsToCents(ask[1]) : null,
    },
    notEnforced,
  };
}

function waitForAbort(signal: AbortSignal): Promise<never> {
  return new Promise((_, reject) => {
    const fail = () => reject(new Error("The scripted compiler was stopped."));
    if (signal.aborted) fail();
    else signal.addEventListener("abort", fail, { once: true });
  });
}

export class ScriptedCompiler implements RuleCompiler {
  /** Not in the price list, so it costs nothing in the AI budget. */
  readonly model = "scripted-compiler";

  async compile(text: string, signal: AbortSignal): Promise<{ output: unknown; usage: CompilerUsage }> {
    const behavior = getTestHook<string>("compiler");
    if (behavior === "timeout") return waitForAbort(signal);
    if (behavior === "garbage") return { output: { rules: "not a rule" }, usage: NO_USAGE };
    return { output: parseScriptedRule(text), usage: NO_USAGE };
  }
}
