/**
 * Turning a parent's English rule into a mandate (U11).
 *
 * The model proposes; this file decides. Whatever a rule compiler returns, and whatever a
 * browser posts back, passes through `validateCompiled` before it can become a mandate. The
 * model's numbers and category names are never trusted, and the public demo's $120 weekly
 * ceiling is applied here, in code.
 *
 * No server-only imports: the card and the rule writer import the types and limits from here.
 */
import { z } from "zod";
import { CATEGORY_LABELS, type Category } from "@/lib/catalog/catalog";
import { formatUsd } from "@/lib/money/cents";
import { VISITOR_MAX_WEEKLY_BUDGET_CENTS } from "./demo-mandate";
import { type IntentMandate, type MandateRules, parseMandate } from "./schema";

/**
 * The longest rule a parent can write. The mandate stores the parent's words whole, and the
 * mandate schema caps them at 280 characters, so a longer rule could be read but never signed.
 */
export const MAX_RULE_TEXT = 280;
export const COMPILE_TIMEOUT_MS = 20_000;
export const MIN_WEEKLY_BUDGET_CENTS = 100;
/** The demo store ends here. A mandate that expired before it was signed could never allow a purchase. */
export const INTENT_EXPIRY = "2026-12-31T23:59:59-06:00";
export const CAP_NOTE = `Capped at ${formatUsd(VISITOR_MAX_WEEKLY_BUDGET_CENTS)} for this public demo.`;

const MAX_CLAUSE_CHARS = 280;
const MAX_CLAUSES = 10;
/** An ask-first limit above $100,000 is a typo or an attack, not a rule. */
const MAX_ASK_FIRST_CENTS = 10_000_000;

const CATEGORIES = Object.keys(CATEGORY_LABELS) as [Category, ...Category[]];
const categorySchema = z.enum(CATEGORIES);

/** What a compiler returns, and what a browser posts back at signing. */
export interface CompiledRule {
  rules: MandateRules;
  /** Clauses of the parent's rule that the mandate cannot hold. */
  notEnforced: string[];
  /** Plain notices for the parent, such as the budget cap. Written by the server only. */
  notes: string[];
}

export interface CompilerUsage {
  inputTokens: number;
  outputTokens: number;
}

/** The rule compiler port (KTD5, KTD8): Claude Sonnet in production, a scripted one in test mode. */
export interface RuleCompiler {
  /** Priced by this name in the AI budget. */
  model: string;
  /** Returns the model's raw output. Never trust it: pass it to `validateCompiled`. */
  compile(text: string, signal: AbortSignal): Promise<{ output: unknown; usage: CompilerUsage }>;
}

const rulesSchema = z.strictObject({
  weekly_budget_cents: z.number().int(),
  allowed_categories: z.array(categorySchema).min(1).max(CATEGORIES.length),
  never_categories: z.array(categorySchema).max(CATEGORIES.length),
  ask_first_unit_price_cents: z.number().int().nullable(),
});

/** The shape a compiler must produce. The Sonnet compiler sends this as its structured-output schema. */
export const compilerOutputSchema = z.strictObject({
  rules: rulesSchema,
  notEnforced: z.array(z.string()).max(MAX_CLAUSES),
});

const compiledSchema = compilerOutputSchema.extend({ notes: z.array(z.string()).max(5).optional() });

function unique<T>(items: readonly T[]): T[] {
  return [...new Set(items)];
}

/** Characters that break a database text column or JSON, and that a rule has no use for. */
const BAD_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;

function hasUnusableCharacters(value: string): boolean {
  if (BAD_CHARS.test(value)) return true;
  try {
    encodeURIComponent(value); // throws on a lone surrogate, which a jsonb column refuses
    return false;
  } catch {
    return true;
  }
}

/**
 * Checks untrusted output against the strict schema, the catalog's categories and the server's
 * ceilings. Returns the rule the parent will see, or null when it cannot be read. Never throws.
 *
 * - Unknown categories, extra keys, wrong types and odd numbers give null. Nothing is guessed.
 * - A budget above the public ceiling is lowered to it, and a note says so.
 * - A budget below $1 gives null, so a rule is never raised above what the parent wrote.
 * - A category the parent said "never" is removed from the allowed list. Never wins at checkout anyway.
 */
export function validateCompiled(output: unknown): CompiledRule | null {
  try {
    const parsed = compiledSchema.safeParse(output);
    if (!parsed.success) return null;
    const { rules, notEnforced } = parsed.data;

    let budget = rules.weekly_budget_cents;
    if (budget < MIN_WEEKLY_BUDGET_CENTS) return null;
    const notes: string[] = [];
    if (budget > VISITOR_MAX_WEEKLY_BUDGET_CENTS) {
      budget = VISITOR_MAX_WEEKLY_BUDGET_CENTS;
      notes.push(CAP_NOTE);
    } else if (budget === VISITOR_MAX_WEEKLY_BUDGET_CENTS && parsed.data.notes?.includes(CAP_NOTE)) {
      // A rule capped on an earlier pass keeps its note when the browser posts it back.
      notes.push(CAP_NOTE);
    }

    const ask = rules.ask_first_unit_price_cents;
    if (ask !== null && (ask < 1 || ask > MAX_ASK_FIRST_CENTS)) return null;

    const never = unique(rules.never_categories);
    const allowed = unique(rules.allowed_categories).filter((c) => !never.includes(c));
    if (allowed.length === 0) return null;

    const clauses: string[] = [];
    for (const raw of notEnforced) {
      const clause = raw.trim();
      if (clause.length === 0) continue;
      if (clause.length > MAX_CLAUSE_CHARS || hasUnusableCharacters(clause)) return null;
      if (!clauses.includes(clause)) clauses.push(clause);
    }

    return {
      rules: {
        weekly_budget_cents: budget,
        allowed_categories: allowed,
        never_categories: never,
        ask_first_unit_price_cents: ask,
      },
      notEnforced: clauses,
      notes,
    };
  } catch {
    return null;
  }
}

/** The reason a rule's words cannot be used, or null when they can. */
export function ruleTextProblem(text: unknown): string | null {
  if (typeof text !== "string" || text.trim().length === 0) return "Type your rule first.";
  const length = text.trim().length;
  if (length > MAX_RULE_TEXT) return `Your rule is ${length} characters. The limit is ${MAX_RULE_TEXT}.`;
  if (hasUnusableCharacters(text)) return "Your rule has characters that cannot be used.";
  return null;
}

export type SigningCheck = { ok: true; compiled: CompiledRule } | { ok: false; error: string };

/**
 * The server's check before signing. It validates the posted rule again, then requires every
 * clause under "Not enforced" to be accepted. A clause the parent removed is simply absent from
 * the posted rule, so what is left must equal the accepted list.
 */
export function finalizeForSigning(compiled: unknown, accepted: unknown): SigningCheck {
  const checked = validateCompiled(compiled);
  if (!checked) return { ok: false, error: "That rule could not be read. Read it again." };
  if (!Array.isArray(accepted) || accepted.some((item) => typeof item !== "string")) {
    return { ok: false, error: "Accept or remove every clause under Not enforced first." };
  }
  const acceptedSet = new Set((accepted as string[]).map((item) => item.trim()));
  const everyClauseDecided = checked.notEnforced.every((clause) => acceptedSet.has(clause));
  const nothingExtra = [...acceptedSet].every((clause) => checked.notEnforced.includes(clause));
  if (!everyClauseDecided || !nothingExtra) {
    return { ok: false, error: "Accept or remove every clause under Not enforced first." };
  }
  return { ok: true, compiled: checked };
}

/**
 * The mandate for a rule the parent has finished with. `compiled.notEnforced` must be the clauses
 * the parent accepted. Throws RangeError when the demo has ended and ZodError when the result is
 * not a valid mandate.
 */
export function buildMandate(text: string, compiled: CompiledRule, now: Date): IntentMandate {
  if (now.getTime() >= Date.parse(INTENT_EXPIRY)) {
    throw new RangeError("The demo has ended, so a new rule cannot be signed.");
  }
  return parseMandate({
    type: "IntentMandate",
    natural_language_description: text,
    merchants: ["Allowance demo store"],
    skus: null,
    requires_refundability: false,
    user_cart_confirmation_required: false,
    intent_expiry: INTENT_EXPIRY,
    allowance_rules: compiled.rules,
    not_enforced: compiled.notEnforced,
  });
}

export interface CompileRun {
  /** Null when the rule could not be read: bad output, an error, or a timeout. */
  compiled: CompiledRule | null;
  usage: CompilerUsage;
}

function cleanTokens(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}

/**
 * Runs a compiler under a deadline and validates what it returns. This owns the timeout, so a
 * scripted compiler and the real one behave the same way. It never throws.
 */
export async function runCompile(
  compiler: RuleCompiler,
  text: string,
  timeoutMs: number = COMPILE_TIMEOUT_MS,
): Promise<CompileRun> {
  const none: CompilerUsage = { inputTokens: 0, outputTokens: 0 };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const call = compiler.compile(text, controller.signal);
    call.catch(() => {}); // a late failure after the deadline is not an unhandled rejection
    const deadline = new Promise<never>((_, reject) => {
      controller.signal.addEventListener("abort", () => reject(new Error("The rule reader timed out.")), { once: true });
    });
    deadline.catch(() => {});
    const result = await Promise.race([call, deadline]);
    return {
      compiled: validateCompiled(result.output),
      usage: { inputTokens: cleanTokens(result.usage?.inputTokens), outputTokens: cleanTokens(result.usage?.outputTokens) },
    };
  } catch (error) {
    // The parent sees only "Could not read this rule". The log says why, without the API's own text.
    const status = (error as { status?: unknown } | null)?.status;
    console.error(`Rule compile failed: ${error instanceof Error ? error.name : "unknown error"}${typeof status === "number" ? ` (status ${status})` : ""}`);
    return { compiled: null, usage: none };
  } finally {
    clearTimeout(timer);
  }
}
