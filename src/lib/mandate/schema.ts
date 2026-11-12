/**
 * The mandate: a parent's spending rule as signed JSON.
 *
 * The shape follows Google's AP2 "IntentMandate" where AP2 has a matching
 * field. Our own rules live under `allowance_rules`.
 */
import { z } from "zod";
import { CATEGORY_LABELS, HOUSEHOLD_BASICS, type Category } from "@/lib/catalog/catalog";
import { formatUsd } from "@/lib/money/cents";

export interface MandateRules {
  /** Integer cents, greater than 0. */
  weekly_budget_cents: number;
  /** Non-empty. */
  allowed_categories: Category[];
  never_categories: Category[];
  /** A unit price strictly above this needs the parent's approval. */
  ask_first_unit_price_cents: number | null;
}

export interface IntentMandate {
  type: "IntentMandate";
  /** The parent's own words. */
  natural_language_description: string;
  merchants: string[];
  skus: string[] | null;
  requires_refundability: boolean;
  user_cart_confirmation_required: boolean;
  /** ISO 8601 with an offset, for example 2026-12-31T23:59:59-06:00. */
  intent_expiry: string;
  allowance_rules: MandateRules;
  /** Clauses the parent accepted as not enforced. */
  not_enforced: string[];
}

const CATEGORY_VALUES = Object.keys(CATEGORY_LABELS) as [Category, ...Category[]];
const categorySchema = z.enum(CATEGORY_VALUES);

const MAX_TEXT = 280;
const text = z.string().max(MAX_TEXT);
const cents = z.number().int().nonnegative();

const mandateRulesSchema = z.strictObject({
  weekly_budget_cents: cents.positive(),
  allowed_categories: z.array(categorySchema).min(1).max(CATEGORY_VALUES.length),
  never_categories: z.array(categorySchema).max(CATEGORY_VALUES.length),
  ask_first_unit_price_cents: cents.nullable(),
});

export const intentMandateSchema = z.strictObject({
  type: z.literal("IntentMandate"),
  natural_language_description: text.min(1),
  merchants: z.array(text.min(1)).max(10),
  skus: z.array(text.min(1)).max(100).nullable(),
  requires_refundability: z.boolean(),
  user_cart_confirmation_required: z.boolean(),
  intent_expiry: z.iso.datetime({ offset: true }).max(MAX_TEXT),
  allowance_rules: mandateRulesSchema,
  not_enforced: z.array(text.min(1)).max(20),
});

// Compile-time guard: the schema must produce exactly the IntentMandate type.
type SchemaOutput = z.infer<typeof intentMandateSchema>;
const _schemaMatchesType: (value: SchemaOutput) => IntentMandate = (value) => value;
const _typeMatchesSchema: (value: IntentMandate) => SchemaOutput = (value) => value;
void _schemaMatchesType;
void _typeMatchesSchema;

/** Parses untrusted input into a mandate. Throws a ZodError when it is not one. */
export function parseMandate(x: unknown): IntentMandate {
  return intentMandateSchema.parse(x);
}

function sameSet(a: readonly string[], b: readonly string[]): boolean {
  const setA = new Set(a);
  const setB = new Set(b);
  if (setA.size !== setB.size) return false;
  for (const item of setA) if (!setB.has(item)) return false;
  return true;
}

/** "household basics only" when the list is exactly the household basics, otherwise "only cleaning, laundry". */
export function describeAllowed(rules: Pick<MandateRules, "allowed_categories">): string {
  const allowed = [...new Set(rules.allowed_categories)];
  if (sameSet(allowed, HOUSEHOLD_BASICS)) return "household basics only";
  return `only ${allowed.map((c) => CATEGORY_LABELS[c]).join(", ")}`;
}

/**
 * Plain lines that say what a rule set does, in a fixed order:
 * budget, allowed list, ask-first limit, then one "never" line per category.
 */
export function describeRules(rules: MandateRules): string[] {
  const lines: string[] = [`${formatUsd(rules.weekly_budget_cents)} a week`, describeAllowed(rules)];

  if (rules.ask_first_unit_price_cents !== null) {
    lines.push(`ask me first over ${formatUsd(rules.ask_first_unit_price_cents)}`);
  }

  for (const category of new Set(rules.never_categories)) {
    lines.push(`never ${CATEGORY_LABELS[category]}`);
  }
  return lines;
}
